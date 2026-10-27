/**
 * @fileoverview Span Builder
 *
 * 从 OpenClaw turn 数据中提取 LLM call 和 Tool call，
 * 构建符合 Firefly SpanIngest schema 的 FireflySpan 列表。
 *
 * Span 类型：
 *  - gen_ai.chat  — LLM 推理调用
 *  - gen_ai.tool  — 工具调用
 */

import type {
  OpenClawTurn,
  OpenClawToolCall,
  FireflySpan,
  FireflyStatus,
} from "./types.js";
import { buildCorrelationMetadata } from "./correlation.js";

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/** 将 Unix ms 时间戳转为 ISO 8601 字符串 */
function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

/** 推断工具调用状态 */
function toolStatus(tool: OpenClawToolCall): FireflyStatus {
  if (tool.status === "error" || tool.error) return "error";
  return "ok";
}

// ─────────────────────────────────────────────
// SpanBuilder
// ─────────────────────────────────────────────

export class SpanBuilder {
  /**
   * 构建当前 turn 下所有 Span。
   *
   * @param turn       OpenClaw turn 数据
   * @param traceId    已生成的 trace UUID
   * @param rootSpanId 根 LLM span 的 UUID（用于 tool span 的 parent_span_id）
   * @returns          FireflySpan 列表，顺序：[llmSpan, ...toolSpans]
   */
  static buildSpans(
    turn: OpenClawTurn,
    traceId: string,
    rootSpanId: string
  ): FireflySpan[] {
    const spans: FireflySpan[] = [];

    // ── LLM Chat Span ──────────────────────────────────────
    const llmSpan = SpanBuilder.buildLlmSpan(turn, traceId, rootSpanId);
    spans.push(llmSpan);

    // ── Tool Call Spans ────────────────────────────────────
    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const tool of turn.toolCalls) {
        const toolSpan = SpanBuilder.buildToolSpan(
          tool,
          traceId,
          rootSpanId, // parent = llm span
          turn,
          turn.timestamp
        );
        spans.push(toolSpan);
      }
    }

    return spans;
  }

  // ──────────────────────────────────────────
  // LLM Chat Span
  // ──────────────────────────────────────────

  /**
   * 构建 gen_ai.chat 类型的 LLM Span。
   * input  = 发送给模型的 messages
   * output = assistant 最终回复
   */
  static buildLlmSpan(
    turn: OpenClawTurn,
    traceId: string,
    spanId: string
  ): FireflySpan {
    const { provider, model, messages, usage, latencyMs, timestamp, stopReason } = turn;

    // 构造 input：过滤掉 system 之外的 messages，发给模型的全量
    const inputMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    }));

    // 构造 output：assistant 最后一条消息
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");

    const startIso = toIso(timestamp);
    const endTimestamp = turn.endTimestamp ?? timestamp + latencyMs;
    const endIso = toIso(endTimestamp);

    const status: FireflyStatus = turn.error ? "error" : "ok";
    const correlationMetadata = buildCorrelationMetadata(turn, traceId);

    return {
      span_id: spanId,
      parent_span_id: null,
      trace_id: traceId,
      type: "gen_ai.chat",
      name: `${provider}/${model}`,
      model,
      provider,
      input: {
        messages: inputMessages,
      },
      output: lastAssistant
        ? { content: lastAssistant.content, role: "assistant" }
        : null,
      tokens_input: usage?.input ?? null,
      tokens_output: usage?.output ?? null,
      cost: null, // 成本由后端根据模型定价计算
      latency_ms: latencyMs,
      first_token_latency_ms: turn.firstTokenLatencyMs ?? null,
      status,
      status_message: turn.error ?? null,
      metadata: {
        ...correlationMetadata,
        stop_reason: stopReason ?? null,
        message_count: messages.length,
      },
      timestamp_start: startIso,
      timestamp_end: endIso,
    };
  }

  // ──────────────────────────────────────────
  // Tool Call Span
  // ──────────────────────────────────────────

  /**
   * 构建 gen_ai.tool 类型的工具调用 Span。
   * input  = 工具调用参数
   * output = 工具返回结果
   */
  static buildToolSpan(
    tool: OpenClawToolCall,
    traceId: string,
    parentSpanId: string,
    turn: OpenClawTurn,
    turnStartTimestamp: number
  ): FireflySpan {
    const spanId = crypto.randomUUID();

    // 时间戳：优先用 tool 自身的时间戳，否则近似为 turn 开始时间
    const startMs = tool.startedAt ?? turnStartTimestamp;
    const endMs = tool.endedAt ?? (tool.latencyMs ? startMs + tool.latencyMs : null);

    const status = toolStatus(tool);
    const correlationMetadata = buildCorrelationMetadata(turn, traceId);

    // 将 args 安全地包装为 Record
    const inputRecord: Record<string, unknown> =
      tool.args && typeof tool.args === "object"
        ? tool.args
        : { _raw: tool.args };

    // 将 result 安全地包装为 Record
    let outputRecord: Record<string, unknown> | null = null;
    if (tool.result !== undefined && tool.result !== null) {
      if (typeof tool.result === "object") {
        outputRecord = tool.result as Record<string, unknown>;
      } else {
        outputRecord = { _raw: tool.result };
      }
    }

    return {
      span_id: spanId,
      parent_span_id: parentSpanId,
      trace_id: traceId,
      type: "gen_ai.tool",
      name: tool.name,
      model: null,
      provider: null,
      input: inputRecord,
      output: outputRecord,
      tokens_input: null,
      tokens_output: null,
      cost: null,
      latency_ms: tool.latencyMs ?? null,
      first_token_latency_ms: null,
      status,
      status_message: tool.error ?? null,
      metadata: {
        ...correlationMetadata,
        tool_name: tool.name,
      },
      timestamp_start: toIso(startMs),
      timestamp_end: endMs ? toIso(endMs) : null,
    };
  }
}
