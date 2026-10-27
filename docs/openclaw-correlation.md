# OpenClaw Correlation Attributes

Firefly can already aggregate split OpenClaw OTLP events with a read-side
fallback window, but the durable fix is for OpenClaw diagnostics-otel to emit a
stable turn/request correlation ID on every span produced by the same user turn.

## Recommended Attribute

Prefer this exact attribute on all spans in one OpenClaw user turn:

```text
openclaw.turn.id=<stable-turn-id>
```

The value must be identical across:

- `openclaw.message.processed`
- `openclaw.model.call`
- `openclaw.model.usage`
- `openclaw.harness.run`
- `openclaw.tool.execution`
- retrieval/context assembly spans, if present

## Accepted Aliases

Firefly also recognizes these strong correlation keys:

```text
firefly.bundle_id
firefly.trace_bundle_id
firefly.turn_id
firefly.correlation_id
langfuse.trace.id
openclaw.turn_id
openclaw.request.id
openclaw.request_id
openclaw.message.id
openclaw.message_id
openclaw.run.id
openclaw.run_id
openclaw.trace.id
openclaw.trace_id
openclaw.traceId
gen_ai.operation.id
gen_ai.request.id
```

## Current Fallback

When no strong correlation ID exists, `GET /api/v1/traces/{trace_id}/bundle`
groups by:

```text
project_id + metadata.platform + bounded timestamp window
```

The API marks this as:

```json
{
  "metadata": {
    "firefly": {
      "bundle": {
        "strategy": "project_platform_time_window",
        "confidence": "fallback"
      }
    }
  }
}
```

When a strong ID is present, the bundle metadata becomes:

```json
{
  "strategy": "correlation_id",
  "confidence": "strong",
  "correlation_key": "openclaw.turn.id",
  "correlation_id": "..."
}
```

## Firefly Adapter Status

The Firefly OpenClaw adapter and bundled OpenClaw plugin now emit the correlation
metadata above on both trace and span payloads. They also keep `trace_id` as a
UUID and put OpenClaw-native IDs in metadata, so non-UUID OpenClaw run/turn IDs
do not break ingestion.

For the current local OpenClaw setup that uses the built-in `diagnostics-otel`
plugin, the installed local package has been patched to emit these accepted
keys in future spans. Historical spans that were ingested before this patch do
not have the keys, so Firefly will continue to mark those older bundles as
`confidence=fallback`.
