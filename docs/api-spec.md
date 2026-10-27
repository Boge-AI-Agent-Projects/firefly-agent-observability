# 萤火 Firefly — Phase 1 API 接口规范

> **版本**: v1.0
> **日期**: 2026-06-03
> **状态**: 历史设计草案
> **Base URL**: `http://localhost:8000`
> **内容类型**: `application/json; charset=utf-8`

> 本文保留 Phase 1 的接口设计过程，部分示例可能领先于当前实现。
> 运行时接口以 `/docs` 生成的 OpenAPI 文档和 `backend/app/api/` 为准。

---

## 目录

1. [概述](#1-概述)
2. [通用约定](#2-通用约定)
3. [Ingestion API — 数据摄入](#3-ingestion-api--数据摄入)
4. [Query API — 数据查询](#4-query-api--数据查询)
5. [Prompt API — Prompt 管理](#5-prompt-api--prompt-管理)
6. [Project API — 项目管理](#6-project-api--项目管理)
7. [错误码](#7-错误码)
8. [认证](#8-认证)

---

## 1. 概述

萤火 Firefly API 分为四大模块：

| 模块 | 前缀 | 用途 | 吞吐要求 |
|------|------|------|:---:|
| **Ingestion** | `/api/v1/ingest` | Adapter → Firefly 数据写入 | 高（批量写入） |
| **Query** | `/api/v1` | UI / 外部系统查询 | 中 |
| **Prompt** | `/api/v1/prompts` | Prompt 模板版本管理 | 低 |
| **Project** | `/api/v1/projects` | 项目管理（CRUD） | 低 |

---

## 2. 通用约定

### 2.1 时间格式

所有时间字段使用 **ISO 8601 + 时区偏移**：

```
"2026-06-03T07:30:00.000+08:00"
```

### 2.2 分页

```json
// 请求
GET /api/v1/traces?page=1&page_size=50

// 响应
{
  "data": [...],
  "pagination": {
    "page": 1,
    "page_size": 50,
    "total": 230,
    "total_pages": 5
  }
}
```

| 参数 | 默认 | 最大 | 说明 |
|------|:---:|:---:|------|
| `page` | 1 | — | 页码（1-based） |
| `page_size` | 50 | 200 | 每页条数 |

### 2.3 排序

```
GET /api/v1/traces?sort_by=timestamp_start&sort_order=desc
```

| 参数 | 默认 | 说明 |
|------|:---:|------|
| `sort_by` | `timestamp_start` | 排序字段 |
| `sort_order` | `desc` | `asc` / `desc` |

### 2.4 字段筛选

```
GET /api/v1/traces?fields=id,name,total_tokens,total_cost,metadata.platform
```

使用逗号分隔的字段列表。支持 `metadata.platform` 这种嵌套路径。

---

## 3. Ingestion API — 数据摄入

### 3.1 `POST /api/v1/ingest/trace` — 摄入完整 Trace（含 Spans）

一次性写入一条 Trace 及其所有 Span。适合批量摄入场景。

**Request:**

```json
{
  "trace": {
    "id": "01938000-0000-7000-0000-000000000001",
    "project_id": "01938000-0000-7000-0000-000000000100",
    "session_id": "sess_chat_20260603_001",
    "user_id": "user_demo",
    "name": "查询订单状态",
    "tags": ["production", "customer-support"],
    "input": {
      "messages": [{"role": "user", "content": "帮我查一下订单 #12345 的状态"}]
    },
    "output": {
      "content": "您的订单 #12345 当前状态：已发货，预计 6 月 5 日送达。"
    },
    "timestamp_start": "2026-06-03T07:30:00.000+08:00",
    "timestamp_end": "2026-06-03T07:30:02.500+08:00",
    "latency_ms": 2500,
    "total_tokens": 450,
    "total_cost": 0.0009,
    "span_count": 3,
    "error_count": 0,
    "metadata": {
      "platform": "openclaw",
      "platform_version": "2026.5.7",
      "adapter_version": "0.1.0",
      "source_trace_id": "openclaw_turn_abc123",
      "deployment": {
        "region": "cn-hangzhou",
        "server": "alibaba-ecs-01"
      }
    }
  },
  "spans": [
    {
      "id": "01938000-0000-7001-0000-000000000001",
      "parent_span_id": null,
      "type": "gen_ai.agent",
      "name": "agent 小架",
      "input": {
        "messages": [{"role": "user", "content": "帮我查一下订单 #12345 的状态"}]
      },
      "output": {
        "content": "您的订单 #12345 当前状态：已发货，预计 6 月 5 日送达。"
      },
      "latency_ms": 2500,
      "status": "ok",
      "timestamp_start": "2026-06-03T07:30:00.000+08:00",
      "timestamp_end": "2026-06-03T07:30:02.500+08:00",
      "metadata": {"platform": "openclaw"}
    },
    {
      "id": "01938000-0000-7001-0000-000000000002",
      "parent_span_id": "01938000-0000-7001-0000-000000000001",
      "type": "gen_ai.chat",
      "name": "chat deepseek-v4-pro",
      "model": "deepseek-v4-pro",
      "provider": "deepseek",
      "model_parameters": {
        "temperature": 0.7,
        "max_tokens": 4096
      },
      "input": {
        "messages": [
          {"role": "system", "content": "你是订单查询助手..."},
          {"role": "user", "content": "帮我查一下订单 #12345 的状态"}
        ]
      },
      "output": {
        "content": "好的，我来查询订单状态。",
        "finish_reason": "stop"
      },
      "tokens_input": 120,
      "tokens_output": 30,
      "cost": 0.0003,
      "latency_ms": 800,
      "first_token_latency_ms": 200,
      "status": "ok",
      "timestamp_start": "2026-06-03T07:30:00.200+08:00",
      "timestamp_end": "2026-06-03T07:30:01.000+08:00",
      "metadata": {
        "platform": "openclaw",
        "stream": true,
        "finish_reason": "stop"
      }
    },
    {
      "id": "01938000-0000-7001-0000-000000000003",
      "parent_span_id": "01938000-0000-7001-0000-000000000001",
      "type": "gen_ai.tool",
      "name": "query_order",
      "input": {"order_id": "12345"},
      "output": {
        "status": "shipped",
        "carrier": "顺丰速运",
        "estimated_delivery": "2026-06-05",
        "tracking_number": "SF1234567890"
      },
      "latency_ms": 120,
      "status": "ok",
      "timestamp_start": "2026-06-03T07:30:01.100+08:00",
      "timestamp_end": "2026-06-03T07:30:01.220+08:00",
      "metadata": {
        "platform": "openclaw",
        "tool_call_id": "call_abc123"
      }
    }
  ]
}
```

**Response `201 Created`:**

```json
{
  "status": "ok",
  "trace_id": "01938000-0000-7000-0000-000000000001",
  "span_count": 3,
  "ingested_at": "2026-06-03T07:30:05.123+08:00"
}
```

**Response `409 Conflict` (trace_id 已存在):**

```json
{
  "status": "error",
  "code": "TRACE_ALREADY_EXISTS",
  "message": "Trace 01938000-0000-7000-0000-000000000001 already exists. Use PATCH to update."
}
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `trace.id` | UUID | ✅ | Trace 唯一标识（16 字节，建议 UUID v7） |
| `trace.project_id` | UUID | ✅ | 所属项目 |
| `trace.session_id` | string | | 会话标识（跨 Trace 聚合键） |
| `trace.user_id` | string | | 终端用户标识 |
| `trace.name` | string | ✅ | Trace 名称 |
| `trace.tags` | string[] | | 标签 |
| `trace.input` | JSON | | 用户输入 |
| `trace.output` | JSON | | Agent 输出 |
| `trace.timestamp_start` | timestamp | ✅ | 开始时间 |
| `trace.timestamp_end` | timestamp | | 结束时间 |
| `trace.latency_ms` | int | | 端到端延迟 |
| `trace.total_tokens` | int | | 总 Token（由 Adapter 聚合，或后端 SUM spans） |
| `trace.total_cost` | float | | 总成本（由 Adapter 聚合，或后端 SUM spans） |
| `trace.span_count` | int | | Span 数量 |
| `trace.error_count` | int | | 错误 Span 数量 |
| `trace.metadata` | JSON | ✅ | 元数据（必须包含 `platform` 字段） |
| `spans[].id` | UUID | ✅ | Span 唯一标识 |
| `spans[].parent_span_id` | UUID | | 父 Span（根 Span 为 null） |
| `spans[].type` | string | ✅ | `gen_ai.chat` / `gen_ai.tool` / `gen_ai.retrieval` / `gen_ai.agent` / `gen_ai.chain` / `gen_ai.embedding` |
| `spans[].name` | string | ✅ | Span 名称 |
| `spans[].model` | string | | 模型名（`gen_ai.chat` 时必填） |
| `spans[].provider` | string | | 模型提供商 |
| `spans[].model_parameters` | JSON | | 模型参数 |
| `spans[].input` | JSON | | 结构化输入 |
| `spans[].output` | JSON | | 结构化输出 |
| `spans[].tokens_input` | int | | 输入 Token |
| `spans[].tokens_output` | int | | 输出 Token |
| `spans[].cost` | float | | 成本（美元） |
| `spans[].latency_ms` | int | | 端到端延迟 |
| `spans[].first_token_latency_ms` | int | | 首 Token 延迟 |
| `spans[].status` | string | ✅ | `ok` / `error` |
| `spans[].status_message` | string | | 错误信息 |
| `spans[].prompt_id` | UUID | | 关联 Prompt |
| `spans[].prompt_version` | int | | Prompt 版本号 |
| `spans[].timestamp_start` | timestamp | ✅ | 开始时间 |
| `spans[].timestamp_end` | timestamp | | 结束时间 |
| `spans[].metadata` | JSON | | Span 级元数据 |

---

### 3.2 `POST /api/v1/ingest/span` — 摄入单个 Span

用于实时追加 Span 场景（如流式响应中按 Span 逐步上报）。

**Request:**

```json
{
  "span": {
    "id": "01938000-0000-7001-0000-000000000004",
    "trace_id": "01938000-0000-7000-0000-000000000001",
    "parent_span_id": "01938000-0000-7001-0000-000000000001",
    "type": "gen_ai.chat",
    "name": "chat deepseek-v4-pro (follow-up)",
    "model": "deepseek-v4-pro",
    "provider": "deepseek",
    "model_parameters": {"temperature": 0.7, "max_tokens": 4096},
    "input": {
      "messages": [
        {"role": "system", "content": "你是订单查询助手..."},
        {"role": "tool", "content": "{\"status\": \"shipped\", ...}"},
        {"role": "user", "content": "请用中文回复用户"}
      ]
    },
    "output": {
      "content": "您的订单 #12345 已于 6 月 2 日发货，由顺丰速运承运（运单号 SF1234567890），预计 6 月 5 日送达。如有疑问可随时联系客服。",
      "finish_reason": "stop"
    },
    "tokens_input": 250,
    "tokens_output": 80,
    "cost": 0.00066,
    "latency_ms": 1200,
    "first_token_latency_ms": 300,
    "status": "ok",
    "timestamp_start": "2026-06-03T07:30:01.300+08:00",
    "timestamp_end": "2026-06-03T07:30:02.500+08:00",
    "metadata": {
      "platform": "openclaw",
      "stream": true,
      "finish_reason": "stop"
    }
  },
  "trace_update": {
    "total_tokens": 800,
    "total_cost": 0.00156,
    "span_count": 4,
    "timestamp_end": "2026-06-03T07:30:02.500+08:00",
    "latency_ms": 2500
  }
}
```

**Response `201 Created`:**

```json
{
  "status": "ok",
  "span_id": "01938000-0000-7001-0000-000000000004",
  "trace_updated": true,
  "ingested_at": "2026-06-03T07:30:05.456+08:00"
}
```

**`trace_update` 字段（可选，全部为可选）：**

| 字段 | 说明 |
|------|------|
| `total_tokens` | 更新 Trace 的总 Token |
| `total_cost` | 更新 Trace 的总成本 |
| `span_count` | 更新 Trace 的 Span 计数 |
| `error_count` | 更新 Trace 的错误计数 |
| `timestamp_end` | 更新 Trace 结束时间 |
| `latency_ms` | 更新 Trace 延迟 |

---

### 3.3 `POST /api/v1/ingest/batch` — 批量摄入（Phase 1 可选）

用于高吞吐场景，一次写入多条 Trace。

**Request:**

```json
{
  "traces": [
    {
      "trace": { /* trace object */ },
      "spans": [ /* span objects */ ]
    },
    {
      "trace": { /* trace object */ },
      "spans": [ /* span objects */ ]
    }
  ]
}
```

**Response `201 Created`:**

```json
{
  "status": "ok",
  "ingested": [
    {"trace_id": "01938000...0001", "span_count": 3},
    {"trace_id": "01938000...0002", "span_count": 1}
  ],
  "errors": [],
  "total_traces": 2,
  "total_spans": 4,
  "ingested_at": "2026-06-03T07:30:06.000+08:00"
}
```

---

## 4. Query API — 数据查询

### 4.1 `GET /api/v1/traces` — Trace 列表

支持分页、多平台筛选、时间范围、标签筛选。

**Query Parameters:**

| 参数 | 类型 | 默认 | 说明 |
|------|------|:---:|------|
| `project_id` | UUID | 必填 | 项目 ID |
| `platform` | string | | 平台筛选：`openclaw` / `hermes` |
| `user_id` | string | | 用户筛选 |
| `session_id` | string | | Session 筛选 |
| `from` | timestamp | | 时间范围开始 |
| `to` | timestamp | | 时间范围结束 |
| `has_error` | bool | | `true` 只显示有错误的 Trace |
| `tag` | string | | 按 Tag 筛选（精确匹配） |
| `search` | string | | `name` 和 `metadata` 全文搜索 |
| `page` | int | 1 | 页码 |
| `page_size` | int | 50 | 每页条数（max 200） |
| `sort_by` | string | `timestamp_start` | 排序字段 |
| `sort_order` | string | `desc` | `asc` / `desc` |
| `fields` | string | | 返回字段（逗号分隔） |

**Request:**

```
GET /api/v1/traces?project_id=01938000-0000-7000-0000-000000000100&platform=openclaw&from=2026-06-01T00:00:00%2B08:00&page=1&page_size=20&sort_by=timestamp_start&sort_order=desc
```

**Response `200 OK`:**

```json
{
  "data": [
    {
      "id": "01938000-0000-7000-0000-000000000001",
      "project_id": "01938000-0000-7000-0000-000000000100",
      "session_id": "sess_chat_20260603_001",
      "user_id": "user_demo",
      "name": "查询订单状态",
      "tags": ["production", "customer-support"],
      "timestamp_start": "2026-06-03T07:30:00.000+08:00",
      "timestamp_end": "2026-06-03T07:30:02.500+08:00",
      "latency_ms": 2500,
      "total_tokens": 450,
      "total_cost": 0.0009,
      "span_count": 3,
      "error_count": 0,
      "metadata": {
        "platform": "openclaw",
        "platform_version": "2026.5.7"
      }
    },
    {
      "id": "01938000-0000-7000-0000-000000000002",
      "project_id": "01938000-0000-7000-0000-000000000100",
      "session_id": "sess_chat_20260603_002",
      "user_id": "user_demo",
      "name": "生成周报",
      "tags": ["production", "automation"],
      "timestamp_start": "2026-06-03T07:25:00.000+08:00",
      "timestamp_end": "2026-06-03T07:25:03.100+08:00",
      "latency_ms": 3100,
      "total_tokens": 1200,
      "total_cost": 0.0024,
      "span_count": 2,
      "error_count": 1,
      "metadata": {
        "platform": "hermes",
        "platform_version": "0.5.0"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 142,
    "total_pages": 8
  }
}
```

---

### 4.2 `GET /api/v1/traces/{trace_id}` — Trace 详情 + 所有 Spans

**Request:**

```
GET /api/v1/traces/01938000-0000-7000-0000-000000000001
```

**Response `200 OK`:**

```json
{
  "trace": {
    "id": "01938000-0000-7000-0000-000000000001",
    "project_id": "01938000-0000-7000-0000-000000000100",
    "session_id": "sess_chat_20260603_001",
    "user_id": "user_demo",
    "name": "查询订单状态",
    "tags": ["production", "customer-support"],
    "input": {
      "messages": [{"role": "user", "content": "帮我查一下订单 #12345 的状态"}]
    },
    "output": {
      "content": "您的订单 #12345 当前状态：已发货，预计 6 月 5 日送达。"
    },
    "timestamp_start": "2026-06-03T07:30:00.000+08:00",
    "timestamp_end": "2026-06-03T07:30:02.500+08:00",
    "latency_ms": 2500,
    "total_tokens": 450,
    "total_cost": 0.0009,
    "span_count": 3,
    "error_count": 0,
    "metadata": {
      "platform": "openclaw",
      "platform_version": "2026.5.7",
      "adapter_version": "0.1.0",
      "source_trace_id": "openclaw_turn_abc123",
      "deployment": {
        "region": "cn-hangzhou",
        "server": "alibaba-ecs-01"
      }
    },
    "created_at": "2026-06-03T07:30:05.123+08:00"
  },
  "spans": [
    {
      "id": "01938000-0000-7001-0000-000000000001",
      "trace_id": "01938000-0000-7000-0000-000000000001",
      "parent_span_id": null,
      "type": "gen_ai.agent",
      "name": "agent 小架",
      "input": {
        "messages": [{"role": "user", "content": "帮我查一下订单 #12345 的状态"}]
      },
      "output": {
        "content": "您的订单 #12345 当前状态：已发货，预计 6 月 5 日送达。"
      },
      "latency_ms": 2500,
      "status": "ok",
      "timestamp_start": "2026-06-03T07:30:00.000+08:00",
      "timestamp_end": "2026-06-03T07:30:02.500+08:00",
      "metadata": {"platform": "openclaw"}
    },
    {
      "id": "01938000-0000-7001-0000-000000000002",
      "trace_id": "01938000-0000-7000-0000-000000000001",
      "parent_span_id": "01938000-0000-7001-0000-000000000001",
      "type": "gen_ai.chat",
      "name": "chat deepseek-v4-pro",
      "model": "deepseek-v4-pro",
      "provider": "deepseek",
      "model_parameters": {"temperature": 0.7, "max_tokens": 4096},
      "input": {
        "messages": [
          {"role": "system", "content": "你是订单查询助手..."},
          {"role": "user", "content": "帮我查一下订单 #12345 的状态"}
        ]
      },
      "output": {
        "content": "好的，我来查询订单状态。",
        "finish_reason": "stop"
      },
      "tokens_input": 120,
      "tokens_output": 30,
      "cost": 0.0003,
      "latency_ms": 800,
      "first_token_latency_ms": 200,
      "status": "ok",
      "timestamp_start": "2026-06-03T07:30:00.200+08:00",
      "timestamp_end": "2026-06-03T07:30:01.000+08:00",
      "metadata": {"platform": "openclaw", "stream": true, "finish_reason": "stop"}
    },
    {
      "id": "01938000-0000-7001-0000-000000000003",
      "trace_id": "01938000-0000-7000-0000-000000000001",
      "parent_span_id": "01938000-0000-7001-0000-000000000001",
      "type": "gen_ai.tool",
      "name": "query_order",
      "input": {"order_id": "12345"},
      "output": {
        "status": "shipped",
        "carrier": "顺丰速运",
        "estimated_delivery": "2026-06-05",
        "tracking_number": "SF1234567890"
      },
      "latency_ms": 120,
      "status": "ok",
      "timestamp_start": "2026-06-03T07:30:01.100+08:00",
      "timestamp_end": "2026-06-03T07:30:01.220+08:00",
      "metadata": {"platform": "openclaw", "tool_call_id": "call_abc123"}
    }
  ],
  "span_tree": {
    "id": "01938000-0000-7001-0000-000000000001",
    "type": "gen_ai.agent",
    "name": "agent 小架",
    "children": [
      {
        "id": "01938000-0000-7001-0000-000000000002",
        "type": "gen_ai.chat",
        "name": "chat deepseek-v4-pro",
        "children": []
      },
      {
        "id": "01938000-0000-7001-0000-000000000003",
        "type": "gen_ai.tool",
        "name": "query_order",
        "children": []
      }
    ]
  }
}
```

**说明：** `spans` 返回扁平列表，`span_tree` 返回树的嵌套结构，方便前端 Waterfall 视图渲染。

**Response `404 Not Found`:**

```json
{
  "status": "error",
  "code": "TRACE_NOT_FOUND",
  "message": "Trace 01938000-0000-7000-0000-000000000001 not found."
}
```

---

### 4.3 `GET /api/v1/sessions/{session_id}` — Session 聚合视图

**Request:**

```
GET /api/v1/sessions/sess_chat_20260603_001
```

**Response `200 OK`:**

```json
{
  "session": {
    "id": "sess_chat_20260603_001",
    "project_id": "01938000-0000-7000-0000-000000000100",
    "user_id": "user_demo",
    "trace_count": 5,
    "first_trace_at": "2026-06-03T07:30:00.000+08:00",
    "last_trace_at": "2026-06-03T07:45:00.000+08:00",
    "total_tokens": 3200,
    "total_cost": 0.0064,
    "metadata": {
      "platform": "openclaw",
      "title": "用户查询订单状态"
    }
  },
  "traces": [
    {
      "id": "01938000-0000-7000-0000-000000000001",
      "name": "查询订单状态",
      "timestamp_start": "2026-06-03T07:30:00.000+08:00",
      "latency_ms": 2500,
      "total_tokens": 450,
      "total_cost": 0.0009,
      "span_count": 3,
      "error_count": 0,
      "metadata": {"platform": "openclaw"}
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 50,
    "total": 5,
    "total_pages": 1
  }
}
```

**Query Parameters:**

| 参数 | 类型 | 默认 | 说明 |
|------|------|:---:|------|
| `include_traces` | bool | `true` | 是否加载 Session 内的 Trace 列表 |
| `page` | int | 1 | Trace 列表分页 |
| `page_size` | int | 50 | Trace 列表每页条数 |

---

### 4.4 `GET /api/v1/stats` — 基础统计

**Query Parameters:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `project_id` | UUID | ✅ | 项目 ID |
| `from` | timestamp | | 统计开始时间 |
| `to` | timestamp | | 统计结束时间 |

**Request:**

```
GET /api/v1/stats?project_id=01938000-0000-7000-0000-000000000100&from=2026-06-01T00:00:00%2B08:00&to=2026-06-03T23:59:59%2B08:00
```

**Response `200 OK`:**

```json
{
  "period": {
    "from": "2026-06-01T00:00:00+08:00",
    "to": "2026-06-03T23:59:59+08:00"
  },
  "totals": {
    "traces": 142,
    "spans": 523,
    "sessions": 38,
    "tokens": 256000,
    "cost": 0.512
  },
  "by_platform": [
    {
      "platform": "openclaw",
      "traces": 98,
      "spans": 356,
      "tokens": 180000,
      "cost": 0.36,
      "avg_latency_ms": 3200,
      "error_rate": 0.03
    },
    {
      "platform": "hermes",
      "traces": 44,
      "spans": 167,
      "tokens": 76000,
      "cost": 0.152,
      "avg_latency_ms": 2800,
      "error_rate": 0.05
    }
  ],
  "by_model": [
    {
      "model": "deepseek-v4-pro",
      "calls": 89,
      "tokens_input": 98000,
      "tokens_output": 35000,
      "cost": 0.267
    },
    {
      "model": "claude-sonnet-4-20250514",
      "calls": 45,
      "tokens_input": 52000,
      "tokens_output": 18000,
      "cost": 0.245
    }
  ],
  "daily": [
    {
      "date": "2026-06-01",
      "traces": 48,
      "tokens": 85000,
      "cost": 0.17
    },
    {
      "date": "2026-06-02",
      "traces": 52,
      "tokens": 92000,
      "cost": 0.184
    },
    {
      "date": "2026-06-03",
      "traces": 42,
      "tokens": 79000,
      "cost": 0.158
    }
  ]
}
```

---

### 4.5 `GET /api/v1/spans` — Span 列表（可选）

用于模型用量详情查询。

**Query Parameters:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `project_id` | UUID | ✅ | 项目 ID |
| `trace_id` | UUID | | 按 Trace 筛选 |
| `type` | string | | 按类型筛选 |
| `model` | string | | 按模型筛选 |
| `status` | string | | `ok` / `error` |
| `from` | timestamp | | 时间范围开始 |
| `to` | timestamp | | 时间范围结束 |
| `page` | int | 1 | 页码 |
| `page_size` | int | 50 | 每页条数 |

**Request:**

```
GET /api/v1/spans?project_id=01938000-0000-7000-0000-000000000100&type=gen_ai.chat&model=deepseek-v4-pro&from=2026-06-01T00:00:00%2B08:00&page=1&page_size=20
```

**Response `200 OK`:**

```json
{
  "data": [
    {
      "id": "01938000-0000-7001-0000-000000000002",
      "trace_id": "01938000-0000-7000-0000-000000000001",
      "parent_span_id": "01938000-0000-7001-0000-000000000001",
      "type": "gen_ai.chat",
      "name": "chat deepseek-v4-pro",
      "model": "deepseek-v4-pro",
      "provider": "deepseek",
      "tokens_input": 120,
      "tokens_output": 30,
      "cost": 0.0003,
      "latency_ms": 800,
      "first_token_latency_ms": 200,
      "status": "ok",
      "timestamp_start": "2026-06-03T07:30:00.200+08:00",
      "metadata": {"platform": "openclaw"}
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 89,
    "total_pages": 5
  }
}
```

---

## 5. Prompt API — Prompt 管理

### 5.1 `POST /api/v1/prompts` — 创建 Prompt 版本

**Request:**

```json
{
  "project_id": "01938000-0000-7000-0000-000000000100",
  "name": "order-inquiry-assistant",
  "template": "你是一个 {{role}} 助手。用户 {{user_name}} 的诉求是：\n{{user_query}}\n\n参考以下知识库：\n{{context}}",
  "variables": [
    {"name": "role", "type": "string", "required": true, "description": "助手角色"},
    {"name": "user_name", "type": "string", "required": true, "description": "用户姓名"},
    {"name": "user_query", "type": "text", "required": true, "description": "用户问题"},
    {"name": "context", "type": "text", "required": false, "description": "知识库上下文"}
  ],
  "description": "初始版本：订单查询助手 System Prompt",
  "metadata": {
    "author": "leo",
    "model": "deepseek-v4-pro"
  }
}
```

**Response `201 Created`:**

```json
{
  "status": "ok",
  "prompt": {
    "id": "01938000-0000-7002-0000-000000000001",
    "project_id": "01938000-0000-7000-0000-000000000100",
    "name": "order-inquiry-assistant",
    "version": 1,
    "template": "你是一个 {{role}} 助手。用户 {{user_name}} 的诉求是：\n{{user_query}}\n\n参考以下知识库：\n{{context}}",
    "variables": [
      {"name": "role", "type": "string", "required": true, "description": "助手角色"},
      {"name": "user_name", "type": "string", "required": true, "description": "用户姓名"},
      {"name": "user_query", "type": "text", "required": true, "description": "用户问题"},
      {"name": "context", "type": "text", "required": false, "description": "知识库上下文"}
    ],
    "description": "初始版本：订单查询助手 System Prompt",
    "is_active": true,
    "metadata": {"author": "leo", "model": "deepseek-v4-pro"},
    "created_at": "2026-06-03T08:00:00.000+08:00"
  }
}
```

**版本号规则：** 同一 `project_id` + `name` 下，版本号自动递增。首次创建 version=1。

---

### 5.2 `GET /api/v1/prompts` — Prompt 列表

**Query Parameters:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `project_id` | UUID | ✅ | 项目 ID |
| `name` | string | | 按 Prompt 名称筛选 |
| `is_active` | bool | | 只返回活跃版本 |

**Request:**

```
GET /api/v1/prompts?project_id=01938000-0000-7000-0000-000000000100&name=order-inquiry-assistant
```

**Response `200 OK`:**

```json
{
  "data": [
    {
      "id": "01938000-0000-7002-0000-000000000003",
      "project_id": "01938000-0000-7000-0000-000000000100",
      "name": "order-inquiry-assistant",
      "version": 3,
      "template": "你是一个 {{role}} 助手。用户 {{user_name}} 的诉求是：\n{{user_query}}",
      "variables": [
        {"name": "role", "type": "string", "required": true},
        {"name": "user_name", "type": "string", "required": true},
        {"name": "user_query", "type": "text", "required": true}
      ],
      "description": "v3: 移除 context 变量，简化模板",
      "is_active": true,
      "metadata": {"author": "leo"},
      "created_at": "2026-06-03T10:00:00.000+08:00"
    },
    {
      "id": "01938000-0000-7002-0000-000000000002",
      "project_id": "01938000-0000-7000-0000-000000000100",
      "name": "order-inquiry-assistant",
      "version": 2,
      "template": "你是一个 {{role}} 助手。用户 {{user_name}} 的诉求是：\n{{user_query}}\n\n参考：{{context}}",
      "variables": [
        {"name": "role", "type": "string", "required": true},
        {"name": "user_name", "type": "string", "required": true},
        {"name": "user_query", "type": "text", "required": true},
        {"name": "context", "type": "text", "required": false}
      ],
      "description": "v2: 简化 context 占位",
      "is_active": false,
      "metadata": {"author": "leo"},
      "created_at": "2026-06-03T09:00:00.000+08:00"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 2,
    "total_pages": 1
  }
}
```

---

### 5.3 `GET /api/v1/prompts/{id}` — Prompt 详情

**Request:**

```
GET /api/v1/prompts/01938000-0000-7002-0000-000000000003
```

**Response `200 OK`:**

```json
{
  "prompt": {
    "id": "01938000-0000-7002-0000-000000000003",
    "project_id": "01938000-0000-7000-0000-000000000100",
    "name": "order-inquiry-assistant",
    "version": 3,
    "template": "你是一个 {{role}} 助手。用户 {{user_name}} 的诉求是：\n{{user_query}}",
    "variables": [
      {"name": "role", "type": "string", "required": true, "description": "助手角色"},
      {"name": "user_name", "type": "string", "required": true, "description": "用户姓名"},
      {"name": "user_query", "type": "text", "required": true, "description": "用户问题"}
    ],
    "description": "v3: 移除 context 变量，简化模板",
    "is_active": true,
    "metadata": {"author": "leo"},
    "created_at": "2026-06-03T10:00:00.000+08:00",
    "updated_at": "2026-06-03T10:00:00.000+08:00"
  },
  "all_versions": [
    {"version": 3, "is_active": true, "description": "v3: 移除 context 变量，简化模板"},
    {"version": 2, "is_active": false, "description": "v2: 简化 context 占位"},
    {"version": 1, "is_active": false, "description": "初始版本"}
  ]
}
```

---

### 5.4 `PATCH /api/v1/prompts/{id}/activate` — 激活 Prompt 版本

将指定版本设为活跃版本（同一 `name` 的其他版本自动取消激活）。

**Request:**

```
PATCH /api/v1/prompts/01938000-0000-7002-0000-000000000002/activate
```

**Response `200 OK`:**

```json
{
  "status": "ok",
  "prompt": {
    "id": "01938000-0000-7002-0000-000000000002",
    "name": "order-inquiry-assistant",
    "version": 2,
    "is_active": true
  },
  "deactivated": ["01938000-0000-7002-0000-000000000003"]
}
```

---

### 5.5 `GET /api/v1/prompts/{id}/traces` — Prompt 关联的 Trace 列表

**Request:**

```
GET /api/v1/prompts/01938000-0000-7002-0000-000000000003/traces?page=1&page_size=20
```

**Response `200 OK`:**

```json
{
  "data": [
    {
      "trace_id": "01938000-0000-7000-0000-000000000001",
      "trace_name": "查询订单状态",
      "span_name": "chat deepseek-v4-pro",
      "tokens_input": 120,
      "tokens_output": 30,
      "cost": 0.0003,
      "status": "ok",
      "timestamp_start": "2026-06-03T07:30:00.200+08:00"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 45,
    "total_pages": 3
  }
}
```

---

## 6. Project API — 项目管理

### 6.1 `POST /api/v1/projects` — 创建项目

```json
{
  "name": "CC OPS Agent 运维方案",
  "slug": "cc-ops",
  "description": "云创设计 CC Universe AI Agent 运维方案",
  "metadata": {
    "team": "backend-ai",
    "tags": ["production"]
  }
}
```

**Response `201 Created`:**

```json
{
  "status": "ok",
  "project": {
    "id": "01938000-0000-7000-0000-000000000100",
    "name": "CC OPS Agent 运维方案",
    "slug": "cc-ops",
    "description": "云创设计 CC Universe AI Agent 运维方案",
    "metadata": {"team": "backend-ai", "tags": ["production"]},
    "created_at": "2026-06-03T08:00:00.000+08:00"
  }
}
```

### 6.2 `GET /api/v1/projects` — 项目列表

```
GET /api/v1/projects
```

### 6.3 `GET /api/v1/projects/{id}` — 项目详情

```
GET /api/v1/projects/01938000-0000-7000-0000-000000000100
```

### 6.4 `PATCH /api/v1/projects/{id}` — 更新项目

```json
{
  "description": "更新后的描述",
  "metadata": {"team": "ai-platform"}
}
```

---

## 7. 错误码

| HTTP Status | Code | 说明 |
|:---:|------|------|
| `400` | `INVALID_REQUEST` | 请求格式错误（JSON 解析失败 / 必填字段缺失） |
| `400` | `INVALID_SPAN_TYPE` | Span type 不在枚举值内 |
| `400` | `INVALID_TIME_RANGE` | 时间范围无效（from > to / 跨度超过 90 天） |
| `401` | `UNAUTHORIZED` | 未认证（缺少或无效的 API Key） |
| `403` | `FORBIDDEN` | 无权限访问该资源 |
| `404` | `TRACE_NOT_FOUND` | Trace 不存在 |
| `404` | `SPAN_NOT_FOUND` | Span 不存在 |
| `404` | `SESSION_NOT_FOUND` | Session 不存在 |
| `404` | `PROMPT_NOT_FOUND` | Prompt 不存在 |
| `404` | `PROJECT_NOT_FOUND` | Project 不存在 |
| `409` | `TRACE_ALREADY_EXISTS` | Trace ID 冲突 |
| `409` | `PROJECT_SLUG_EXISTS` | Project slug 冲突 |
| `409` | `PROMPT_VERSION_EXISTS` | Prompt 版本号冲突 |
| `422` | `VALIDATION_ERROR` | 字段校验失败（带详情） |
| `429` | `RATE_LIMITED` | 请求频率超限 |
| `500` | `INTERNAL_ERROR` | 服务端内部错误 |

**422 错误示例：**

```json
{
  "status": "error",
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed.",
  "details": [
    {
      "field": "spans[0].type",
      "error": "Invalid span type 'gen_ai.unknown'. Allowed: gen_ai.chat, gen_ai.tool, gen_ai.retrieval, gen_ai.agent, gen_ai.chain, gen_ai.embedding"
    },
    {
      "field": "trace.metadata",
      "error": "Missing required field: platform"
    }
  ]
}
```

---

## 8. 认证

当前实现区分数据摄入和工作台访问两类认证：

```
X-Firefly-Key: <ingest-key>          # Adapter / OTLP 数据摄入
Authorization: Bearer <session-token> # 登录后的查询与工作台 API
```

| Header | 说明 |
|------|------|
| `X-Firefly-Key` | 服务端共享摄入密钥，仅由 Agent/Adapter 使用 |
| `Authorization` | `/auth/login` 返回的用户会话 Token |
| `X-Firefly-Project-ID` | OTLP 摄入时的目标项目 UUID |

**Phase 2 计划：** JWT + RBAC。

---

## 附录 A: 完整请求流程示例

### A.1 Hermes Agent Trace 摄入

```bash
curl -X POST http://localhost:8000/api/v1/ingest/trace \
  -H "X-Firefly-Key: replace-with-your-ingest-key" \
  -H "Content-Type: application/json" \
  -d '{
    "trace": {
      "id": "01938000-0000-7000-0000-000000000010",
      "project_id": "01938000-0000-7000-0000-000000000100",
      "session_id": "hermes_session_001",
      "user_id": "user_demo",
      "name": "Hermes 文件分析任务",
      "tags": ["hermes", "document-analysis"],
      "input": {"task": "分析财报 PDF 的营收趋势"},
      "output": {"summary": "2026 Q1 营收同比增长 23%..."},
      "timestamp_start": "2026-06-03T08:00:00.000+08:00",
      "timestamp_end": "2026-06-03T08:00:05.200+08:00",
      "latency_ms": 5200,
      "total_tokens": 800,
      "total_cost": 0.0016,
      "span_count": 3,
      "error_count": 0,
      "metadata": {
        "platform": "hermes",
        "platform_version": "0.5.0",
        "adapter_version": "0.1.0",
        "source_trace_id": "hermes_trace_abc",
        "deployment": {"server": "alibaba-ecs-02"}
      }
    },
    "spans": [
      {
        "id": "01938000-0000-7001-0000-000000000010",
        "parent_span_id": null,
        "type": "gen_ai.agent",
        "name": "hermes file-analysis agent",
        "latency_ms": 5200,
        "status": "ok",
        "timestamp_start": "2026-06-03T08:00:00.000+08:00",
        "timestamp_end": "2026-06-03T08:00:05.200+08:00",
        "metadata": {"platform": "hermes"}
      },
      {
        "id": "01938000-0000-7001-0000-000000000011",
        "parent_span_id": "01938000-0000-7001-0000-000000000010",
        "type": "gen_ai.retrieval",
        "name": "retrieve document chunks",
        "input": {"query": "营收趋势"},
        "output": {"chunks": [{"content": "...", "score": 0.92}]},
        "latency_ms": 80,
        "status": "ok",
        "timestamp_start": "2026-06-03T08:00:00.100+08:00",
        "timestamp_end": "2026-06-03T08:00:00.180+08:00",
        "metadata": {"platform": "hermes", "chunk_count": 5}
      },
      {
        "id": "01938000-0000-7001-0000-000000000012",
        "parent_span_id": "01938000-0000-7001-0000-000000000010",
        "type": "gen_ai.chat",
        "name": "chat claude-sonnet-4-20250514",
        "model": "claude-sonnet-4-20250514",
        "provider": "anthropic",
        "model_parameters": {"temperature": 0.3, "max_tokens": 4096},
        "input": {"messages": [{"role": "user", "content": "分析以下财报内容..."}]},
        "output": {"content": "2026 Q1 营收同比增长 23%..."},
        "tokens_input": 500,
        "tokens_output": 300,
        "cost": 0.0016,
        "latency_ms": 4500,
        "first_token_latency_ms": 600,
        "status": "ok",
        "timestamp_start": "2026-06-03T08:00:00.200+08:00",
        "timestamp_end": "2026-06-03T08:00:04.700+08:00",
        "metadata": {"platform": "hermes"}
      }
    ]
  }'
```

### A.2 查询跨平台 Trace

```bash
# 查询所有平台（OpenClaw + Hermes）的 Trace
curl "http://localhost:8000/api/v1/traces?project_id=01938000-0000-7000-0000-000000000100&from=2026-06-03T00:00:00%2B08:00&page=1&page_size=20" \
  -H "Authorization: Bearer <session-token>"

# 只看 Hermes 的 Trace
curl "http://localhost:8000/api/v1/traces?project_id=01938000-0000-7000-0000-000000000100&platform=hermes&page=1&page_size=20" \
  -H "Authorization: Bearer <session-token>"
```

---

## 附录 B: Python 模型校验 (Pydantic Schema 参考)

```python
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Any, Literal
from datetime import datetime
from uuid import UUID
from enum import Enum


class SpanType(str, Enum):
    CHAT = "gen_ai.chat"
    TOOL = "gen_ai.tool"
    RETRIEVAL = "gen_ai.retrieval"
    AGENT = "gen_ai.agent"
    CHAIN = "gen_ai.chain"
    EMBEDDING = "gen_ai.embedding"


class SpanStatus(str, Enum):
    OK = "ok"
    ERROR = "error"


class SpanIngest(BaseModel):
    id: UUID
    parent_span_id: Optional[UUID] = None
    type: SpanType
    name: str = Field(..., max_length=256)
    model: Optional[str] = Field(None, max_length=128)
    provider: Optional[str] = Field(None, max_length=64)
    model_parameters: Optional[dict] = None
    input: Optional[Any] = None
    output: Optional[Any] = None
    tokens_input: Optional[int] = None
    tokens_output: Optional[int] = None
    cost: Optional[float] = None
    latency_ms: Optional[int] = None
    first_token_latency_ms: Optional[int] = None
    status: SpanStatus = SpanStatus.OK
    status_message: Optional[str] = None
    prompt_id: Optional[UUID] = None
    prompt_version: Optional[int] = None
    timestamp_start: datetime
    timestamp_end: Optional[datetime] = None
    metadata: dict = Field(default_factory=dict)


class TraceIngest(BaseModel):
    id: UUID
    project_id: UUID
    session_id: Optional[str] = Field(None, max_length=128)
    user_id: Optional[str] = Field(None, max_length=128)
    name: str = Field(..., max_length=256)
    tags: List[str] = Field(default_factory=list)
    input: Optional[Any] = None
    output: Optional[Any] = None
    timestamp_start: datetime
    timestamp_end: Optional[datetime] = None
    latency_ms: Optional[int] = None
    total_tokens: int = 0
    total_cost: float = 0.0
    span_count: int = 0
    error_count: int = 0
    metadata: dict = Field(default_factory=dict)

    @validator("metadata")
    def platform_required(cls, v):
        if "platform" not in v:
            raise ValueError("metadata must contain 'platform' field")
        return v


class IngestTraceRequest(BaseModel):
    trace: TraceIngest
    spans: List[SpanIngest]


class IngestSpanRequest(BaseModel):
    span: SpanIngest
    trace_update: Optional[dict] = None
```

---

## 变更记录

| 日期 | 版本 | 变更 | 作者 |
|------|------|------|------|
| 2026-06-03 | v1.0 | Phase 1 API 规范初稿：Ingestion / Query / Prompt / Project | 小架 |

---

> _🔥 API 是萤火的窗口。平台无关，OTel 原生，Adapter 轻量接入。_
