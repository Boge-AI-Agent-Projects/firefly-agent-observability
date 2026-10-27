/**
 * @fileoverview @firefly/adapter-openclaw — 入口
 *
 * 导出：
 *  - FireflyClient   — 底层 HTTP 客户端
 *  - TraceBuilder    — Turn → Trace/Span 映射器
 *  - SpanBuilder     — Span 构建工具类
 *  - createAdapter   — 一键创建即用型 Adapter（推荐）
 *  - 所有 TypeScript 类型
 *
 * 推荐用法（OpenClaw 集成）：
 * ```ts
 * import { createAdapter } from "@firefly/adapter-openclaw";
 *
 * const adapter = createAdapter({
 *   baseUrl: process.env.FIREFLY_BASE_URL!,
 *   apiKey: process.env.FIREFLY_API_KEY!,
 *   defaultProjectId: process.env.FIREFLY_PROJECT_ID!,
 * });
 *
 * // 在 OpenClaw turnEnd 钩子中调用：
 * openclaw.on("turnEnd", async (turn) => {
 *   const result = await adapter.onTurnEnd(turn);
 *   if (!result.success) {
 *     console.warn("[Firefly] Ingest failed:", result.error);
 *   }
 * });
 * ```
 */

// ── 核心类 ────────────────────────────────────────────────────────────────
export { FireflyClient } from "./client.js";
export { TraceBuilder } from "./trace-builder.js";
export { SpanBuilder } from "./span-builder.js";

// ── 所有类型 ──────────────────────────────────────────────────────────────
export type {
  // OpenClaw 原始数据
  OpenClawTurn,
  OpenClawMessage,
  OpenClawToolCall,
  OpenClawUsage,
  // Firefly API 数据
  FireflyTrace,
  FireflySpan,
  FireflyStatus,
  FireflySpanType,
  // 配置 & 返回值
  FireflyClientOptions,
  CreateAdapterOptions,
  IngestResult,
  FireflyAdapter,
} from "./types.js";

// ── createAdapter 工厂函数 ─────────────────────────────────────────────────
import { FireflyClient } from "./client.js";
import { TraceBuilder } from "./trace-builder.js";
import type {
  CreateAdapterOptions,
  OpenClawTurn,
  IngestResult,
  FireflyTrace,
  FireflySpan,
  FireflyAdapter,
} from "./types.js";

/**
 * 创建即用型 Firefly Adapter 实例。
 *
 * 该 adapter 将 OpenClaw turn 数据自动映射为 Firefly Trace + Spans
 * 并通过 HTTP 上报到 Firefly 后端。
 *
 * @example
 * ```ts
 * const adapter = createAdapter({
 *   baseUrl: "http://localhost:8000",
 *   apiKey: "changeme-secret-key",
 *   defaultProjectId: "your-project-uuid",
 *   debug: true,
 * });
 * ```
 */
export function createAdapter(options: CreateAdapterOptions): FireflyAdapter {
  const {
    baseUrl,
    apiKey,
    maxRetries,
    retryDelayMs,
    timeoutMs,
    defaultProjectId,
    defaultMetadata,
    defaultTags,
    debug = false,
  } = options;

  // 初始化 HTTP 客户端
  const client = new FireflyClient({
    baseUrl,
    apiKey,
    maxRetries,
    retryDelayMs,
    timeoutMs,
  });

  // 初始化 Trace 构建器
  const traceBuilder = new TraceBuilder({
    projectId: defaultProjectId,
    defaultMetadata,
    defaultTags,
  });

  /**
   * 处理 OpenClaw turnEnd 事件。
   * 构建 Trace + Spans 并原子上报。
   */
  async function onTurnEnd(turn: OpenClawTurn): Promise<IngestResult> {
    if (debug) {
      console.debug(
        `[Firefly] onTurnEnd: sessionKey=${turn.sessionKey} agent=${turn.agentId} channel=${turn.channel}`
      );
    }

    let trace: FireflyTrace;
    try {
      trace = traceBuilder.build(turn);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Firefly] TraceBuilder.build failed: ${msg}`);
      return { success: false, error: `TraceBuilder error: ${msg}` };
    }

    if (debug) {
      console.debug(
        `[Firefly] Built trace_id=${trace.trace_id} spans=${trace.span_count}`
      );
    }

    const result = await client.ingestTrace(trace);

    if (debug) {
      if (result.success) {
        console.debug(`[Firefly] Ingested trace_id=${result.traceId} ✓`);
      } else {
        console.debug(`[Firefly] Ingest failed: ${result.error}`);
      }
    }

    return result;
  }

  return {
    onTurnEnd,
    client: {
      ingestTrace: (trace: FireflyTrace) => client.ingestTrace(trace),
      ingestSpan: (span: FireflySpan) => client.ingestSpan(span),
    },
  };
}
