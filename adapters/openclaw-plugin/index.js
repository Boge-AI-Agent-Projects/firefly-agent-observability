/**
 * Firefly Trace Plugin v2 — captures agent turns via typed hooks.
 */

import { randomUUID } from "node:crypto";

const DEFAULT_FIREFLY_URL = "http://localhost:8000";
const DEFAULT_FIREFLY_KEY = "";
const DEFAULT_PROJECT_ID = "";
const BUFFER_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_TOOL_RESULT_CHARS = 2000;
const MAX_MESSAGE_CHARS = 12000;

const traces = new Map();

let fireflyUrl = DEFAULT_FIREFLY_URL;
let fireflyKey = DEFAULT_FIREFLY_KEY;
let projectId = DEFAULT_PROJECT_ID;

// cleanup
setInterval(() => {
  const cutoff = Date.now() - BUFFER_MAX_AGE_MS;
  for (const [id, acc] of traces) if (acc.createdAt < cutoff) traces.delete(id);
}, 10 * 60 * 1000).unref();

function truncate(s, maxLen = MAX_TOOL_RESULT_CHARS) {
  if (!s || typeof s !== "string") return s;
  return s.length <= maxLen ? s : s.slice(0, maxLen) + " [truncated]";
}

function safeJson(obj) {
  try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
}
function isoNow() { return new Date().toISOString(); }
function durMs(a, b) { return Math.round(new Date(b).getTime() - new Date(a).getTime()); }

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function usageTokens(usage = {}) {
  const input = numberValue(usage.input ?? usage.input_tokens ?? usage.prompt_tokens) ?? 0;
  const output = numberValue(usage.output ?? usage.output_tokens ?? usage.completion_tokens) ?? 0;
  const total = numberValue(usage.total ?? usage.total_tokens) ?? input + output;
  return { input, output, total };
}

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

function arrayValue(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function objectValue(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return {};
}

function sanitizePayload(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value, MAX_MESSAGE_CHARS);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth > 8) return "[max depth]";
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item, depth + 1));
  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = sanitizePayload(item, depth + 1);
    return result;
  }
  return String(value);
}

function textFromContent(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map(textFromContent).filter(Boolean).join("\n");
  }
  if (typeof value !== "object") return String(value);

  const type = String(value.type || "").toLowerCase();
  if (type === "thinking") return "";
  if (type === "toolcall") return "";

  for (const key of ["text", "content", "message", "response", "result", "output", "finalResponse", "final_response"]) {
    const text = textFromContent(value[key]);
    if (text) return text;
  }
  return "";
}

function extractMessages(source = {}) {
  const messages = arrayValue(
    source.messages,
    source.historyMessages,
    source.history,
    source.conversation,
    source.inputMessages,
    source.input_messages,
    source.promptMessages
  );
  return sanitizePayload(messages);
}

function extractPrompt(source = {}, messages = []) {
  const explicit = pickValue(source.prompt, source.input, source.query, source.userInput, source.user_input);
  if (explicit) return truncate(explicit, MAX_MESSAGE_CHARS);
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const role = String(msg.role || "").toLowerCase();
    if (role === "user" || role === "human") {
      const text = textFromContent(msg.content ?? msg.text ?? msg.message);
      if (text) return truncate(text, MAX_MESSAGE_CHARS);
    }
  }
  return null;
}

function extractToolNames(source = {}) {
  return arrayValue(source.tools, source.toolDefinitions, source.availableTools, source.functions)
    .map((tool) => (typeof tool === "string" ? tool : tool?.function?.name || tool?.name || tool?.toolName))
    .filter(Boolean);
}

function extractToolCalls(source = {}) {
  return sanitizePayload(arrayValue(source.toolCalls, source.tool_calls, source.toolsCalled, source.functionCalls));
}

function extractUsage(source = {}) {
  return objectValue(source.usage, source.tokenUsage, source.tokens);
}

