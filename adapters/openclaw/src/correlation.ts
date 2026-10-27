import type { OpenClawTurn } from "./types.js";

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const trimmed = String(value).trim();
    return trimmed || null;
  }
  return null;
}

function extraValue(turn: OpenClawTurn, key: string): string | null {
  return text(turn.extra?.[key]);
}

export function deriveCorrelationId(turn: OpenClawTurn, fallbackId: string): string {
  return (
    text(turn.correlationId) ??
    text(turn.turnId) ??
    extraValue(turn, "openclaw.turn.id") ??
    extraValue(turn, "openclaw.turn_id") ??
    text(turn.requestId) ??
    extraValue(turn, "openclaw.request.id") ??
    extraValue(turn, "openclaw.request_id") ??
    text(turn.messageId) ??
    extraValue(turn, "openclaw.message.id") ??
    extraValue(turn, "openclaw.message_id") ??
    text(turn.runId) ??
    extraValue(turn, "openclaw.run.id") ??
    extraValue(turn, "openclaw.run_id") ??
    fallbackId
  );
}

export function buildCorrelationMetadata(
  turn: OpenClawTurn,
  fallbackId: string
): Record<string, unknown> {
  const correlationId = deriveCorrelationId(turn, fallbackId);
  const turnId = text(turn.turnId) ?? extraValue(turn, "openclaw.turn.id") ?? extraValue(turn, "openclaw.turn_id");
  const requestId = text(turn.requestId) ?? extraValue(turn, "openclaw.request.id") ?? extraValue(turn, "openclaw.request_id");
  const messageId = text(turn.messageId) ?? extraValue(turn, "openclaw.message.id") ?? extraValue(turn, "openclaw.message_id");
  const runId = text(turn.runId) ?? extraValue(turn, "openclaw.run.id") ?? extraValue(turn, "openclaw.run_id");

  return {
    "firefly.bundle_id": correlationId,
    "firefly.trace_bundle_id": correlationId,
    "firefly.turn_id": correlationId,
    "firefly.correlation_id": correlationId,
    "openclaw.turn.id": turnId,
    "openclaw.turn_id": turnId,
    "openclaw.request.id": requestId,
    "openclaw.request_id": requestId,
    "openclaw.message.id": messageId,
    "openclaw.message_id": messageId,
    "openclaw.run.id": runId,
    "openclaw.run_id": runId,
  };
}
