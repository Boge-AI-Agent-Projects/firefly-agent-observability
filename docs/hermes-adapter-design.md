# 萤火 Firefly — Hermes Adapter 设计文档

> **版本**: v0.1.0-draft
> **日期**: 2026-06-03
> **状态**: 实验性设计
> **目标框架**: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (v2026.5.29+, Apache 2.0)

> Hermes Adapter 已包含可复用客户端与数据映射代码，但尚未完成生产环境端到端验收。

---

## 目录

1. [Hermes 架构概述](#1-hermes-架构概述)
2. [插桩策略](#2-插桩策略)
3. [Trace & Span 构建逻辑](#3-trace--span-构建逻辑)
4. [Event → Span 映射表](#4-event--span-映射表)
5. [包结构设计](#5-包结构设计)
6. [使用方式设计](#6-使用方式设计)
7. [关键设计决策](#7-关键设计决策)
8. [实施路线图](#8-实施路线图)

---

## 1. Hermes 架构概述

### 1.1 核心组件

Hermes Agent 是一个自学习、多平台、持久化记忆的 AI Agent 框架，核心架构如下：

```
┌──────────────────────────────────────────────────────────────────┐
│ Entry Points                                                     │
│  CLI (cli.py)  Gateway (gateway/run.py)  ACP (acp_adapter/)     │
│  Batch Runner  Python Library (import AIAgent)                  │
└──────────┬──────────────┬───────────────────────┬────────────────┘
           │              │                       │
           ▼              ▼                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ AIAgent (run_agent.py) — 核心 Agent Loop                        │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Prompt       │  │ Provider     │  │ Tool         │          │
│  │ Builder      │  │ Resolution   │  │ Dispatch     │          │
│  │ (prompt_     │  │ (runtime_    │  │ (model_      │          │
│  │  builder.py) │  │  provider.py)│  │  tools.py)   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐          │
│  │ Compression  │  │ 3 API Modes  │  │ Tool Registry│          │
│  │ & Caching    │  │ chat_compl.  │  │ (registry.py)│          │
│  │              │  │ codex_resp.  │  │ 70+ tools    │          │
│  └──────────────┘  │ anthropic    │  │ 28 toolsets  │          │
│                    └──────────────┘  └──────────────┘          │
└─────────┴─────────────────┴─────────────────┴────────────────────┘
          │                                    │
          ▼                                    ▼
┌────────────────────┐              ┌────────────────────────┐
│ Session Storage    │              │ Tool Backends           │
│ (SQLite + FTS5)    │              │ Terminal (6 backends)   │
│ hermes_state.py    │              │ Browser (5 backends)    │
│ gateway/session.py │              │ Web (4 backends)        │
└────────────────────┘              │ MCP (dynamic)           │
                                    └────────────────────────┘
```

**关键模块说明：**

| 模块 | 文件 | 职责 |
|------|------|------|
| **AIAgent** | `run_agent.py` | 核心对话循环，~4400 行。负责 prompt 组装、API 调用、工具执行、压缩、重试、fallback |
| **Prompt Builder** | `agent/prompt_builder.py` | 组装系统 prompt：identity → context files → memory → profile → timestamp |
| **Tool Registry** | `tools/registry.py` | 中央工具注册，70+ 工具，28 个 toolset，import 时自注册 |
| **Model Tools** | `model_tools.py` | 工具 schema 收集 + `handle_function_call()` dispatch |
| **Toolsets** | `toolsets.py` | 工具分组和平台预设 |
| **Hermes State** | `hermes_state.py` | SQLite + FTS5 会话/状态数据库 |
| **Plugin Manager** | `hermes_cli/plugins.py` | 插件发现、加载、hook 调度 |
| **Gateway Hooks** | `gateway/hooks.py` | Gateway 生命周期事件分发 |
| **Memory Manager** | `agent/memory_manager.py` | 持久记忆编排 |
| **Context Engine** | `agent/context_engine.py` | 可插拔上下文管理（ABC） |

### 1.2 Agent 生命周期（Turn Lifecycle）

AIAgent 的每次 `run_conversation()` 调用对应一个完整的 Turn，流程如下：

```
run_conversation(user_message)
  │
  ├─ 1. 生成 task_id（UUID）
  ├─ 2. 将 user_message 追加到 conversation_history
  ├─ 3. 构建/复用 System Prompt（prompt_builder.py）
  ├─ 4. 检查是否需要 preflight 压缩（>50% 上下文）
  ├─ 5. 构建 API messages（格式因 provider 而异）：
  │     chat_completions → OpenAI 格式
  │     codex_responses → Responses API 格式
  │     anthropic_messages → 通过 anthropic_adapter.py 转换
  ├─ 6. 注入临时 prompt 层（budget warning, context pressure）
  ├─ 7. 应用 Anthropic prompt caching markers（若适用）
  ├─ 8. 进行可中断 API 调用 (_interruptible_api_call)
  │     ┌─ Main Thread: 等待 response / interrupt / timeout
  │     └─ API Thread: HTTP POST → provider
  ├─ 9. 解析响应：
  │     ├── 有 tool_calls →
  │     │   ├─ 并行/串行执行工具（ThreadPoolExecutor / sequential）
  │     │   ├─ 每个工具：fire pre_tool_call → execute → fire post_tool_call
  │     │   ├─ 追加 {"role": "tool", ...} 到 history
  │     │   └─ 回到步骤 5（loop）
  │     └── 文本响应 →
  │         ├─ 持久化 session
  │         ├─ flush memory（如需要）
  │         └─ return result
  └─ 10. 迭代预算用尽时 → fallback summary → return
```

**关键特性：**

- **迭代预算**：默认 90 次（`agent.max_turns`），子 Agent 独立 50 次（`delegation.max_iterations`）
- **Fallback Model**：主模型失败时按 `fallback_providers` 列表依次尝试
- **中断支持**：API 调用在后台线程执行，主线程可接收中断信号
- **消息交替**：严格强制 OpenAI 角色交替规则
- **Agent-Level 工具**：`todo`、`memory`、`session_search`、`delegate_task` 被 `run_agent.py` 拦截处理

### 1.3 三大 Hook 系统

Hermes 有三个并行的 hook 系统，覆盖不同场景：

| Hook 系统 | 注册方式 | 运行位置 | 返回/修改能力 | 典型用途 |
|-----------|---------|---------|:---:|---------|
| **Gateway Hooks** | `~/.hermes/hooks/<name>/` (HOOK.yaml + handler.py) | Gateway only | ❌ 仅观察 | 日志、告警、webhook、BOOT.md |
| **Plugin Hooks** | `ctx.register_hook()` in plugin `register()` | CLI + Gateway | ✅ 部分可修改 | 工具拦截、metrics、guardrails、上下文注入 |
| **Shell Hooks** | `~/.hermes/config.yaml` hooks block | CLI + Gateway | ✅ 部分可修改 | 临时脚本、格式化、阻断 |

**三者均非阻塞** — hook 中的错误仅被捕获日志，不会导致 agent 崩溃。

#### 1.3.1 Gateway Hook 事件

| 事件 | 触发时机 | Context 字段 |
|------|---------|-------------|
| `gateway:startup` | Gateway 启动 | `platforms` |
| `session:start` | 新消息会话创建 | `platform`, `user_id`, `session_id`, `session_key` |
| `session:end` | 会话结束 | `platform`, `user_id`, `session_key` |
| `session:reset` | `/new` 或 `/reset` | `platform`, `user_id`, `session_key` |
| `agent:start` | Agent 开始处理消息 | `platform`, `user_id`, `session_id`, `message` |
| `agent:step` | 工具调用循环的每次迭代 | `platform`, `user_id`, `session_id`, `iteration`, `tool_names` |
| `agent:end` | Agent 处理完成 | `platform`, `user_id`, `session_id`, `message`, `response` |
| `command:*` | 任何 slash 命令 | `platform`, `user_id`, `command`, `args` |

#### 1.3.2 Plugin Hook 事件（⭐ 主要插桩面）

| Hook | 触发时机 | 返回值 | 关键参数 |
|------|---------|:---:|------|
| **`pre_tool_call`** | 工具执行前 | `{"action":"block","message":str}` 可阻断 | `tool_name`, `args`, `task_id` |
| **`post_tool_call`** | 工具执行后 | ignored | `tool_name`, `args`, `result`, `task_id`, `duration_ms` |
| **`pre_llm_call`** | LLM 调用前（每 turn 一次） | `{"context":str}` 可注入上下文 | `task_id` |
| **`post_llm_call`** | LLM 循环结束后 | ignored | `task_id` |
| **`on_session_start`** | 新 session 创建 | ignored | `session_key`, `platform` |
| **`on_session_end`** | Session 结束 | ignored | `session_key` |
| **`on_session_finalize`** | CLI/gateway 销毁 session | ignored | `session_key` |
| **`on_session_reset`** | Session key 切换 | ignored | `old_session_key`, `new_session_key` |
| **`subagent_stop`** | 子 Agent 退出 | ignored | `parent_task_id`, `child_task_id` |
| **`pre_gateway_dispatch`** | Gateway 收到消息（鉴权前） | `{"action":"skip"\|"rewrite"\|"allow"}` | `platform`, `user_id`, `message` |
| **`pre_approval_request`** | 危险命令需要审批 | ignored | `tool_name`, `command` |
| **`post_approval_response`** | 审批响应到达 | ignored | `approved`, `tool_name` |
| **`transform_tool_result`** | 工具结果返回后 | `str` 替换结果 / `None` 不修改 | `tool_name`, `result`, `task_id` |
| **`transform_terminal_output`** | 终端输出后 | `str` 替换输出 / `None` 不修改 | `command`, `output`, `task_id` |
| **`transform_llm_output`** | LLM 最终响应后 | `str` 替换响应 / `None` 不修改 | `response`, `task_id` |

### 1.4 可用 Hook 插桩点总结

对于 observability 数据采集，以下 hook 点是关键：

```
┌─────────────────────────────────────────────────────────────────┐
│ 用户消息 ──▶ [on_session_start]                                  │
│             │                                                    │
│             ▼                                                    │
│ ┌───────────────────────────────────────┐                       │
│ │  AIAgent.run_conversation()          │                       │
│ │                                       │                       │
│ │  [pre_llm_call] ── 开始 LLM 循环 ←───│── Trace 开始           │
│ │       │                               │                       │
│ │       ▼                               │                       │
│ │  ┌─────────┐                          │                       │
│ │  │ LLM API │ ◀── [gen_ai.chat Span]   │                       │
│ │  │  Call   │                          │                       │
│ │  └────┬────┘                          │                       │
│ │       │ tool_calls?                   │                       │
│ │       ▼                               │                       │
│ │  [pre_tool_call] ── 工具执行前        │                       │
│ │       │                               │                       │
│ │       ▼                               │                       │
│ │  ┌─────────┐                          │                       │
│ │  │  Tool   │ ◀── [gen_ai.tool Span]   │                       │
│ │  │ Handler │                          │                       │
│ │  └────┬────┘                          │                       │
│ │       │                               │                       │
│ │  [post_tool_call] ── 工具执行后       │                       │
│ │       │                               │                       │
│ │       ▼                               │                       │
│ │  Loop back ── 继续迭代                │                       │
│ │                                       │                       │
│ │  [post_llm_call] ── LLM 循环结束 ◀───│── Trace 结束          │
│ │                                       │                       │
│ │  [transform_llm_output] ── 最终响应   │                       │
│ └───────────────────────────────────────┘                       │
│             │                                                    │
│             ▼                                                    │
│  [on_session_end] ── Session 结束                                │
└─────────────────────────────────────────────────────────────────┘
```

### 1.5 Python Library 集成方式（⭐ 我们的入口点）

Hermes 支持作为 Python Library 直接使用 `AIAgent`：

```python
from run_agent import AIAgent

agent = AIAgent(
    model="deepseek/deepseek-v4-pro",
    quiet_mode=True,
    enabled_toolsets=["web"],
)

# 简单接口
response = agent.chat("What is the capital of France?")

# 完整接口
result = agent.run_conversation(
    user_message="Fix the bug in main.py",
    system_message=None,
    conversation_history=None,
    task_id="task_abc123",
)
# result = {"final_response": str, "messages": [...], "metadata": {...}}
```

**关键发现**：`AIAgent` 接受 `callbacks` 参数（`tool_progress_callback`、`step_callback`、`thinking_callback`、`reasoning_callback`、`status_callback`、`stream_delta_callback`），这些 callback 表面 + Plugin Hook 系统共同构成我们的插桩基础。

---

## 2. 插桩策略

### 2.1 总体方案：Plugin + Wrapper 双路径

```
┌───────────────────────────────────────────────────────────────┐
│                    Firefly Hermes Adapter                     │
│                                                               │
│  路径 A: Plugin Hook（推荐，零侵入）                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ firefly_hermes/plugin.py                                │ │
│  │   ctx.register_hook("pre_llm_call", ...)                │ │
│  │   ctx.register_hook("post_llm_call", ...)               │ │
│  │   ctx.register_hook("pre_tool_call", ...)               │ │
│  │   ctx.register_hook("post_tool_call", ...)              │ │
│  │   ctx.register_hook("on_session_start", ...)            │ │
│  │   ctx.register_hook("on_session_end", ...)              │ │
│  │   ctx.register_hook("subagent_stop", ...)               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  路径 B: AIAgent Wrapper（当用户使用 Python Library 时）       │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ firefly_hermes/adapter.py                               │ │
│  │   class FireflyHermesAdapter:                           │ │
│  │     def chat(user_message):                             │ │
│  │       # 包装 AIAgent.chat()，注入可观测性               │ │
│  │     def run_conversation(user_message):                 │ │
│  │       # 包装 AIAgent.run_conversation()                 │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  路径 C: Gateway Hook 文件（当用户使用 Gateway 时）            │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ ~/.hermes/hooks/firefly/                                │ │
│  │   ├── HOOK.yaml                                         │ │
│  │   └── handler.py  ← from firefly_hermes import ...      │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

**推荐优先级**：Plugin Hook (A) > Wrapper (B) > Gateway Hook (C)

原因：Plugin Hook 运行在 CLI + Gateway 双环境，覆盖面最广，且 Hermes v2026.5.29 版本的 plugin hook 已经提供 `pre_tool_call`、`post_tool_call`、`pre_llm_call`、`post_llm_call` 等关键事件。

### 2.2 各生命周期节点的数据捕获

#### 2.2.1 Session 级别（`on_session_start` / `on_session_end`）

```python
def on_session_start(session_key, platform, **kwargs):
    """创建 Firefly Session 记录"""
    # 捕获:
    # - session_key (Hermes 内部 session 标识)
    # - platform (cli / telegram / discord / ...)
    # - user_id (从 platform context 提取)
    # - timestamp_start

def on_session_end(session_key, **kwargs):
    """标记 Session 结束"""
    # 捕获:
    # - timestamp_end
    # - 触发 flush buffer（发送该 session 下所有 pending traces）
```

#### 2.2.2 Turn 级别（`pre_llm_call` / `post_llm_call`）

```python
def pre_llm_call(task_id, **kwargs):
    """Turn 开始 → 创建 Firefly Trace"""
    # 捕获:
    # - trace_id (生成 UUID v7)
    # - task_id = Hermes 内部 task_id
    # - user_message (从 conversation_history 的最后一条 user message 获取)
    # - timestamp_start
    # - 创建 Trace 数据结构，暂存

def post_llm_call(task_id, **kwargs):
    """Turn 结束 → 完成 Firefly Trace"""
    # 捕获:
    # - final_response (从 conversation_history 的最后一条 assistant message 获取)
    # - total_tokens (聚合所有 LLM span 的 tokens)
    # - total_cost (聚合所有 LLM span 的 cost)
    # - timestamp_end
    # - 关闭 Trace → 发送到 Firefly Ingestion API
```

#### 2.2.3 Tool 级别（`pre_tool_call` / `post_tool_call`）

```python
def pre_tool_call(tool_name, args, task_id, **kwargs):
    """工具执行前 → 创建 gen_ai.tool Span"""
    # 捕获:
    # - span_id (生成 UUID v7)
    # - tool_name → span.name
    # - args → span.input
    # - timestamp_start
    # - 关联到当前 Turn 的 Trace

def post_tool_call(tool_name, args, result, task_id, duration_ms, **kwargs):
    """工具执行后 → 完成 gen_ai.tool Span"""
    # 捕获:
    # - result → span.output
    # - duration_ms → span.latency_ms
    # - timestamp_end
    # - status (ok / error)
    # - 完成 Span → 追加到 Trace
```

#### 2.2.4 子 Agent 级别（`subagent_stop`）

```python
def subagent_stop(parent_task_id, child_task_id, **kwargs):
    """子 Agent 完成 → 创建 gen_ai.agent Span"""
    # 捕获:
    # - child_task_id → 关联子 Agent 的 Trace
    # - parent_task_id → 关联父 Trace
    # - 创建 gen_ai.agent 类型的 Span
```

### 2.3 本地缓冲与状态管理

由于 Hermes 的 hook 系统是事件驱动的，我们在 adapter 内部维护一个内存状态机：

```python
class TraceBuilder:
    """Trace 构建器 — 在内存中组装 Trace + Spans"""

    def __init__(self):
        self._active_traces: dict[str, TraceData] = {}   # task_id → TraceData
        self._pending_spans: dict[str, list[SpanData]] = {}  # task_id → pending spans
        self._session_meta: dict[str, SessionMeta] = {}  # session_key → SessionMeta

    def start_trace(self, task_id, session_key, user_id, user_message):
        """创建新 Trace"""
        ...

    def add_span(self, task_id, span_data):
        """添加 Span 到当前 Trace"""
        ...

    def finish_trace(self, task_id, final_response, total_tokens, total_cost):
        """完成 Trace → 发送到 Firefly"""
        ...

    def flush(self):
        """强制 flush 所有待发送的 Traces"""
        ...
```

---

## 3. Trace & Span 构建逻辑

### 3.1 数据流架构

```
Hermes Agent Loop                Firefly Adapter              Firefly Backend
─────────────────                ───────────────              ───────────────

pre_llm_call(task_id)      →     start_trace(task_id)
  [LLM Call 1]             →     add_span(gen_ai.chat)
  [Tool Call A]            →     add_span(gen_ai.tool)
  [LLM Call 2]             →     add_span(gen_ai.chat)
  [Tool Call B]            →     add_span(gen_ai.tool)
  [LLM Call 3 - final]     →     add_span(gen_ai.chat)
post_llm_call(task_id)     →     finish_trace(task_id)  →  POST /api/v1/ingest/trace
```

### 3.2 Span 树结构

每个 Hermes Turn 生成如下 Span 树：

```
gen_ai.agent (Turn Root Span)              ← parent_span_id = null
├── gen_ai.chat (LLM Call #1)               ← 包含 tool_calls
│   ├── gen_ai.tool (tool executed #A)      ← 并行工具调用
│   └── gen_ai.tool (tool executed #B)      ← 并行工具调用
├── gen_ai.chat (LLM Call #2)               ← 处理 tool results 后的第二轮
│   └── gen_ai.tool (tool executed #C)
├── gen_ai.chat (LLM Call #3 - final)       ← 最终回复
└── ...
```

**设计决策**：

- **根 Span** 使用 `gen_ai.agent` 类型，覆盖整个 Turn
- 每轮 LLM 调用是 `gen_ai.chat`
- 每次工具执行是 `gen_ai.tool`
- 子 Agent 委托是 `gen_ai.agent`（嵌套）

### 3.3 LLM Span 构建（特殊处理）

由于 Hermes 的 plugin hook 系统在 LLM 调用前后只有 `pre_llm_call` / `post_llm_call`（**per turn**，而非 per API call），无法直接拦截每次 LLM API 调用。

**解决方案**：

1. **利用 `transform_llm_output` + 内部计数器**：在 `post_llm_call` 中遍历 `conversation_history`，识别 assistant message 中的 tool_calls 来反向推算 LLM 调用次数
2. **或者使用 AIAgent 的 `step_callback`**（如果通过 Python Library 使用）：`step_callback(iteration, tool_names)` 在每次迭代后触发
3. **推荐方案（Phase 1）**：基于 `post_llm_call` 后解析 `conversation_history` 来提取每轮 LLM 调用

```python
def _extract_llm_spans(conversation_history: list[dict], task_id: str) -> list[SpanData]:
    """从 conversation_history 反向提取 LLM 调用 Span"""
    spans = []
    for msg in conversation_history:
        if msg["role"] == "assistant":
            # 这是一次 LLM 响应
            span = SpanData(
                id=generate_uuid_v7(),
                trace_id=task_id_to_trace_id[task_id],
                type="gen_ai.chat",
                name=f"chat {model_name}",
                model=model_name,
                input={"messages": preceding_messages},
                output={"content": msg.get("content", ""), "tool_calls": msg.get("tool_calls", [])},
                # tokens/cost 从 usage metadata 获取（如有）
            )
            spans.append(span)
    return spans
```

**局限性**：Phase 1 可能无法获得每次 LLM 调用的精确 token 用量（因为 Hermes 不暴露 per-call usage stats）。这是已知限制，后续可通过以下方式改善：
- 贡献 PR 到 Hermes 添加 `pre_llm_api_call` / `post_llm_api_call` hook
- 使用 streaming callback 自行计数 token

### 3.4 数据脱敏策略

遵循 Firefly 数据安全原则：

```python
MASK_FIELDS = {
    "tool_args": ["api_key", "token", "password", "secret", "credential"],
    "tool_result": ["api_key", "token", "authorization"],
    "user_input": [],  # Phase 1 不做脱敏，Phase 2 可加
}

def mask_sensitive(data: dict, field_groups: list[str]) -> dict:
    """对指定字段组进行脱敏"""
    # 递归遍历 JSON 结构
    # 匹配到的敏感字段替换为 "***REDACTED***"
    ...
```

---

## 4. Event → Span 映射表

### 4.1 完整映射

| Hermes 事件 | Firefly Span Type | 触发时机 | 关键字段映射 |
|-------------|-------------------|---------|-------------|
| **`on_session_start`** | *Session metadata* | 新 session 创建 | `session_key` → `session.id`, `platform` → `metadata.platform`, `user_id` → `session.user_id` |
| **`pre_llm_call`** | *Trace 开始* | Turn 开始 | 生成 `trace.id` (UUID v7), `task_id` → `metadata.source_trace_id`, `timestamp_start` |
| **`[LLM API Call]`** (间接) | `gen_ai.chat` | 每次 LLM API 调用 | `model` → `span.model`, `messages` → `span.input`, `completion` → `span.output`, `usage` → `tokens_input/output`, `finish_reason` → `metadata.finish_reason` |
| **`pre_tool_call`** | `gen_ai.tool` (开始) | 工具执行前 | `tool_name` → `span.name`, `args` → `span.input`, `timestamp_start` |
| **`post_tool_call`** | `gen_ai.tool` (完成) | 工具执行后 | `result` → `span.output`, `duration_ms` → `span.latency_ms`, `status` (ok/error), `timestamp_end` |
| **`subagent_stop`** | `gen_ai.agent` | 子 Agent 退出 | `child_task_id` → 子 Trace 关联, `parent_task_id` → `metadata.parent_task_id` |
| **`post_llm_call`** | *Trace 完成* | Turn 结束 | 聚合 `total_tokens`/`total_cost`/`span_count`/`error_count`, `final_response` → `trace.output`, `timestamp_end` |
| **`on_session_end`** | *Session 关闭* | Session 结束 | `timestamp_end` → flush buffer, 更新 session 统计 |

### 4.2 metadata 映射

```json
// Trace metadata
{
  "platform": "hermes",
  "platform_version": "2026.5.29",
  "adapter_version": "0.1.0",
  "source_trace_id": "hermes_task_abc123",
  "source_session_key": "sess_xyz",
  "gateway_platform": "telegram",
  "api_mode": "chat_completions",
  "provider": "deepseek",
  "model": "deepseek-v4-pro",
  "trigger": {
    "source": "gateway",
    "run_mode": "manual"
  },
  "deployment": {
    "hermes_home": "~/.hermes",
    "profile": "default"
  }
}

// LLM Span metadata
{
  "platform": "hermes",
  "api_mode": "chat_completions",
  "stream": true,
  "finish_reason": "stop",
  "retry_count": 0,
  "cache_hit": false
}

// Tool Span metadata
{
  "platform": "hermes",
  "tool_call_id": "call_abc123",
  "toolset": "web",
  "execution_mode": "parallel"
}
```

### 4.3 错误处理映射

| 场景 | Span status | Span status_message |
|------|:----------:|---------------------|
| 工具执行成功 | `ok` | — |
| 工具执行异常 | `error` | 异常消息（截断至 256 字符） |
| `pre_tool_call` 阻断 | `error` | `"blocked: {message}"` |
| LLM API 失败 | `error` | `"API error: {status_code} {message}"` |
| 迭代预算耗尽 | `ok` (warning) | `"max_iterations reached: {n}"` |

---

## 5. 包结构设计

```
adapters/hermes/
├── pyproject.toml              # 包元数据 + 依赖声明
├── README.md                   # 安装 & 使用说明
├── firefly_hermes/
│   ├── __init__.py             # 公开 API
│   ├── adapter.py              # FireflyHermesAdapter — 主入口
│   ├── tracer.py               # TraceBuilder — Trace/Span 构建器
│   ├── client.py               # FireflyClient — HTTP 客户端
│   ├── plugin.py               # Hermes Plugin — register(ctx) 入口
│   ├── gateway_handler.py      # Gateway Hook handler（可选路径）
│   └── types.py                # 类型定义 (dataclass/pydantic)
├── tests/
│   ├── __init__.py
│   ├── test_adapter.py
│   ├── test_tracer.py
│   ├── test_client.py
│   └── conftest.py
└── examples/
    ├── simple_chat.py          # 最简示例
    └── gateway_hook/           # Gateway hook 安装示例
        ├── HOOK.yaml
        └── handler.py
```

### 5.1 pyproject.toml

```toml
[project]
name = "firefly-hermes"
version = "0.1.0"
description = "Firefly observability adapter for Hermes Agent"
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27.0",
    "uuid7>=0.1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "pytest-mock>=3.14",
]

# Key: register as Hermes plugin via pip entry point
[project.entry-points."hermes_agent.plugins"]
firefly = "firefly_hermes.plugin:register"
```

### 5.2 核心类型定义（`types.py`）

```python
"""Firefly Hermes Adapter — 类型定义"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional
from uuid import UUID


@dataclass
class SpanData:
    """Firefly Span 数据结构"""
    id: UUID
    trace_id: UUID
    parent_span_id: Optional[UUID] = None
    type: str = "gen_ai.chat"  # gen_ai.chat | gen_ai.tool | gen_ai.agent | ...
    name: str = ""
    model: Optional[str] = None
    provider: Optional[str] = None
    model_parameters: dict = field(default_factory=dict)
    input: dict = field(default_factory=dict)
    output: dict = field(default_factory=dict)
    tokens_input: int = 0
    tokens_output: int = 0
    cost: float = 0.0
    latency_ms: int = 0
    first_token_latency_ms: Optional[int] = None
    status: str = "ok"
    status_message: Optional[str] = None
    timestamp_start: Optional[datetime] = None
    timestamp_end: Optional[datetime] = None
    metadata: dict = field(default_factory=dict)


@dataclass
class TraceData:
    """Firefly Trace 数据结构"""
    id: UUID
    project_id: UUID
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    name: str = ""
    tags: list[str] = field(default_factory=list)
    input: dict = field(default_factory=dict)
    output: dict = field(default_factory=dict)
    timestamp_start: Optional[datetime] = None
    timestamp_end: Optional[datetime] = None
    latency_ms: int = 0
    total_tokens: int = 0
    total_cost: float = 0.0
    span_count: int = 0
    error_count: int = 0
    spans: list[SpanData] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


@dataclass
class AdapterConfig:
    """Adapter 配置"""
    firefly_base_url: str = "http://localhost:8000"
    firefly_api_key: Optional[str] = None
    project_id: Optional[UUID] = None
    platform: str = "hermes"
    platform_version: str = "unknown"
    buffer_size: int = 10  # 缓冲多少 Trace 后批量发送
    flush_interval_ms: int = 5000  # 定期 flush 间隔
    async_send: bool = True  # 异步发送
    mask_sensitive: bool = True  # 脱敏
    verbose: bool = False  # 调试日志
```

---

## 6. 使用方式设计

### 6.1 方式一：Plugin 安装（推荐，零侵入）

#### Step 1: 安装

```bash
pip install firefly-hermes
```

#### Step 2: 配置

在 `~/.hermes/config.yaml` 中添加：

```yaml
plugins:
  enabled:
    - firefly

# Firefly 配置（通过环境变量）
# FIREFLY_BASE_URL=http://localhost:8000
# FIREFLY_API_KEY=sk-xxx
# FIREFLY_PROJECT_ID=01938000-0000-7000-0000-000000000100
```

或在项目根目录 `.env` 中：

```bash
FIREFLY_BASE_URL=http://localhost:8000
FIREFLY_API_KEY=sk-firefly-xxx
FIREFLY_PROJECT_ID=01938000-0000-7000-0000-000000000100
```

#### Step 3: 启用

```bash
hermes plugins enable firefly
hermes gateway restart  # 若使用 Gateway
```

**完成。** 之后 Hermes 的每次对话自动向 Firefly 发送观测数据。

### 6.2 方式二：Python Library 集成

```python
from firefly_hermes import FireflyHermesAdapter

# 3 行代码接入 Firefly
adapter = FireflyHermesAdapter(
    base_url="http://localhost:8000",
    project_id="01938000-0000-7000-0000-000000000100",
)

# 使用 Wrapper 替代原生 AIAgent
response = adapter.chat("帮我查询订单 #12345 的状态")
print(response)
```

等价于：

```python
from firefly_hermes import FireflyHermesAdapter

adapter = FireflyHermesAdapter(
    base_url="http://localhost:8000",
    project_id="01938000-0000-7000-0000-000000000100",
    model="deepseek/deepseek-v4-pro",
    platform_name="telegram",
    user_id="user_demo",
    session_id="sess_chat_20260603_001",
)

# 完整接口
result = adapter.run_conversation(
    user_message="帮我查询订单 #12345 的状态",
    system_message="你是电商订单助手...",
)
# result 中包含 Firefly trace_id 用于调试
print(f"Firefly Trace: {result.firefly_trace_id}")
```

### 6.3 方式三：Gateway Hook 文件

若不想用 Plugin 系统，可以直接在 `~/.hermes/hooks/` 下安装 hook 文件：

```bash
# 自动安装
firefly-hermes install-gateway-hook
```

这会将 `HOOK.yaml` 和 `handler.py` 复制到 `~/.hermes/hooks/firefly/`。

---

## 7. 关键设计决策

### 7.1 同步 vs 异步发送

| 方案 | 优点 | 缺点 |
|------|------|------|
| 同步发送 | 实现简单，数据不丢失 | 阻塞 Agent Loop，增加延迟 |
| 异步发送（后台线程） | 不阻塞 Agent，低延迟 | 进程崩溃可能丢失未发送数据 |
| 异步 + 本地缓冲（Phase 1 选择） | 平衡延迟与可靠性 | 实现稍复杂 |

**推荐**：**异步发送 + 内存缓冲**。

```python
class FireflyClient:
    def __init__(self, ...):
        self._buffer: list[TraceData] = []
        self._lock = threading.Lock()
        self._flush_thread: threading.Thread | None = None

    def enqueue(self, trace: TraceData):
        with self._lock:
            self._buffer.append(trace)
            if len(self._buffer) >= self.config.buffer_size:
                self._flush()

    def _flush(self):
        """异步批量发送"""
        traces_to_send = []
        with self._lock:
            traces_to_send = self._buffer[:]
            self._buffer.clear()

        if traces_to_send:
            # 在后台线程中发送，不阻塞 Agent
            threading.Thread(target=self._send_batch, args=(traces_to_send,), daemon=True).start()

    def _send_batch(self, traces: list[TraceData]):
        for trace in traces:
            try:
                self._send_trace(trace)  # POST /api/v1/ingest/trace
            except Exception as e:
                logger.error(f"Failed to send trace {trace.id}: {e}")
                # Phase 1: 失败丢弃（后续版本可加本地文件持久化重试）
```

### 7.2 本地缓冲 vs 实时发送

| 方案 | 延迟 | 可靠性 | 适用场景 |
|------|------|------|---------|
| 实时发送（每个 Span 结束即发送） | 最低 | 中等 | 实时监控 Dashboard |
| Turn 级缓冲（Turn 完成后整批发送）⭐ | 低 | 较高 | 典型场景 |
| 批量缓冲（收集 N 个 Turn 后发送） | 较高 | 最高 | 高吞吐场景 |

**推荐**：**Turn 级缓冲**（Phase 1 默认）。即 `post_llm_call` 触发时发送完整的 Trace + Spans。

这利用了 Firefly Ingestion API 的 `POST /api/v1/ingest/trace` 端点，该端点接受整条 Trace + 所有 Span 一次性写入。

### 7.3 错误处理策略

```
┌──────────────────────────────────────────────────────────────┐
│ 错误处理分层                                                  │
│                                                              │
│  Layer 1: Hook 异常 → 捕获 + 日志（Hermes 框架保证）         │
│  Layer 2: Adapter 内部异常 → 捕获 + 日志，不阻断 Agent       │
│  Layer 3: HTTP 发送失败 → 重试 1 次 + 失败丢弃（Phase 1）    │
│  Layer 4: 网络超时 → 设置合理超时（3s），避免阻塞            │
└──────────────────────────────────────────────────────────────┘
```

**原则**：**Firefly Adapter 的故障绝不能影响 Hermes Agent 的正常运行**。所有异常必须内部处理。

```python
def _safe_try(func, *args, **kwargs):
    """安全执行 — 异常仅日志，绝不传播"""
    try:
        return func(*args, **kwargs)
    except Exception as e:
        logger.warning(f"Firefly adapter error in {func.__name__}: {e}", exc_info=verbose)
        return None
```

### 7.4 与 Firefly Ingestion API 的数据映射

**端点**：`POST /api/v1/ingest/trace`

**请求体结构映射**：

```python
def trace_to_request(trace: TraceData) -> dict:
    """将 TraceData 转换为 Firefly API 请求格式"""
    return {
        "trace": {
            "id": str(trace.id),
            "project_id": str(trace.project_id),
            "session_id": trace.session_id,
            "user_id": trace.user_id,
            "name": trace.name,
            "tags": trace.tags,
            "input": trace.input,
            "output": trace.output,
            "timestamp_start": _fmt_iso(trace.timestamp_start),
            "timestamp_end": _fmt_iso(trace.timestamp_end),
            "latency_ms": trace.latency_ms,
            "total_tokens": trace.total_tokens,
            "total_cost": trace.total_cost,
            "span_count": len(trace.spans),
            "error_count": trace.error_count,
            "metadata": trace.metadata,
        },
        "spans": [_span_to_dict(s) for s in trace.spans],
    }

def _span_to_dict(span: SpanData) -> dict:
    return {
        "id": str(span.id),
        "parent_span_id": str(span.parent_span_id) if span.parent_span_id else None,
        "type": span.type,
        "name": span.name,
        "model": span.model,
        "provider": span.provider,
        "model_parameters": span.model_parameters,
        "input": span.input,
        "output": span.output,
        "tokens_input": span.tokens_input,
        "tokens_output": span.tokens_output,
        "cost": span.cost,
        "latency_ms": span.latency_ms,
        "first_token_latency_ms": span.first_token_latency_ms,
        "status": span.status,
        "status_message": span.status_message,
        "timestamp_start": _fmt_iso(span.timestamp_start),
        "timestamp_end": _fmt_iso(span.timestamp_end),
        "metadata": span.metadata,
    }
```

### 7.5 关键限制与 Phase 2 改进

| 限制 | 影响 | Phase 2 改进方向 |
|------|------|-----------------|
| 无法直接拦截每次 LLM API 调用 | 每轮 LLM 的 token 用量不精确 | 贡献 PR 给 Hermes 添加 `pre_llm_api_call` / `post_llm_api_call` hook |
| `conversation_history` 在 hook 中不可直接访问 | 需要间接方式获取历史 | 研究 `AIAgent` 内部 API 或使用 callback 参数 |
| Plugin hook 无 `cancel` 返回值（除 `pre_tool_call`） | 无法在异常时阻止后续流程 | 可以接受 — observability 仅记录，不干预 |
| 无 streaming token 级别 hook | 无法获取 TTFT（首 token 延迟） | 使用 `stream_delta_callback` 在 Python Library 模式下 |

---

## 8. 实施路线图

### Phase 1 — MVP（v0.1.0，由小码实现）

| # | 任务 | 说明 | 估时 |
|---|------|------|:---:|
| 1 | `types.py` | 定义所有数据类 | 0.5h |
| 2 | `client.py` | HTTP 客户端（POST /api/v1/ingest/trace） | 1h |
| 3 | `tracer.py` | TraceBuilder 状态机 | 2h |
| 4 | `plugin.py` | Hermes Plugin 注册（hook 绑定） | 2h |
| 5 | `adapter.py` | FireflyHermesAdapter 包装器 | 1.5h |
| 6 | 单元测试 | tests/ | 2h |
| 7 | README + examples | 文档 | 1h |
| **合计** | | | **~10h** |

### Phase 2 — 完善（v0.2.0）

- 文件持久化缓冲（防止进程崩溃数据丢失）
- 向 Hermes 上游贡献 per-LLM-call hook
- 支持 `gen_ai.retrieval` Span（当使用 `session_search` 或 web 工具时）
- Prometheus metrics 导出
- Docker 部署支持（环境变量配置）

### Phase 3 — 生产就绪（v1.0.0）

- 完整的数据脱敏引擎
- 分布式 tracing 支持（W3C Trace Context propagation）
- 跨 Agent（OpenClaw → Hermes → Python Agent Framework）trace 链接
- Dashboard 集成测试
- 性能基准测试

---

## 附录

### A. 参考链接

- [Hermes Agent GitHub](https://github.com/NousResearch/hermes-agent)
- [Hermes Agent 架构文档](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)
- [Hermes Agent Loop 内部](https://hermes-agent.nousresearch.com/docs/developer-guide/agent-loop)
- [Hermes Event Hooks 文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks)
- [Hermes Plugin 文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)
- [Hermes Enhanced Extension System Proposal (Issue #359)](https://github.com/NousResearch/hermes-agent/issues/359)
- [Firefly API 规范](./api-spec.md)
- [Firefly 数据模型](./data-model.md)

### B. 术语表

| 术语 | 说明 |
|------|------|
| **Turn** | Agent 处理一条用户消息的完整过程（含多轮 LLM 调用 + 工具调用） |
| **Trace** | Firefly 中对应一次 Turn 的完整可观测性记录 |
| **Span** | Trace 下的单个操作（LLM 调用 / 工具执行 / 子 Agent 等） |
| **task_id** | Hermes 内部任务标识，关联一个 Turn |
| **session_key** | Hermes 内部会话标识，跨多个 Turn |
| **Hook** | Hermes 的生命周期事件回调 |
| **Plugin** | Hermes 的扩展机制，可注册工具、hook 和命令 |
| **AIAgent** | Hermes 核心类（`run_agent.py`），封装完整 Agent Loop |