function extractOutputText(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    if (Array.isArray(source.assistantTexts) && source.assistantTexts.length) {
      const text = source.assistantTexts.map(textFromContent).filter(Boolean).join("");
      if (text) return truncate(text, MAX_MESSAGE_CHARS);
    }
    const direct = textFromContent(
      source.outputText ?? source.output_text ?? source.finalResponse ?? source.final_response ??
      source.response ?? source.output ?? source.content ?? source.text ?? source.message
    );
    if (direct) return truncate(direct, MAX_MESSAGE_CHARS);

    const choices = arrayValue(source.choices);
    for (const choice of choices) {
      const text = textFromContent(choice?.message ?? choice?.delta ?? choice);
      if (text) return truncate(text, MAX_MESSAGE_CHARS);
    }

    const messages = extractMessages(source);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || typeof msg !== "object") continue;
      const role = String(msg.role || "").toLowerCase();
      if (role === "assistant" || role === "ai" || role === "model") {
        const text = textFromContent(msg.content ?? msg.text ?? msg.message);
        if (text) return truncate(text, MAX_MESSAGE_CHARS);
      }
    }
  }
  return "";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function mergeCorrelation(acc, event = {}, ctx = {}, runId = null) {
  acc.turnId ||= pickValue(event.turnId, event.turn_id, event.id, ctx.turnId, ctx.turn_id);
  acc.requestId ||= pickValue(event.requestId, event.request_id, ctx.requestId, ctx.request_id);
  acc.messageId ||= pickValue(event.messageId, event.message_id, ctx.messageId, ctx.message_id);
  acc.runId ||= pickValue(event.runId, event.run_id, ctx.runId, ctx.run_id, runId);
  acc.correlationId ||= pickValue(
    event.correlationId,
    event.correlation_id,
    ctx.correlationId,
    ctx.correlation_id,
    acc.turnId,
    acc.requestId,
    acc.messageId,
    acc.runId,
    runId
  );
}

function correlationMetadata(acc) {
  const correlationId = pickValue(acc.correlationId, acc.turnId, acc.requestId, acc.messageId, acc.runId, acc.runId);

  return {
    "firefly.bundle_id": correlationId,
    "firefly.trace_bundle_id": correlationId,
    "firefly.turn_id": correlationId,
    "firefly.correlation_id": correlationId,
    "openclaw.turn.id": acc.turnId || null,
    "openclaw.turn_id": acc.turnId || null,
    "openclaw.request.id": acc.requestId || null,
    "openclaw.request_id": acc.requestId || null,
    "openclaw.message.id": acc.messageId || null,
    "openclaw.message_id": acc.messageId || null,
    "openclaw.run.id": acc.runId || null,
    "openclaw.run_id": acc.runId || null,
  };
}

class TraceAccumulator {
  constructor(runId, ctx) {
    this.runId = runId;
    this.agentCtx = ctx || {};
    this.turnId = null;
    this.requestId = null;
    this.messageId = null;
    this.correlationId = null;
    this.createdAt = Date.now();
    this.llmInputs = [];
    this.llmOutputs = [];
    this.toolCalls = [];
    this.pendingTools = new Map();
    this.startTime = isoNow();
    mergeCorrelation(this, {}, ctx, runId);
  }
}

