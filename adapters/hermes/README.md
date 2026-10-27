# firefly-hermes

> Firefly observability adapter for the **Hermes** Agent framework.
> Ships per-turn trace + span data to a Firefly ingest backend via async HTTP.

---

## Installation

```bash
pip install -e .
# or, with uv:
uv pip install -e .
```

Requires Python ≥ 3.10.

---

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable              | Required | Default                  | Description                        |
|-----------------------|----------|--------------------------|------------------------------------|
| `FIREFLY_API_KEY`     | ✅       | —                        | Shared Firefly ingestion key       |
| `FIREFLY_PROJECT_ID`  | ✅       | —                        | UUID of the target Firefly project |
| `FIREFLY_BASE_URL`    | ❌       | `http://localhost:8000`  | Firefly backend URL                |

Load the `.env` file before running your agent (e.g. with `python-dotenv`):

```python
from dotenv import load_dotenv
load_dotenv()
```

---

## Quick Start

```python
import asyncio
from firefly_hermes import create_adapter

adapter = create_adapter()   # reads env vars

# At the end of every Hermes agent turn:
turn_data = {
    "name":       "my-agent-turn",
    "session_id": "sess-abc",
    "user_id":    "user-123",
    "agent_id":   "hermes-001",
    "input":      "What is the weather in Beijing?",
    "output":     "It is sunny and 28 °C.",
    "start_ts":   1717401600.0,   # epoch seconds
    "end_ts":     1717401601.8,
    "status":     "ok",
    "tags":       ["weather", "demo"],
    "spans": [
        {
            "type":         "gen_ai.chat",
            "name":         "llm-call",
            "model":        "qwen-plus",
            "provider":     "alibaba",
            "input":        [{"role": "user", "content": "What is the weather in Beijing?"}],
            "output":       "It is sunny and 28 °C.",
            "tokens_input": 18,
            "tokens_output": 12,
            "start_ts":     1717401600.1,
            "end_ts":       1717401601.7,
        }
    ],
}

async def main():
    ok = await adapter.on_turn_end(turn_data)
    print("Trace delivered:", ok)

asyncio.run(main())
```

---

## Span Types

| `SpanType` value      | Semantic meaning                  |
|-----------------------|-----------------------------------|
| `gen_ai.chat`         | LLM chat / completion call        |
| `gen_ai.tool`         | Tool / function call              |
| `gen_ai.retrieval`    | Vector / keyword retrieval        |
| `gen_ai.agent`        | Agent-level orchestration step    |
| `gen_ai.chain`        | Multi-step chain execution        |
| `gen_ai.embedding`    | Embedding generation              |

---

## Advanced Usage

### Manual client + builder

```python
from firefly_hermes import FireflyConfig
from firefly_hermes.client import FireflyClient
from firefly_hermes.tracer import TraceBuilder
from firefly_hermes.types import SpanType

config = FireflyConfig(
    api_key="my-key",
    base_url="https://firefly.example.com",
    project_id="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
)

builder = TraceBuilder(project_id=config.project_id)
span = builder.build_span(
    trace_id="some-trace-id",
    span_type=SpanType.tool,
    name="search-tool",
    input={"query": "Beijing weather"},
    output={"result": "sunny 28°C"},
)

async with FireflyClient(config) as client:
    await client.ingest_span(span)
```

---

## Project Structure

```
hermes/
├── pyproject.toml
├── .env.example
├── README.md
└── firefly_hermes/
    ├── __init__.py   # public API surface
    ├── types.py      # Pydantic v2 models + enums
    ├── client.py     # async HTTP client (httpx)
    ├── tracer.py     # TraceBuilder — turn dict → Firefly models
    └── adapter.py    # HermesAdapter + create_adapter() factory
```

---

## License

Part of the **Firefly** open-source Agent observability project.
