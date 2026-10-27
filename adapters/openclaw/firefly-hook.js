#!/usr/bin/env node
/**
 * firefly-hook.js — OpenClaw internal hook for Firefly observability
 *
 * Usage: Add to hooks.internal.entries in openclaw.json
 *
 * Sends turn data to Firefly ingestion API after each agent turn.
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");

// ── Config ───────────────────────────────────────────────────────────────────
const FIREFLY_BASE_URL = process.env.FIREFLY_BASE_URL || "http://localhost:8000";
const FIREFLY_API_KEY = process.env.FIREFLY_API_KEY || "";
const FIREFLY_PROJECT_ID = process.env.FIREFLY_PROJECT_ID || "";

function stringValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function pickValue(...values) {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function correlationMetadata(turn, ctx, fallbackId) {
  const turnId = pickValue(turn?.turnId, turn?.turn_id, turn?.id, ctx?.turnId, ctx?.turn_id);
  const requestId = pickValue(turn?.requestId, turn?.request_id, ctx?.requestId, ctx?.request_id);
  const messageId = pickValue(turn?.messageId, turn?.message_id, ctx?.messageId, ctx?.message_id);
  const runId = pickValue(turn?.runId, turn?.run_id, ctx?.runId, ctx?.run_id);
  const correlationId = pickValue(turn?.correlationId, turn?.correlation_id, turnId, requestId, messageId, runId, fallbackId);

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

// ── HTTP client ──────────────────────────────────────────────────────────────
function post(path, data) {
  const url = new URL(path, FIREFLY_BASE_URL);
  const body = JSON.stringify(data);
  const proto = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = proto.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Firefly-Key": FIREFLY_API_KEY,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode, body: buf });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main hook handler ────────────────────────────────────────────────────────
async function onTurnEnd(ctx) {
  if (!FIREFLY_API_KEY || !FIREFLY_PROJECT_ID) {
    console.warn("[Firefly] Skipped: set FIREFLY_API_KEY and FIREFLY_PROJECT_ID first.");
    return;
  }
  const { turn, session, agent } = ctx;

  try {
    const now = new Date().toISOString();
    const nativeTraceId = pickValue(turn?.traceId, turn?.trace_id, turn?.turnId, turn?.turn_id, turn?.id);
    const traceId = isUuid(nativeTraceId) ? nativeTraceId : crypto.randomUUID();
    const correlation = correlationMetadata(turn, ctx, traceId);

    const payload = {
      project_id: FIREFLY_PROJECT_ID,
      session_id: session?.sessionKey || session?.id || crypto.randomUUID(),
      trace_id: traceId,
      name: `webchat:${agent?.id || "main"} — ${turn.prompt?.substring(0, 80) || "turn"}`,
      input: {
        prompt: turn.prompt,
        tools: turn.toolsUsed || [],
        sessionKey: session?.sessionKey,
        agentId: agent?.id,
        channel: "webchat",
        model: turn.model,
        turnId: correlation["openclaw.turn.id"],
        requestId: correlation["openclaw.request.id"],
        runId: correlation["openclaw.run.id"],
      },
      output: {
        content: turn.response?.substring?.(0, 5000) || "[no response]",
      },
      timestamp_start: now,
      latency_ms: turn.latencyMs || 0,
      total_tokens: (turn.inputTokens || 0) + (turn.outputTokens || 0),
      status: turn.error ? "error" : "ok",
      metadata: {
        provider: turn.provider || "deepseek",
        model: turn.model || "unknown",
        agent_id: agent?.id,
        channel: "webchat",
        session_key: session?.sessionKey,
        ...correlation,
      },
      tags: ["openclaw", agent?.id || "main"],
      spans: [
        {
          span_id: crypto.randomUUID(),
          type: "gen_ai.chat",
          name: turn.model || "llm",
          model: turn.model,
          provider: turn.provider || "deepseek",
          input: {
            messages: [{ role: "user", content: turn.prompt?.substring(0, 2000) || "" }],
          },
          output: {
            content: turn.response?.substring?.(0, 2000) || "",
          },
          tokens_input: turn.inputTokens || 0,
          tokens_output: turn.outputTokens || 0,
          latency_ms: turn.latencyMs || 0,
          timestamp_start: now,
          status: turn.error ? "error" : "ok",
          metadata: {
            ...correlation,
            stop_reason: turn.stopReason || null,
          },
        },
      ],
    };

    const result = await post("/api/v1/ingest/trace", payload);
    console.log(`[Firefly] Ingest: ${result.status} trace_id=${traceId} spans=${result.body?.span_count}`);

    if (result.status !== 202) {
      console.warn(`[Firefly] Unexpected status ${result.status}:`, JSON.stringify(result.body));
    }
  } catch (err) {
    console.error("[Firefly] Hook error:", err.message);
  }
}

// ── Export ───────────────────────────────────────────────────────────────────
module.exports = { onTurnEnd };
