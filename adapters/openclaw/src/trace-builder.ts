/**
 * @fileoverview TraceBuilder
 *
 * 将 OpenClaw Agent 的一条 turn 映射为 Firefly TraceIngest 对象。
 *
 * 映射规则摘要：
 *  trace.trace_id     = crypto.randomUUID()
 *  trace.session_id   = turn.sessionKey
 *  trace.user_id      = turn.userId
 *  trace.name         = "{channel}:{agentId}"
 *  trace.input        = { content: <用户最后一条消息> }
 *  trace.output       = { content: <assistant 最终回复> }
 *  trace.metadata     = { platform: "openclaw", agentId, channel, sessionKey, ... }
 *  trace.total_tokens = usage.total
 *  trace.latency_ms   = latencyMs
 *  trace.spans        = [llmSpan, ...toolSpans]
 */

import type {
  OpenClawTurn,
  OpenClawMessage,
  FireflyTrace,
  FireflyStatus,
} from "./types.js";
import { buildCorrelationMetadata } from "./correlation.js";
import { SpanBuilder } from "./span-builder.js";

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/** 将 Unix ms 时间戳转为 ISO 8601 字符串 */
function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

/**
 * 从消息列表中提取用户最后一条消息内容。
 * 找不到时返回 null。
 */
function extractLastUserMessage(messages: OpenClawMessage[]): string | null {
  const reversed = [...messages].reverse();
  const userMsg = reversed.find((m) => m.role === "user");
  return userMsg?.content ?? null;
}

/**
 * 从消息列表中提取 assistant 最后一条消息内容。
 * 找不到时返回 null。
 */
function extractLastAssistantMessage(messages: OpenClawMessage[]): string | null {
  const reversed = [...messages].reverse();
  const assistantMsg = reversed.find((m) => m.role === "assistant");
  return assistantMsg?.content ?? null;
}

/**
 * 对长文本做截断摘要（用于 trace.name）。
 * 超过 maxLen 时在末尾加 "..."。
 */
function truncate(text: string, maxLen = 60): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// ─────────────────────────────────────────────
// TraceBuilder
// ─────────────────────────────────────────────

export interface TraceBuilderOptions {
  /** Firefly project_id（UUID） */
  projectId: string;
  /** 额外 metadata，merge 到每条 trace */
  defaultMetadata?: Record<string, unknown>;
  /** 默认 tags */
  defaultTags?: string[];
}

export class TraceBuilder {
  private readonly projectId: string;
  private readonly defaultMetadata: Record<string, unknown>;
  private readonly defaultTags: string[];

  constructor(options: TraceBuilderOptions) {
    this.projectId = options.projectId;
    this.defaultMetadata = options.defaultMetadata ?? {};
    this.defaultTags = options.defaultTags ?? [];
  }

  /**
   * 将一条 OpenClawTurn 转为 FireflyTrace（含嵌套 Spans）。
   *
   * @param turn        OpenClaw turn 数据
   * @param extraMeta   本次额外补充的 metadata（可选）
   */
  build(
    turn: OpenClawTurn,
    extraMeta?: Record<string, unknown>
  ): FireflyTrace {
    // ── 生成 ID ────────────────────────────────────────────
    const traceId = crypto.randomUUID();
    const rootSpanId = crypto.randomUUID();

    // ── 时间 ───────────────────────────────────────────────
    const startMs = turn.timestamp;
    const endMs = turn.endTimestamp ?? startMs + turn.latencyMs;

    // ── Trace 名称 ─────────────────────────────────────────
    // 优先用 "{channel}:{agentId}"，再拼接用户消息摘要便于识别
    const lastUserMsg = extractLastUserMessage(turn.messages);
    const baseName = `${turn.channel}:${turn.agentId}`;
    const traceName = lastUserMsg
      ? `${baseName} — ${truncate(lastUserMsg)}`
      : baseName;

    // ── Input / Output ─────────────────────────────────────
    const inputContent = lastUserMsg;
    const outputContent = extractLastAssistantMessage(turn.messages);

    // ── 状态 & 错误计数 ────────────────────────────────────
    const status: FireflyStatus = turn.error ? "error" : "ok";
    const errorCount = turn.error ? 1 : 0;

    // ── Spans ──────────────────────────────────────────────
    const spans = SpanBuilder.buildSpans(turn, traceId, rootSpanId);
    const spanCount = spans.length;

    // ── Metadata ───────────────────────────────────────────
    const correlationMetadata = buildCorrelationMetadata(turn, traceId);
    const metadata: Record<string, unknown> = {
      // 平台标识（Firefly 侧过滤用）
      platform: "openclaw",
      // OpenClaw 字段
      agentId: turn.agentId,
      channel: turn.channel,
      sessionKey: turn.sessionKey,
      provider: turn.provider,
      model: turn.model,
      stop_reason: turn.stopReason ?? null,
      ...correlationMetadata,
      // 覆盖顺序：defaultMetadata < extraMeta < turn.extra
      ...this.defaultMetadata,
      ...(extraMeta ?? {}),
      ...(turn.extra ?? {}),
    };

    // ── Tags ───────────────────────────────────────────────
    const tags: string[] = [
      ...this.defaultTags,
      `channel:${turn.channel}`,
      `agent:${turn.agentId}`,
      `provider:${turn.provider}`,
      `model:${turn.model}`,
    ];

    // ── 组装 TraceIngest ────────────────────────────────────
    const trace: FireflyTrace = {
      trace_id: traceId,
      project_id: turn.projectId ?? this.projectId,
      session_id: turn.sessionKey ?? null,
      user_id: turn.userId ?? null,
      name: traceName,
      input: inputContent ? { content: inputContent } : null,
      output: outputContent ? { content: outputContent } : null,
      timestamp_start: toIso(startMs),
      timestamp_end: toIso(endMs),
      latency_ms: turn.latencyMs,
      total_tokens: turn.usage?.total ?? 0,
      total_cost: 0, // 成本由后端根据模型定价计算
      span_count: spanCount,
      error_count: errorCount,
      status,
      metadata,
      tags,
      spans,
    };

    return trace;
  }
}
