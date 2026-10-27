# @firefly/adapter-openclaw

> **萤火 Firefly** × OpenClaw 可观测性 Adapter
>
> 将 OpenClaw Agent 的 turn 运行数据自动映射为 Firefly Trace + Span，通过 HTTP 上报到 Firefly 后端。

---

## 快速开始

### 1. 安装

```bash
# 从本地路径引用（Monorepo 内）
npm install ./adapters/openclaw

# 或发布后通过 npm 安装
npm install @firefly/adapter-openclaw
```

### 2. 配置环境变量

复制并填写 `.env.example`：

```bash
cp .env.example .env
```

| 变量                | 说明                                 | 必填 |
| ------------------- | ------------------------------------ | ---- |
| `FIREFLY_BASE_URL`  | Firefly 后端地址，例如 `http://localhost:8000` | ✅   |
| `FIREFLY_API_KEY`   | Ingest API Key（控制台创建）         | ✅   |
| `FIREFLY_PROJECT_ID`| Firefly 项目 UUID（控制台复制）      | ✅   |
| `FIREFLY_DEBUG`     | 开启 debug 日志（`true`/`false`）    | ❌   |

### 3. 在 OpenClaw 中集成

```typescript
import { createAdapter } from "@firefly/adapter-openclaw";

// 创建 adapter 实例（应用启动时初始化一次）
const adapter = createAdapter({
  baseUrl: process.env.FIREFLY_BASE_URL!,
  apiKey: process.env.FIREFLY_API_KEY!,
  defaultProjectId: process.env.FIREFLY_PROJECT_ID!,
  debug: process.env.FIREFLY_DEBUG === "true",
  // 可选：全局附加 metadata
  defaultMetadata: {
    env: "production",
    version: "1.0.0",
  },
  // 可选：全局附加 tags
  defaultTags: ["platform:openclaw"],
});

// 在 OpenClaw turnEnd 钩子中调用
openclaw.on("turnEnd", async (turn) => {
  const result = await adapter.onTurnEnd(turn);
  if (!result.success) {
    console.warn("[Firefly] Ingest failed:", result.error);
  }
});
```

---

## 数据映射说明

### OpenClawTurn → FireflyTrace

| OpenClawTurn 字段    | Firefly Trace 字段         | 说明                           |
| -------------------- | -------------------------- | ------------------------------ |
| `sessionKey`         | `session_id`               | 跨 turn 的会话 ID              |
| `userId`             | `user_id`                  | 用户标识（可选）               |
| `channel:agentId`    | `name`                     | 格式：`{channel}:{agentId} — {用户消息摘要}` |
| 最后一条 user 消息   | `input.content`            | 用户输入                       |
| 最后一条 assistant 消息 | `output.content`        | Agent 回复                     |
| `latencyMs`          | `latency_ms`               | 总耗时                         |
| `usage.total`        | `total_tokens`             | 总 Token 数                    |
| `agentId, channel` 等 | `metadata`                | 平台标识与运行环境信息         |

### Span 生成规则

每次 turn 生成以下 Spans：

1. **`gen_ai.chat`**（根 Span）— LLM 推理调用
   - `input`：完整消息列表
   - `output`：assistant 最终回复
   - `tokens_input / tokens_output`：token 用量

2. **`gen_ai.tool`**（子 Span，每个工具调用一条）
   - `parent_span_id` → 指向 LLM Span
   - `input`：工具调用参数
   - `output`：工具返回结果
   - `latency_ms`：工具执行耗时

---

## API 参考

### `createAdapter(options)` — 推荐

工厂函数，返回 `FireflyAdapter` 实例。

```typescript
interface CreateAdapterOptions {
  baseUrl: string;           // Firefly 后端地址
  apiKey: string;            // Ingest API Key
  defaultProjectId: string;  // 默认项目 UUID
  maxRetries?: number;       // 最大重试次数，默认 3
  retryDelayMs?: number;     // 首次重试等待 (ms)，默认 500，指数退避
  timeoutMs?: number;        // 请求超时 (ms)，默认 10000
  defaultMetadata?: Record<string, unknown>;  // 全局附加 metadata
  defaultTags?: string[];    // 全局附加 tags
  debug?: boolean;           // 是否打印 debug 日志，默认 false
}
```

返回的 `FireflyAdapter`：

```typescript
interface FireflyAdapter {
  // OpenClaw turnEnd 钩子处理函数
  onTurnEnd(turn: OpenClawTurn): Promise<IngestResult>;

  // 底层客户端，供高级用例直接调用
  client: {
    ingestTrace(trace: FireflyTrace): Promise<IngestResult>;
    ingestSpan(span: FireflySpan): Promise<IngestResult>;
  };
}
```

### `FireflyClient` — 底层客户端

直接封装 Firefly Ingestion API，支持自定义重试策略。

```typescript
const client = new FireflyClient({
  baseUrl: "http://localhost:8000",
  apiKey: "changeme-secret-key",
  maxRetries: 3,
  retryDelayMs: 500,
  timeoutMs: 10000,
});

await client.ingestTrace(trace);
await client.ingestSpan(span);
```

### `TraceBuilder` — 手动构建 Trace

```typescript
const builder = new TraceBuilder({
  projectId: "your-project-uuid",
  defaultMetadata: { env: "prod" },
  defaultTags: ["custom:tag"],
});

const trace = builder.build(turn, { extra_field: "value" });
```

---

## 错误处理

Adapter **不会抛出异常**。所有错误通过返回值传递：

```typescript
const result = await adapter.onTurnEnd(turn);

if (!result.success) {
  console.error("上报失败:", result.error);
  // result.statusCode 为 HTTP 状态码（网络成功时）
}
```

**重试策略**：
- 网络错误、5xx：最多重试 `maxRetries` 次，指数退避（含随机抖动）
- 4xx：直接返回失败，不重试（客户端配置问题）
- 超时：由 `AbortController` 控制，归为网络错误，参与重试

---

## 构建

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 监听模式
npm run build:watch
```

---

## 目录结构

```
adapters/openclaw/
├── src/
│   ├── index.ts           # 入口，导出 FireflyClient / createAdapter / 所有类型
│   ├── client.ts          # HTTP 客户端，封装 POST /api/v1/ingest/trace|span
│   ├── trace-builder.ts   # OpenClawTurn → FireflyTrace 映射
│   ├── span-builder.ts    # gen_ai.chat / gen_ai.tool Span 构建
│   └── types.ts           # 所有 TypeScript 类型定义
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 版本历史

| 版本  | 说明                      |
| ----- | ------------------------- |
| 0.1.0 | 初始版本，支持 Trace + Span 原子写入，LLM & Tool Span 生成 |
