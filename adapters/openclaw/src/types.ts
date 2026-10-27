/**
 * @fileoverview Firefly OpenClaw Adapter — Type Definitions
 *
 * 包含三组类型：
 *  1. OpenClawTurn   — 从 OpenClaw 平台接收的原始 turn 数据结构
 *  2. FireflyTrace / FireflySpan — 发送给 Firefly Ingestion API 的数据结构
 *  3. Adapter 配置 & 返回值
 */

// ─────────────────────────────────────────────
// § 1. OpenClaw 原始 Turn 数据结构
// ─────────────────────────────────────────────

/** 单条 LLM 对话消息 */
export interface OpenClawMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** tool_call_id (当 role="tool" 时) */
  tool_call_id?: string;
  /** tool 名称 (当 role="tool" 时) */
  name?: string;
}

/** 单次工具调用记录 */
export interface OpenClawToolCall {
  /** 工具名称，例如 "web_search" */
  name: string;
  /** 工具输入参数 */
  args: Record<string, unknown>;
  /** 工具执行结果（可选，执行完才有） */
  result?: unknown;
  /** 工具调用耗时 (ms) */
  latencyMs?: number;
  /** 工具调用开始时间戳 (Unix ms) */
  startedAt?: number;
  /** 工具调用结束时间戳 (Unix ms) */
  endedAt?: number;
  /** 工具调用状态 */
  status?: "ok" | "error";
  /** 错误信息 */
  error?: string;
}

/** Token 用量 */
export interface OpenClawUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * OpenClaw Agent 一次完整 turn 的数据结构。
 * 对应 openclaw.on("turnEnd", ...) 回调中的 turn 对象。
 */
export interface OpenClawTurn {
  /** Stable per-user-turn id, if OpenClaw exposes one. */
  turnId?: string;
  /** Stable request id shared by spans/events in one request, if available. */
  requestId?: string;
  /** Stable run id shared by spans/events in one agent run, if available. */
  runId?: string;
  /** Stable message id for the triggering user message, if available. */
  messageId?: string;
  /** Adapter-provided correlation id fallback. */
  correlationId?: string;
  /** OpenClaw 内部会话标识（跨 turn 持久化） */
  sessionKey: string;
  /** Agent ID */
  agentId: string;
  /** 消息来源渠道，例如 "webchat" / "lark" / "wechat" */
  channel: string;
  /** LLM Provider，例如 "deepseek" / "openai" / "qwen" */
  provider: string;
  /** 模型名称，例如 "deepseek-v4-pro" */
  model: string;
  /** 本次 turn 的完整消息列表 */
  messages: OpenClawMessage[];
  /** 工具调用列表（可选） */
  toolCalls?: OpenClawToolCall[];
  /** Token 用量（可选） */
  usage?: OpenClawUsage;
  /** 总耗时 (ms) */
  latencyMs: number;
  /** Turn 开始时间戳 (Unix ms) */
  timestamp: number;
  /** Turn 结束时间戳 (Unix ms)，可选 */
  endTimestamp?: number;
  /** 首 token 延迟 (ms)，可选 */
  firstTokenLatencyMs?: number;
  /** 停止原因，例如 "stop" / "length" / "tool_calls" */
  stopReason?: string;
  /** 用户 ID（可选） */
  userId?: string;
  /** 是否发生错误 */
  error?: string;
  /** 所属 project ID（Firefly 侧） */
  projectId?: string;
  /** 额外元数据 */
  extra?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// § 2. Firefly Ingestion API 数据结构
// ─────────────────────────────────────────────

/** Trace 状态枚举 */
export type FireflyStatus = "ok" | "error" | "running";

/** Span 类型枚举 */
export type FireflySpanType =
  | "gen_ai.chat"
  | "gen_ai.tool"
  | "gen_ai.retrieval"
  | "gen_ai.embedding"
  | string;

/**
 * 对应后端 SpanIngest schema
 */
export interface FireflySpan {
  span_id: string;
  parent_span_id?: string | null;
  trace_id: string;
  type: FireflySpanType;
  name: string;
  model?: string | null;
  provider?: string | null;
  /** 输入数据（JSONB） */
  input?: Record<string, unknown> | null;
  /** 输出数据（JSONB） */
  output?: Record<string, unknown> | null;
  tokens_input?: number | null;
  tokens_output?: number | null;
  cost?: number | null;
  latency_ms?: number | null;
  first_token_latency_ms?: number | null;
  status: FireflyStatus;
  status_message?: string | null;
  metadata?: Record<string, unknown> | null;
  /** ISO 8601 datetime string */
  timestamp_start?: string | null;
  /** ISO 8601 datetime string */
  timestamp_end?: string | null;
}

/**
 * 对应后端 TraceIngest schema
 */
export interface FireflyTrace {
  trace_id: string;
  project_id: string;
  session_id?: string | null;
  user_id?: string | null;
  name: string;
  /** 输入数据（JSONB） */
  input?: Record<string, unknown> | null;
  /** 输出数据（JSONB） */
  output?: Record<string, unknown> | null;
  /** ISO 8601 datetime string */
  timestamp_start: string;
  /** ISO 8601 datetime string */
  timestamp_end?: string | null;
  latency_ms?: number | null;
  total_tokens: number;
  total_cost: number;
  span_count: number;
  error_count: number;
  status: FireflyStatus;
  metadata?: Record<string, unknown> | null;
  tags?: string[] | null;
  /** 嵌套 spans（原子写入） */
  spans?: FireflySpan[] | null;
}

// ─────────────────────────────────────────────
// § 3. Adapter 配置 & 返回值
// ─────────────────────────────────────────────

/** FireflyClient 构造参数 */
export interface FireflyClientOptions {
  /** Firefly 后端 base URL，例如 "http://localhost:8000" */
  baseUrl: string;
  /** Ingest API Key */
  apiKey: string;
  /**
   * 网络错误最大重试次数
   * @default 3
   */
  maxRetries?: number;
  /**
   * 重试初始间隔 (ms)，指数退避
   * @default 500
   */
  retryDelayMs?: number;
  /**
   * 请求超时 (ms)
   * @default 10000
   */
  timeoutMs?: number;
}

/** createAdapter 工厂函数参数 */
export interface CreateAdapterOptions extends FireflyClientOptions {
  /**
   * 默认 Firefly project_id（必填）。
   * 可被 OpenClawTurn.projectId 字段覆盖。
   */
  defaultProjectId: string;
  /**
   * 额外的 trace metadata（会被 merge 到每条 trace）
   */
  defaultMetadata?: Record<string, unknown>;
  /**
   * 默认 tags
   */
  defaultTags?: string[];
  /**
   * 是否在控制台打印 debug 日志
   * @default false
   */
  debug?: boolean;
}

/** ingestTrace / ingestSpan 操作结果 */
export interface IngestResult {
  success: boolean;
  traceId?: string;
  /** HTTP 状态码（成功时） */
  statusCode?: number;
  /** 错误信息（失败时） */
  error?: string;
}

/** Adapter 实例接口 */
export interface FireflyAdapter {
  /**
   * OpenClaw turnEnd 钩子处理函数。
   * 将 OpenClawTurn 转为 Trace + Spans 并上报到 Firefly。
   */
  onTurnEnd(turn: OpenClawTurn): Promise<IngestResult>;

  /** 底层 FireflyClient，供高级用例直接调用 */
  client: {
    ingestTrace(trace: FireflyTrace): Promise<IngestResult>;
    ingestSpan(span: FireflySpan): Promise<IngestResult>;
  };
}
