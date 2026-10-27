/**
 * @fileoverview Firefly HTTP Ingestion Client
 *
 * 封装对 Firefly 后端以下两个接口的调用：
 *  - POST /api/v1/ingest/trace
 *  - POST /api/v1/ingest/span
 *
 * 特性：
 *  - 自动重试（指数退避，最多 maxRetries 次）
 *  - 超时控制（AbortController）
 *  - 网络失败不抛异常，返回 IngestResult 错误对象
 *  - 完整的错误日志
 */

import type {
  FireflyClientOptions,
  FireflyTrace,
  FireflySpan,
  IngestResult,
} from "./types.js";

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 指数退避延迟：delay * 2^attempt，加入少量抖动 */
function backoffMs(baseMs: number, attempt: number): number {
  const exp = Math.pow(2, attempt) * baseMs;
  const jitter = Math.random() * 100; // 0~100ms 抖动
  return exp + jitter;
}

// ─────────────────────────────────────────────
// FireflyClient
// ─────────────────────────────────────────────

export class FireflyClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(options: FireflyClientOptions) {
    // 去除末尾斜杠，保持 URL 一致性
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  // ──────────────────────────────────────────
  // 公共 API
  // ──────────────────────────────────────────

  /**
   * 上报完整 Trace（含嵌套 Spans，原子写入）。
   * 对应 POST /api/v1/ingest/trace
   */
  async ingestTrace(trace: FireflyTrace): Promise<IngestResult> {
    return this.postWithRetry("/api/v1/ingest/trace", trace, trace.trace_id);
  }

  /**
   * 上报单个 Span。
   * 对应 POST /api/v1/ingest/span
   */
  async ingestSpan(span: FireflySpan): Promise<IngestResult> {
    return this.postWithRetry("/api/v1/ingest/span", span, span.trace_id);
  }

  // ──────────────────────────────────────────
  // 内部实现
  // ──────────────────────────────────────────

  /**
   * 带重试的 POST 请求核心逻辑。
   * 仅对网络错误 / 5xx 重试；4xx 直接返回失败（客户端问题，重试无意义）。
   */
  private async postWithRetry(
    path: string,
    body: unknown,
    traceId?: string
  ): Promise<IngestResult> {
    const url = `${this.baseUrl}${path}`;
    const bodyStr = JSON.stringify(body);

    let lastError: string = "Unknown error";

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // 第 2 次及以后才等待退避
      if (attempt > 0) {
        const delay = backoffMs(this.retryDelayMs, attempt - 1);
        console.warn(
          `[Firefly] Retry attempt ${attempt}/${this.maxRetries} for ${path} in ${Math.round(delay)}ms`
        );
        await sleep(delay);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Firefly-Key": this.apiKey,
            "User-Agent": "@firefly/adapter-openclaw/0.1.0",
          },
          body: bodyStr,
          signal: controller.signal,
        });

        clearTimeout(timer);

        // 4xx — 不重试，直接返回错误
        if (response.status >= 400 && response.status < 500) {
          const text = await response.text().catch(() => "(empty body)");
          const errorMsg = `HTTP ${response.status}: ${text}`;
          console.warn(`[Firefly] Client error at ${path}: ${errorMsg}`);
          return {
            success: false,
            traceId,
            statusCode: response.status,
            error: errorMsg,
          };
        }

        // 5xx — 记录错误后重试
        if (response.status >= 500) {
          const text = await response.text().catch(() => "(empty body)");
          lastError = `HTTP ${response.status}: ${text}`;
          console.warn(
            `[Firefly] Server error at ${path} (attempt ${attempt + 1}): ${lastError}`
          );
          continue;
        }

        // 2xx — 成功
        return {
          success: true,
          traceId,
          statusCode: response.status,
        };
      } catch (err: unknown) {
        clearTimeout(timer);

        if (err instanceof Error && err.name === "AbortError") {
          lastError = `Request timed out after ${this.timeoutMs}ms`;
        } else if (err instanceof Error) {
          lastError = err.message;
        } else {
          lastError = String(err);
        }

        console.warn(
          `[Firefly] Network error at ${path} (attempt ${attempt + 1}): ${lastError}`
        );
        // 网络错误继续重试
      }
    }

    // 所有重试耗尽
    console.warn(
      `[Firefly] All ${this.maxRetries + 1} attempts failed for ${path}. Last error: ${lastError}`
    );
    return {
      success: false,
      traceId,
      error: `Exhausted ${this.maxRetries + 1} attempts. Last: ${lastError}`,
    };
  }
}
