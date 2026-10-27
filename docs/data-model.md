# 萤火 Firefly — Phase 1 数据模型设计

> **版本**: v1.0
> **日期**: 2026-06-03
> **状态**: 历史设计草案

> 本文记录早期建模思路。当前可执行 Schema 以 `backend/app/models/` 与
> `backend/alembic/versions/` 为准。

---

## 目录

1. [设计原则](#1-设计原则)
2. [实体关系图](#2-实体关系图)
3. [表结构定义](#3-表结构定义)
4. [索引策略](#4-索引策略)
5. [ClickHouse 迁移预留](#5-clickhouse-迁移预留)
6. [SQL DDL 完整脚本](#6-sql-ddl-完整脚本)
7. [数据流示例](#7-数据流示例)
8. [Metadata 使用规范](#8-metadata-使用规范)

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| **平台无关** | `platform`、`platform_version`、`adapter_version` 等平台特征仅存于 `metadata` JSONB，核心列不出现平台前缀 |
| **OTel 优先** | Span `type` 遵循 OpenTelemetry GenAI Semantic Conventions：`gen_ai.chat` / `gen_ai.tool` / `gen_ai.retrieval` / `gen_ai.agent` / `gen_ai.chain` / `gen_ai.embedding` |
| **UUID 主键** | 全部用 UUID v7（时间有序）做主键，避免自增 ID 在分布式/ClickHouse 场景下的冲突 |
| **JSONB 灵活扩展** | `metadata` 承载平台特有信息、部署信息、自定义标签；`input` / `output` 承载变长内容 |
| **PG 原生 JSON 索引** | 高频筛选字段从 metadata 中提取到核心列，低频的留在 JSONB 中用 GIN 索引 |
| **写入优先** | Phase 1 以 Ingestion 吞吐为核心优化目标；查询次之；不做物化视图 |
| **ClickHouse 友好** | 不依赖 PG 唯一约束以外的特性；避免递归 CTE、复杂 trigger；宽表化 Span 字段 |

---

## 2. 实体关系图

```
┌──────────┐       ┌──────────┐       ┌──────────┐
│  Project  │1────n│  Trace   │1────n│   Span   │
│          │       │          │       │          │
│ id       │       │ id       │       │ id       │
│ name     │       │ project_id│      │ trace_id │
│ slug     │       │ session_id│      │ parent_  │
│ metadata │       │ user_id  │       │  span_id │
└──────────┘       │ metadata │       │ type     │
                   └──────────┘       │ model    │
                        │             │ input    │
                        │             │ output   │
                   ┌──────────┐       │ metadata │
                   │ Session  │       └──────────┘
                   │          │
                   │ id       │       ┌──────────┐
                   │ project_id│      │  Prompt  │
                   │ user_id  │       │          │
                   │ metadata │       │ id       │
                   └──────────┘       │ project_id│
                                      │ name     │
                                      │ version  │
                                      │ template │
                                      └──────────┘
```

**关系说明：**

- **Project → Trace**：1:N。一个项目下有多条 Trace。
- **Trace → Span**：1:N。一条 Trace 包含多个 Span（LLM 调用、工具调用、检索等）。
- **Span → Span**：自引用树。`parent_span_id` 构建 Span Tree。
- **Session → Trace**：1:N。一个 Session 聚合多次对话 Turn。
- **Prompt ⇢ Span**：Span 引用 Prompt 版本（`prompt_id` + `prompt_version`），非外键约束。

---

## 3. 表结构定义

### 3.1 `projects` — 项目/应用

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `UUID` | PK, DEFAULT gen_uuid_v7() | 项目唯一标识 |
| `name` | `VARCHAR(128)` | NOT NULL | 项目名称 |
| `slug` | `VARCHAR(64)` | NOT NULL, UNIQUE | URL 友好标识 |
| `description` | `TEXT` | | 项目描述 |
| `metadata` | `JSONB` | DEFAULT '{}' | 扩展元数据（团队、标签等） |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |

**metadata 示例：**
```json
{
  "team": "backend-ai",
  "tags": ["production", "customer-facing"],
  "timezone": "Asia/Shanghai"
}
```

---

### 3.2 `traces` — 一次 Agent 会话的完整链路

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `UUID` | PK, DEFAULT gen_uuid_v7() | OTel TraceID (16 bytes hex → UUID) |
| `project_id` | `UUID` | NOT NULL, FK → projects.id | 所属项目 |
| `session_id` | `VARCHAR(128)` | | 跨 Trace 的会话聚合标识 |
| `user_id` | `VARCHAR(128)` | | 终端用户标识 |
| `name` | `VARCHAR(256)` | NOT NULL | Trace 名称，如 "用户查询订单状态" |
| `tags` | `TEXT[]` | DEFAULT '{}' | 标签数组：["production", "chat"] |
| `input` | `JSONB` | | 用户输入（结构化） |
| `output` | `JSONB` | | Agent 最终输出 |
| `timestamp_start` | `TIMESTAMPTZ` | NOT NULL | Trace 开始时间 |
| `timestamp_end` | `TIMESTAMPTZ` | | Trace 结束时间 |
| `latency_ms` | `INTEGER` | | 端到端延迟（毫秒） |
| `total_tokens` | `INTEGER` | DEFAULT 0 | 总 Token 消耗（input + output） |
| `total_cost` | `DOUBLE PRECISION` | DEFAULT 0.0 | 总成本（美元） |
| `span_count` | `INTEGER` | DEFAULT 0 | Span 数量 |
| `error_count` | `INTEGER` | DEFAULT 0 | 错误 Span 数量 |
| `metadata` | `JSONB` | DEFAULT '{}' | **平台元数据（见 §8）** |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |

**metadata 规范（见 §8）：**
```json
{
  "platform": "openclaw",
  "platform_version": "2026.5.7",
  "adapter_version": "0.1.0",
  "source_trace_id": "abc123-platform-native-id",
  "trigger": {"source": "webchat", "run_mode": "manual"},
  "deployment": {
    "region": "cn-hangzhou",
    "server": "alibaba-ecs-01",
    "container": "openclaw-gateway-7f8b9c",
    "cluster": null
  },
  "custom": {}
}
```

---

### 3.3 `spans` — Trace 下的单个操作

这是核心表，遵循 **OTel GenAI Semantic Conventions**。

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `UUID` | PK, DEFAULT gen_uuid_v7() | OTel SpanID (8 bytes hex → UUID) |
| `trace_id` | `UUID` | NOT NULL, FK → traces.id ON DELETE CASCADE | 所属 Trace |
| `parent_span_id` | `UUID` | | 父 Span（构建树结构） |
| `type` | `VARCHAR(32)` | NOT NULL | `gen_ai.chat` / `gen_ai.tool` / `gen_ai.retrieval` / `gen_ai.agent` / `gen_ai.chain` / `gen_ai.embedding` |
| `name` | `VARCHAR(256)` | NOT NULL | e.g. "chat deepseek-v4-pro" |
| `model` | `VARCHAR(128)` | | 模型名（type = gen_ai.chat 时必填） |
| `provider` | `VARCHAR(64)` | | 模型提供商（deepseek / openai / anthropic） |
| `model_parameters` | `JSONB` | | `{"temperature": 0.7, "max_tokens": 4096}` |
| `input` | `JSONB` | | 结构化输入（messages / tool_schema 等） |
| `output` | `JSONB` | | 结构化输出（completion / tool_result 等） |
| `tokens_input` | `INTEGER` | | 输入 Token 数 |
| `tokens_output` | `INTEGER` | | 输出 Token 数 |
| `cost` | `DOUBLE PRECISION` | | 本次调用成本（美元） |
| `latency_ms` | `INTEGER` | | 端到端延迟（毫秒） |
| `first_token_latency_ms` | `INTEGER` | | 首 Token 延迟（TTFT） |
| `status` | `VARCHAR(16)` | NOT NULL, DEFAULT 'ok' | `ok` / `error` |
| `status_message` | `TEXT` | | 错误信息（status=error 时） |
| `prompt_id` | `UUID` | | 关联 Prompt 版本 |
| `prompt_version` | `INTEGER` | | Prompt 版本号 |
| `timestamp_start` | `TIMESTAMPTZ` | NOT NULL | Span 开始时间 |
| `timestamp_end` | `TIMESTAMPTZ` | | Span 结束时间 |
| `metadata` | `JSONB` | DEFAULT '{}' | **Span 级平台元数据** |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |

**Span 类型说明：**

| type | 含义 | 典型 input/output |
|------|------|-------------------|
| `gen_ai.chat` | LLM 对话调用 | input: messages[], output: completion |
| `gen_ai.tool` | 工具/函数调用 | input: function_name + args, output: function_result |
| `gen_ai.retrieval` | 检索召回 | input: query, output: chunks[] |
| `gen_ai.agent` | 子 Agent 调用 | input: task, output: agent_response |
| `gen_ai.chain` | 链式编排 | input: chain_config, output: chain_result |
| `gen_ai.embedding` | 向量嵌入 | input: text, output: embedding_metadata |

**metadata 示例：**
```json
{
  "platform": "openclaw",
  "source_span_id": "platform-native-span-id",
  "retry_count": 0,
  "cache_hit": false,
  "stream": true,
  "finish_reason": "stop",
  "tool_call_id": "call_abc123",
  "tool_name": "web_search",
  "custom": {}
}
```

---

### 3.4 `sessions` — 跨 Trace 的用户会话聚合

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `VARCHAR(128)` | PK | 会话标识（由 Adapter 提供） |
| `project_id` | `UUID` | NOT NULL, FK → projects.id | 所属项目 |
| `user_id` | `VARCHAR(128)` | | 终端用户标识 |
| `trace_count` | `INTEGER` | DEFAULT 0 | 会话内 Trace 数量 |
| `first_trace_at` | `TIMESTAMPTZ` | | 首次 Trace 时间 |
| `last_trace_at` | `TIMESTAMPTZ` | | 最后 Trace 时间 |
| `total_tokens` | `INTEGER` | DEFAULT 0 | 聚合 Token 消耗 |
| `total_cost` | `DOUBLE PRECISION` | DEFAULT 0.0 | 聚合成本 |
| `metadata` | `JSONB` | DEFAULT '{}' | 会话元数据 |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |

**metadata 示例：**
```json
{
  "platform": "openclaw",
  "title": "用户查询订单状态",
  "tags": ["customer-support"],
  "feedback_score": 4
}
```

---

### 3.5 `prompts` — Prompt 模板 + 版本管理

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `UUID` | PK, DEFAULT gen_uuid_v7() | Prompt 标识 |
| `project_id` | `UUID` | NOT NULL, FK → projects.id | 所属项目 |
| `name` | `VARCHAR(128)` | NOT NULL | Prompt 名称 |
| `version` | `INTEGER` | NOT NULL | 版本号（同一 name 下递增） |
| `template` | `TEXT` | NOT NULL | Prompt 模板（支持 `{{variable}}` 占位） |
| `variables` | `JSONB` | DEFAULT '[]' | 变量定义列表 |
| `description` | `TEXT` | | 版本说明 |
| `is_active` | `BOOLEAN` | DEFAULT false | 是否为当前活跃版本 |
| `metadata` | `JSONB` | DEFAULT '{}' | 扩展元数据 |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT NOW() | |

**唯一约束：** `(project_id, name, version)` 保证同一项目下同 Prompt 名称的版本号唯一。

**variables 示例：**
```json
[
  {"name": "user_name", "type": "string", "required": true, "description": "用户姓名"},
  {"name": "context", "type": "text", "required": false, "description": "对话上下文"}
]
```

**template 示例：**
```
你是一个 {{role}} 助手。用户 {{user_name}} 的诉求是：
{{user_query}}

参考以下知识库：
{{context}}
```

---

## 4. 索引策略

### 4.1 核心查询模式分析

| 查询场景 | 频率 | 筛选条件 |
|---------|:----:|---------|
| Trace 列表 + 平台筛选 | 高 | `project_id`, `timestamp_start`, `metadata->>'platform'` |
| Trace 详情 + Spans | 高 | `trace_id` |
| Span 按类型筛选 | 中 | `trace_id`, `type` |
| Session 聚合视图 | 中 | `session_id` |
| 按时间范围统计 | 中 | `project_id`, `timestamp_start` |
| 错误 Trace 筛选 | 低 | `project_id`, `error_count > 0` |
| Prompt 版本查询 | 低 | `project_id`, `name` |

### 4.2 索引定义

```sql
-- =====================
-- traces 表索引
-- =====================

-- 主查询路径：按项目 + 时间范围
CREATE INDEX idx_traces_project_time
  ON traces (project_id, timestamp_start DESC);

-- Session 聚合
CREATE INDEX idx_traces_session
  ON traces (session_id) WHERE session_id IS NOT NULL;

-- 用户维度
CREATE INDEX idx_traces_user
  ON traces (user_id) WHERE user_id IS NOT NULL;

-- 错误筛选
CREATE INDEX idx_traces_errors
  ON traces (project_id, error_count)
  WHERE error_count > 0;

-- Metadata 中 platform 字段的 GIN 索引（支持 JSONB 键值查询）
CREATE INDEX idx_traces_metadata
  ON traces USING GIN (metadata jsonb_path_ops);

-- 为 platform 筛选加速的表达式索引
CREATE INDEX idx_traces_platform
  ON traces ((metadata->>'platform')) WHERE metadata->>'platform' IS NOT NULL;


-- =====================
-- spans 表索引
-- =====================

-- Trace 详情：查询某 Trace 下所有 Span
CREATE INDEX idx_spans_trace
  ON spans (trace_id, timestamp_start);

-- Span Tree：按 parent_span 查询子节点
CREATE INDEX idx_spans_parent
  ON spans (parent_span_id) WHERE parent_span_id IS NOT NULL;

-- 类型筛选（Dashboard 按 span type 聚合）
CREATE INDEX idx_spans_type
  ON spans (type, timestamp_start);

-- 错误 Span 筛选
CREATE INDEX idx_spans_status
  ON spans (status) WHERE status = 'error';

-- Prompt 关联
CREATE INDEX idx_spans_prompt
  ON spans (prompt_id, prompt_version)
  WHERE prompt_id IS NOT NULL;

-- 模型用量统计
CREATE INDEX idx_spans_model
  ON spans (model, timestamp_start)
  WHERE model IS NOT NULL;

-- Metadata GIN 索引
CREATE INDEX idx_spans_metadata
  ON spans USING GIN (metadata jsonb_path_ops);


-- =====================
-- sessions 表索引
-- =====================

CREATE INDEX idx_sessions_project
  ON sessions (project_id, last_trace_at DESC);

CREATE INDEX idx_sessions_user
  ON sessions (user_id) WHERE user_id IS NOT NULL;


-- =====================
-- prompts 表索引
-- =====================

CREATE INDEX idx_prompts_project_name
  ON prompts (project_id, name, version DESC);
```

---

## 5. ClickHouse 迁移预留

Phase 1 使用 PostgreSQL，但预留未来迁移 ClickHouse 的空间。以下是设计决策：

### 5.1 PG 特性的让步

| PG 特性 | Phase 1 是否使用 | ClickHouse 迁移策略 |
|---------|:---:|------|
| **外键约束** | ✅ 使用 | CH 不支持 FK；迁移后由应用层保证一致性 |
| **JSONB GIN 索引** | ✅ 使用 | CH 用 `Map(String, String)` + bloom_filter 替代 |
| **递归 CTE（Span Tree）** | ❌ 避免 | Phase 1 在应用层构建 Tree（先查所有 Span，内存中组装） |
| **Trigger（自动更新 aggregate）** | ❌ 避免 | Session/Trace 聚合在写入时由应用层计算 |
| **物化视图** | ❌ 避免 | CH 天然支持物化视图，到时直接建 |
| **PG 独有类型（如 INET、JSONPATH）** | ❌ 避免 | 全部用标准类型 |
| **Stored Procedure** | ❌ 避免 | 逻辑在 Python 层 |
| **UNIQUE 约束（除 PK 外）** | ⚠️ 仅 `prompts(project_id, name, version)` | CH 不支持 UNIQUE，此约束在 CH 迁移时可降级为应用层检查 |

### 5.2 设计为 ClickHouse 友好的特征

| 特征 | 说明 |
|------|------|
| **宽表 Span** | Span 已经足够宽（tokens / cost / latency 全部冗余存储），无需 JOIN |
| **时间分区键** | `timestamp_start` 作为自然分区键（CH 按天/月分区） |
| **去规范化** | Trace 冗余 `total_tokens` / `span_count` 避免 COUNT JOIN |
| **无自增 ID** | UUID v7 时间有序，适合 CH 的 MergeTree 排序键 |
| **不可变写入** | Trace + Span 只 INSERT + SELECT，不 UPDATE（除 session 的聚合字段） |

### 5.3 未来 ClickHouse DDL 示意

```sql
-- Phase 2+ 迁移到 ClickHouse 时的建表语句示意
-- 不在此 Phase 执行，仅供架构参考

CREATE TABLE traces (
    id UUID,
    project_id UUID,
    session_id String,
    user_id String,
    name String,
    tags Array(String),
    input String,        -- JSON 序列化为 String
    output String,
    timestamp_start DateTime64(3, 'Asia/Shanghai'),
    timestamp_end DateTime64(3, 'Asia/Shanghai'),
    latency_ms UInt32,
    total_tokens UInt32,
    total_cost Float64,
    span_count UInt16,
    error_count UInt16,
    metadata String,      -- JSON String
    created_at DateTime64(3, 'Asia/Shanghai')
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp_start)
ORDER BY (project_id, timestamp_start, id);
```

---

## 6. SQL DDL 完整脚本

```sql
-- ================================================================
-- 萤火 Firefly — Phase 1 数据库初始化 SQL
-- 目标: PostgreSQL 15+
-- 字符集: UTF8
-- 时区: Asia/Shanghai (由 TIMESTAMPTZ 自动处理)
-- ================================================================

BEGIN;

-- -------------------------------------------------------
-- 0. UUID v7 生成函数（PostgreSQL 17+ 内置，此处向后兼容）
-- -------------------------------------------------------
-- PG17 有内置 uuid7，PG15-16 使用此函数
CREATE OR REPLACE FUNCTION gen_uuid_v7()
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_time BIGINT;
    v_rand_bytes BYTEA;
BEGIN
    -- Unix timestamp in milliseconds
    v_time := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
    v_rand_bytes := gen_random_bytes(10);

    RETURN encode(
        -- time_high (32 bits)
        substring(int8send(v_time >> 16), 5, 4) ||
        -- time_mid (16 bits)
        set_byte(substring(int8send(v_time) || v_rand_bytes, 3, 2), 0,
                 get_byte(substring(int8send(v_time) || v_rand_bytes, 3, 2), 0) | x'70'::int) ||
        -- time_low_and_version (16 bits) — set version to 7
        set_byte(substring(int8send(v_time) || v_rand_bytes, 5, 2), 0,
                 get_byte(substring(int8send(v_time) || v_rand_bytes, 5, 2), 0) | x'80'::int) ||
        -- clock_seq_and_variant + node (剩下的 8 bytes)
        substring(v_rand_bytes, 3)
    , 'hex')::UUID;
END;
$$;


-- -------------------------------------------------------
-- 1. projects
-- -------------------------------------------------------
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    name        VARCHAR(128) NOT NULL,
    slug        VARCHAR(64) NOT NULL,
    description TEXT,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_projects_slug UNIQUE (slug)
);


-- -------------------------------------------------------
-- 2. traces
-- -------------------------------------------------------
CREATE TABLE traces (
    id              UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id      VARCHAR(128),
    user_id         VARCHAR(128),
    name            VARCHAR(256) NOT NULL,
    tags            TEXT[] NOT NULL DEFAULT '{}',
    input           JSONB,
    output          JSONB,
    timestamp_start TIMESTAMPTZ NOT NULL,
    timestamp_end   TIMESTAMPTZ,
    latency_ms      INTEGER,
    total_tokens    INTEGER NOT NULL DEFAULT 0,
    total_cost      DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    span_count      INTEGER NOT NULL DEFAULT 0,
    error_count     INTEGER NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- -------------------------------------------------------
-- 3. spans
-- -------------------------------------------------------
CREATE TABLE spans (
    id                      UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    trace_id                UUID NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    parent_span_id          UUID,
    type                    VARCHAR(32) NOT NULL,
    name                    VARCHAR(256) NOT NULL,
    model                   VARCHAR(128),
    provider                VARCHAR(64),
    model_parameters        JSONB,
    input                   JSONB,
    output                  JSONB,
    tokens_input            INTEGER,
    tokens_output           INTEGER,
    cost                    DOUBLE PRECISION,
    latency_ms              INTEGER,
    first_token_latency_ms  INTEGER,
    status                  VARCHAR(16) NOT NULL DEFAULT 'ok',
    status_message          TEXT,
    prompt_id               UUID,
    prompt_version          INTEGER,
    timestamp_start         TIMESTAMPTZ NOT NULL,
    timestamp_end           TIMESTAMPTZ,
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 只做引用，不做 FK（ClickHouse 兼容）
    CONSTRAINT chk_span_type CHECK (
        type IN ('gen_ai.chat', 'gen_ai.tool', 'gen_ai.retrieval',
                 'gen_ai.agent', 'gen_ai.chain', 'gen_ai.embedding')
    ),
    CONSTRAINT chk_span_status CHECK (status IN ('ok', 'error'))
);


-- -------------------------------------------------------
-- 4. sessions
-- -------------------------------------------------------
CREATE TABLE sessions (
    id              VARCHAR(128) PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id         VARCHAR(128),
    trace_count     INTEGER NOT NULL DEFAULT 0,
    first_trace_at  TIMESTAMPTZ,
    last_trace_at   TIMESTAMPTZ,
    total_tokens    INTEGER NOT NULL DEFAULT 0,
    total_cost      DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- -------------------------------------------------------
-- 5. prompts
-- -------------------------------------------------------
CREATE TABLE prompts (
    id          UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        VARCHAR(128) NOT NULL,
    version     INTEGER NOT NULL,
    template    TEXT NOT NULL,
    variables   JSONB NOT NULL DEFAULT '[]',
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT false,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_prompts_version UNIQUE (project_id, name, version)
);


-- =====================================================
-- Indexes
-- =====================================================

-- traces
CREATE INDEX idx_traces_project_time   ON traces (project_id, timestamp_start DESC);
CREATE INDEX idx_traces_session        ON traces (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_traces_user           ON traces (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_traces_errors         ON traces (project_id, error_count) WHERE error_count > 0;
CREATE INDEX idx_traces_metadata       ON traces USING GIN (metadata jsonb_path_ops);
CREATE INDEX idx_traces_platform       ON traces ((metadata->>'platform')) WHERE metadata->>'platform' IS NOT NULL;

-- spans
CREATE INDEX idx_spans_trace           ON spans (trace_id, timestamp_start);
CREATE INDEX idx_spans_parent          ON spans (parent_span_id) WHERE parent_span_id IS NOT NULL;
CREATE INDEX idx_spans_type            ON spans (type, timestamp_start);
CREATE INDEX idx_spans_status          ON spans (status) WHERE status = 'error';
CREATE INDEX idx_spans_prompt          ON spans (prompt_id, prompt_version) WHERE prompt_id IS NOT NULL;
CREATE INDEX idx_spans_model           ON spans (model, timestamp_start) WHERE model IS NOT NULL;
CREATE INDEX idx_spans_metadata        ON spans USING GIN (metadata jsonb_path_ops);

-- sessions
CREATE INDEX idx_sessions_project      ON sessions (project_id, last_trace_at DESC);
CREATE INDEX idx_sessions_user         ON sessions (user_id) WHERE user_id IS NOT NULL;

-- prompts
CREATE INDEX idx_prompts_project_name  ON prompts (project_id, name, version DESC);


-- =====================================================
-- Auto-update updated_at trigger
-- =====================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_prompts_updated_at
    BEFORE UPDATE ON prompts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
```

---

## 7. 数据流示例

### 7.1 摄入一条完整 Trace

```json
// POST /api/v1/ingest/trace
{
  "trace": {
    "id": "01938000-0000-7000-0000-000000000001",
    "project_id": "01938000-0000-7000-0000-000000000100",
    "session_id": "sess_chat_20260603_001",
    "user_id": "user_demo",
    "name": "查询订单状态",
    "tags": ["production", "openclaw"],
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
      "timestamp_start": "2026-06-03T07:30:00.000+08:00",
      "timestamp_end": "2026-06-03T07:30:02.500+08:00",
      "latency_ms": 2500,
      "status": "ok",
      "metadata": {"platform": "openclaw"}
    },
    {
      "id": "01938000-0000-7001-0000-000000000002",
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
        "content": "我需要调用订单查询工具来获取订单 #12345 的状态。",
        "tool_calls": [{"name": "query_order", "arguments": {"order_id": "12345"}}]
      },
      "tokens_input": 120,
      "tokens_output": 30,
      "cost": 0.0003,
      "latency_ms": 800,
      "first_token_latency_ms": 200,
      "status": "ok",
      "timestamp_start": "2026-06-03T07:30:00.200+08:00",
      "timestamp_end": "2026-06-03T07:30:01.000+08:00",
      "metadata": {"platform": "openclaw", "stream": true, "finish_reason": "tool_calls"}
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
      "metadata": {"platform": "openclaw", "tool_call_id": "call_abc123"}
    }
  ]
}
```

### 7.2 对应数据库状态

```
traces:
┌──────┬──────────┬─────────────────────┬──────────┬──────┬───────────┬───────────┬────────────┐
│ id   │ proj_id  │ session_id          │ name     │tags  │ tokens    │ cost      │ metadata   │
├──────┼──────────┼─────────────────────┼──────────┼──────┼───────────┼───────────┼────────────┤
│ 0x01 │ 0x100    │ sess_chat_001       │ 查询订单 │{prod}│ 450       │ 0.0009    │ {platform: │
│      │          │                     │          │      │           │           │  openclaw} │
└──────┴──────────┴─────────────────────┴──────────┴──────┴───────────┴───────────┴────────────┘

spans:
┌──────┬──────────┬──────────┬──────────────┬──────────────┬──────┬────────────┐
│ id   │ trace_id │ parent   │ type         │ name         │model │ status     │
├──────┼──────────┼──────────┼──────────────┼──────────────┼──────┼────────────┤
│ 0x11 │ 0x01     │ NULL     │ gen_ai.agent │ agent 小架   │ NULL │ ok         │
│ 0x12 │ 0x01     │ 0x11     │ gen_ai.chat  │ chat deep..  │ ds-v4│ ok         │
│ 0x13 │ 0x01     │ 0x11     │ gen_ai.tool  │ query_order  │ NULL │ ok         │
└──────┴──────────┴──────────┴──────────────┴──────────────┴──────┴────────────┘
```

---

## 8. Metadata 使用规范

### 8.1 Trace 级 metadata 约定字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `platform` | string | ✅ | `openclaw` \| `hermes` \| `coze` \| `maxkb` \| `miaota` |
| `platform_version` | string | | 平台版本号 |
| `adapter_version` | string | | Adapter 版本号 |
| `source_trace_id` | string | | 平台原生 Trace ID（桥接模式必须） |
| `trigger` | object | | `{"source": "webchat", "run_mode": "manual"}` |
| `deployment` | object | | `{"region", "server", "container", "cluster"}` |
| `custom` | object | | 平台特有字段的自由扩展区 |

### 8.2 Span 级 metadata 约定字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `platform` | string | 平台标识（冗余，加速查询） |
| `source_span_id` | string | 平台原生 Span ID |
| `retry_count` | int | 重试次数 |
| `cache_hit` | bool | 是否命中缓存 |
| `stream` | bool | 是否流式调用 |
| `finish_reason` | string | `stop` / `length` / `tool_calls` / `content_filter` |
| `tool_call_id` | string | 工具调用 ID |
| `tool_name` | string | 工具名称（冗余） |
| `custom` | object | 平台特有字段 |

### 8.3 平台特有字段存放规则

**正确 ✅：**
```json
{
  "metadata": {
    "platform": "openclaw",
    "custom": {
      "openclaw_turn_id": "turn_abc",
      "openclaw_agent_name": "小架"
    }
  }
}
```

**错误 ❌：**
```sql
-- 不要在核心表加平台特有列！
ALTER TABLE traces ADD COLUMN openclaw_turn_id VARCHAR(128);
ALTER TABLE traces ADD COLUMN hermes_agent_type VARCHAR(32);
```

---

## 变更记录

| 日期 | 版本 | 变更 | 作者 |
|------|------|------|------|
| 2026-06-03 | v1.0 | Phase 1 数据模型初稿：projects / traces / spans / sessions / prompts | 小架 |

---

> _🔥 数据模型是萤火的骨架。平台无关，一切从 metadata 中生长。_