async function postTrace(payload) {
  if (!fireflyKey || !projectId) {
    console.warn("[firefly-trace] skipped: configure fireflyKey and projectId first");
    return;
  }
  try {
    const res = await fetch(`${fireflyUrl}/api/v1/ingest/trace`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Firefly-Key": fireflyKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    console.log("[firefly-trace] ingest response:", res.status);
  } catch (err) {
    console.warn("[firefly-trace] ingest failed:", err.message);
  }
}

function assembleTrace(acc) {
  const { runId, agentCtx, llmInputs, llmOutputs, toolCalls, startTime } = acc;
  const endTime = isoNow();
  const correlation = correlationMetadata(acc);
  const traceId = isUuid(runId) ? runId : randomUUID();

  const genSpans = [];
  for (let i = 0; i < Math.min(llmOutputs.length, llmInputs.length); i++) {
    const usage = usageTokens(llmOutputs[i].usage || {});
    genSpans.push({
      span_id: randomUUID(), name: llmOutputs[i].model || "LLM Generation", type: "gen_ai.chat",
      model: llmOutputs[i].model || null,
      provider: llmOutputs[i].provider || null,
      input: { messages: llmInputs[i].messages, tools: llmInputs[i].tools, systemPrompt: llmInputs[i].systemPrompt },
      output: { text: llmOutputs[i].text, toolCalls: llmOutputs[i].toolCalls },
      timestamp_start: llmInputs[i].time,
      timestamp_end: llmOutputs[i].time,
      tokens_input: usage.input,
      tokens_output: usage.output,
      latency_ms: durMs(llmInputs[i].time, llmOutputs[i].time),
      status: "ok",
      metadata: { ...correlation, provider: llmOutputs[i].provider, model: llmOutputs[i].model, usage: llmOutputs[i].usage || {} },
    });
  }

  const toolSpans = toolCalls.map(tc => ({
    span_id: randomUUID(), name: tc.name, type: "gen_ai.tool",
    input: { params: tc.params },
    output: tc.error ? { error: tc.error } : { result: truncate(JSON.stringify(tc.result)) },
    timestamp_start: tc.startTime,
    timestamp_end: tc.endTime || tc.startTime,
    latency_ms: tc.startTime && tc.endTime ? durMs(tc.startTime, tc.endTime) : null,
    status: tc.error ? "error" : "ok",
    metadata: { ...correlation, duration_ms: tc.startTime && tc.endTime ? durMs(tc.startTime, tc.endTime) : null },
  }));
  const totalTokens = genSpans.reduce((sum, span) => sum + (span.tokens_input || 0) + (span.tokens_output || 0), 0);
  const hasError = toolCalls.some((tc) => tc.error);

  return {
    trace_id: traceId, project_id: projectId,
    name: agentCtx.agentId ? `turn-${agentCtx.agentId}` : "agent turn",
    input: llmInputs[0] ? {
      prompt: llmInputs[0].prompt,
      messages: llmInputs[0].messages,
      tools: llmInputs[0].tools,
      msgCount: Array.isArray(llmInputs[0].messages) ? llmInputs[0].messages.length : 0,
      turnId: correlation["openclaw.turn.id"],
      requestId: correlation["openclaw.request.id"],
    } : {},
    output: llmOutputs[llmOutputs.length - 1] ? { text: truncate(llmOutputs[llmOutputs.length - 1].text, 500) } : {},
    timestamp_start: startTime,
    timestamp_end: endTime,
    latency_ms: durMs(startTime, endTime),
    total_tokens: totalTokens,
    total_cost: 0,
    error_count: hasError ? 1 : 0,
    status: hasError ? "error" : "ok",
    tags: [agentCtx.agentId, agentCtx.channelId].filter(Boolean),
    metadata: {
      session_key: agentCtx.sessionKey,
      agent_id: agentCtx.agentId,
      channel: agentCtx.channelId,
      provider: agentCtx.modelProviderId,
      model: agentCtx.modelId,
      run_id: runId,
      gen_count: genSpans.length,
      tool_count: toolCalls.length,
      total_latency_ms: durMs(startTime, endTime),
      ...correlation,
    },
    spans: [...genSpans, ...toolSpans],
  };
}

async function flushTrace(runId) {
  const acc = traces.get(runId);
  if (!acc) return;
  traces.delete(runId);
  console.log("[firefly-trace] flushing trace", runId?.slice(0, 8), "spans:", acc.toolCalls.length, "llm:", acc.llmInputs.length);
  try {
    await postTrace(assembleTrace(acc));
  } catch (e) { console.warn("[firefly-trace] flush error:", e.message); }
}

export default {
  id: "firefly-trace",
  name: "Firefly Trace Plugin",
  description: "Captures agent turn traces",

  register(api) {
    fireflyUrl = api.pluginConfig?.fireflyUrl || DEFAULT_FIREFLY_URL;
    fireflyKey = api.pluginConfig?.fireflyKey || DEFAULT_FIREFLY_KEY;
    projectId = api.pluginConfig?.projectId || DEFAULT_PROJECT_ID;
    const log = api.logger || { info: console.log, warn: console.warn };

    log.info(`[firefly-trace] v2 sending to ${fireflyUrl}`);
    if (!fireflyKey || !projectId) {
      log.warn("[firefly-trace] telemetry is disabled until fireflyKey and projectId are configured");
    }

    // DEBUG: check what's on api
    const knownMethods = ['on', 'registerHook', 'registerService'];
    for (const m of knownMethods) {
      log.info(`[firefly-trace] api.${m} = ${typeof api[m]}`);
    }

    // Use registerHook if api.on doesn't exist
    const on = typeof api.on === "function" ? api.on.bind(api) : null;
    const registerHook = typeof api.registerHook === "function" ? api.registerHook.bind(api) : null;

    function hook(name, handler) {
      if (on) {
        log.info(`[firefly-trace] registering typed hook: ${name}`);
        on(name, (event, ctx) => {
          console.log(`[firefly-trace] HOOK FIRED: ${name} runId=${event?.runId || ctx?.runId}`);
          handler(event, ctx);
        });
      } else if (registerHook) {
        log.info(`[firefly-trace] registering internal hook: ${name}`);
        registerHook(name, handler);
      } else {
        log.warn(`[firefly-trace] cannot register hook ${name} — no api.on or api.registerHook`);
      }
    }

    function ensureAcc(runId, event = {}, ctx = {}) {
      if (!runId) return null;
      let acc = traces.get(runId);
      if (!acc) { acc = new TraceAccumulator(runId, ctx); traces.set(runId, acc); }
      mergeCorrelation(acc, event, ctx, runId);
      return acc;
    }

    function recordLlmInput(event = {}, ctx = {}) {
      const runId = event.runId || ctx?.runId;
      const acc = ensureAcc(runId, event, ctx);
      if (!acc) return;
      const messages = extractMessages(event);
      const prompt = extractPrompt(event, messages);
      const tools = extractToolNames(event);
      const systemPrompt = pickValue(event.systemPrompt, event.system_prompt, event.system);
      if (!prompt && messages.length === 0 && tools.length === 0 && !systemPrompt) return;
      acc.llmInputs.push({
        time: isoNow(),
        prompt,
        messages,
        tools,
        systemPrompt: systemPrompt?.slice?.(0, 2000) || null,
      });
    }

    function recordLlmOutput(event = {}, ctx = {}, options = {}) {
      const runId = event.runId || ctx?.runId;
      const acc = ensureAcc(runId, event, ctx);
      if (!acc) return false;
      const text = extractOutputText(event, ctx);
      const toolCalls = extractToolCalls(event);
      const usage = extractUsage(event);
      if (!text && toolCalls.length === 0 && Object.keys(usage).length === 0 && options.requireContent) return false;
      acc.llmOutputs.push({
        time: isoNow(),
        provider: pickValue(event.provider, ctx?.modelProviderId, ctx?.provider),
        model: pickValue(event.model, ctx?.modelId, ctx?.model),
        text,
        toolCalls,
        usage,
      });
      return true;
    }

    hook("llm_input", (event = {}, ctx = {}) => {
      recordLlmInput(event, ctx);
    });

    hook("llm_output", (event = {}, ctx = {}) => {
      recordLlmOutput(event, ctx);
    });

    hook("before_tool_call", (event = {}, ctx = {}) => {
      const runId = event.runId || ctx?.runId;
      const acc = ensureAcc(runId, event, ctx);
      if (!acc) return;
      const callId = event.toolCallId || event.callId || event.id || randomUUID();
      acc.pendingTools.set(callId, {
        callId,
        name: event.toolName, params: safeJson(event.params), startTime: isoNow(),
      });
    });

    hook("after_tool_call", (event = {}, ctx = {}) => {
      const runId = event.runId || ctx?.runId;
      if (!runId) return;
      const acc = traces.get(runId);
      if (!acc) return;
      mergeCorrelation(acc, event, ctx, runId);
      const callId = event.toolCallId || event.callId || event.id || null;
      let pending = callId ? acc.pendingTools.get(callId) : null;
      if (!pending && acc.pendingTools.size === 1) pending = [...acc.pendingTools.values()][0];
      acc.toolCalls.push({
        callId: callId || pending?.callId || randomUUID(),
        name: event.toolName || pending?.name || "unknown",
        params: safeJson(event.params) || pending?.params || {},
        result: safeJson(event.result),
        error: event.error || null,
        startTime: pending?.startTime || isoNow(),
        endTime: isoNow(),
      });
      if (pending?.callId) acc.pendingTools.delete(pending.callId);
    });

    hook("agent_end", (event = {}, ctx = {}) => {
      const runId = event.runId || ctx?.runId;
      const acc = runId ? traces.get(runId) : null;
      if (acc) {
        mergeCorrelation(acc, event, ctx, runId);
        if (acc.llmInputs.length === 0) recordLlmInput(event, ctx);
        if (acc.llmOutputs.length === 0) recordLlmOutput(event, ctx, { requireContent: true });
      }
      if (!runId) { for (const id of traces.keys()) flushTrace(id); return; }
      flushTrace(runId);
    });
  },
};
