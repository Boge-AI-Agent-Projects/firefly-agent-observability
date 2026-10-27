import type { Span, TraceDetail, TraceStatus } from '../types';
import type { Language } from '../i18n/translations';
import { previewValue, spanCategory, spanDisplayName } from './trace';

export interface ConversationMessage {
  role: string;
  content: string;
  timestamp?: string | number;
  toolName?: string;
  sourceSpanId?: string;
}

export interface ToolExecutionSummary {
  id: string;
  name: string;
  status: TraceStatus;
  durationMs: number | null;
  input: string;
  output: string;
}

export interface ExtractedTraceContent {
  userInput: string;
  finalOutput: string;
  tools: ToolExecutionSummary[];
  messages: ConversationMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0) && !(isRecord(value) && Object.keys(value).length === 0);
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length || 0;
}

function repairMojibake(text: string): string {
  const suspicious = countMatches(text, /[\u0080-\u00ff]/g);
  if (suspicious < 2) return text;

  try {
    const bytes: number[] = [];
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (code > 255) return text;
      bytes.push(code);
    }
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
    const originalCjk = countMatches(text, /[\u4e00-\u9fff]/g);
    const decodedCjk = countMatches(decoded, /[\u4e00-\u9fff]/g);
    const decodedSuspicious = countMatches(decoded, /[\u0080-\u00ff]/g);
    if (decodedCjk > originalCjk && decodedSuspicious < suspicious) return decoded;
  } catch {
    return text;
  }

  return text;
}

function normalizeText(text: string): string {
  return repairMojibake(text).replaceAll('\u0000', '').trim();
}

function cleanPrompt(text: string): string {
  const withoutMemories = text.replace(/<recalled-memories>[\s\S]*?<\/recalled-memories>\s*/i, '').trim();
  const withoutTimestamp = withoutMemories.replace(/^\[[^\]]+\]\s*/g, '').trim();
  return withoutTimestamp || withoutMemories || text;
}

function isAttributeOnly(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).filter(key => hasValue(value[key]));
  return keys.length === 1 && keys[0] === 'attributes';
}

function isToolCallOnly(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every(key => ['tool_calls', 'toolCalls', 'tool_call', 'toolCall'].includes(key));
}

function maybeParseJsonString(text: string): unknown | null {
  const trimmed = text.trim();
  const firstCharacter = trimmed[0];
  if (!trimmed || (firstCharacter !== '{' && firstCharacter !== '[')) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function textFromContent(
  value: unknown,
  options: { includeToolCalls?: boolean; cleanPrompt?: boolean; parseJsonStrings?: boolean } = {},
  depth = 0,
): string {
  if (!hasValue(value)) return '';

  if (typeof value === 'string') {
    const normalized = normalizeText(value);
    const cleaned = options.cleanPrompt ? cleanPrompt(normalized) : normalized;
    if (options.parseJsonStrings !== false && depth < 2) {
      const parsed = maybeParseJsonString(cleaned);
      if (parsed !== null) {
        const parsedText = textFromContent(parsed, options, depth + 1);
        if (parsedText) return parsedText;
      }
    }
    return cleaned;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    const parts = value
      .map(item => textFromContent(item, options, depth + 1))
      .filter(Boolean);
    return parts.join('\n');
  }

  if (!isRecord(value) || isAttributeOnly(value) || isToolCallOnly(value)) return '';

  const type = String(value.type || '').toLowerCase();
  if (type === 'thinking') return '';
  if (type === 'toolcall') {
    if (!options.includeToolCalls) return '';
    const name = String(value.name || value.toolName || 'tool');
    const args = value.arguments || value.input || value.partialArgs;
    const argsText = textFromContent(args, { ...options, parseJsonStrings: false }, depth + 1);
    return argsText ? `${name}: ${argsText}` : name;
  }

  if (typeof value.prompt === 'string') {
    return textFromContent(value.prompt, { ...options, cleanPrompt: true }, depth + 1);
  }

  const preferredKeys = [
    'text',
    'content',
    'message',
    'response',
    'result',
    'output',
    'error',
    'params',
    'arguments',
    'input',
    'query',
    'command',
  ];

  for (const key of preferredKeys) {
    if (!hasValue(value[key])) continue;
    const text = textFromContent(value[key], options, depth + 1);
    if (text) return text;
  }

  return Object.entries(value)
    .slice(0, 8)
    .map(([key, item]) => {
      const text = textFromContent(item, options, depth + 1);
      return text ? `${key}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeRole(role: unknown): string {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'human') return 'user';
  if (normalized === 'ai' || normalized === 'model') return 'assistant';
  if (normalized === 'toolresult' || normalized === 'tool_result') return 'tool';
  return normalized || 'system';
}

function messageFromRecord(record: Record<string, unknown>): ConversationMessage | null {
  const rawRole = record.role;
  if (!rawRole) return null;

  const role = normalizeRole(rawRole);
  const contentSource = hasValue(record.content) ? record.content : record.message || record.text || record;
  const content = textFromContent(contentSource, {
    includeToolCalls: role === 'assistant',
    cleanPrompt: role === 'user',
  });
  if (!content) return null;

  return {
    role,
    content,
    timestamp: record.timestamp as string | number | undefined,
    toolName: typeof record.toolName === 'string' ? record.toolName : undefined,
  };
}

export function messagesFromValue(value: unknown): ConversationMessage[] {
  if (!hasValue(value) || isAttributeOnly(value)) return [];

  if (Array.isArray(value)) {
    return value.flatMap(item => messagesFromValue(item));
  }

  if (!isRecord(value)) return [];

  for (const key of ['messages', 'input_messages', 'output_messages', 'inputMessages', 'outputMessages']) {
    if (hasValue(value[key])) {
      const messages = messagesFromValue(value[key]);
      if (messages.length > 0) return messages;
    }
  }

  for (const key of ['input', 'output', 'request', 'response']) {
    const nested = value[key];
    if (isRecord(nested) && hasValue(nested.messages)) {
      const messages = messagesFromValue(nested.messages);
      if (messages.length > 0) return messages;
    }
  }

  if (Array.isArray(value.choices)) {
    return value.choices.flatMap(choice => {
      if (!isRecord(choice)) return [];
      return messagesFromValue(choice.message || choice.delta || choice);
    });
  }

  const message = messageFromRecord(value);
  if (message) return [message];

  if (typeof value.prompt === 'string') {
    const content = textFromContent(value.prompt, { cleanPrompt: true });
    return content ? [{ role: 'user', content, timestamp: value.timestamp as string | number | undefined }] : [];
  }

  return [];
}

function isGenerationSpan(span: Span): boolean {
  const name = span.name.toLowerCase();
  const type = span.type.toLowerCase();
  const category = spanCategory(span);
  return type === 'gen_ai.chat' || type === 'gen_ai.generation' || category === 'llm_generation' || name.includes('model.call') || name.includes('model.usage');
}

function isToolSpan(span: Span): boolean {
  const type = span.type.toLowerCase();
  const category = spanCategory(span);
  return type === 'gen_ai.tool' || category === 'tool_call' || category === 'tool';
}

export function messagesFromSpan(span: Span): ConversationMessage[] {
  const messages = messagesFromValue(span.input).map(message => ({ ...message, sourceSpanId: span.id }));

  if (hasValue(span.output)) {
    if (isGenerationSpan(span) && !isToolCallOnly(span.output)) {
      const output = textFromContent(span.output);
      if (output) messages.push({ role: 'assistant', content: output, sourceSpanId: span.id });
    } else if (isToolSpan(span)) {
      const output = textFromContent(span.output, { parseJsonStrings: true });
      if (output) messages.push({ role: 'tool', content: output, sourceSpanId: span.id, toolName: spanDisplayName(span) });
    }
  }

  return messages;
}

function messageKey(message: ConversationMessage): string {
  const timestamp = message.timestamp ? String(message.timestamp) : '';
  return `${message.role}|${timestamp}|${message.toolName || ''}|${message.content}`;
}

export function messagesFromTrace(trace: TraceDetail): ConversationMessage[] {
  const messages = [
    ...messagesFromValue(trace.input),
    ...trace.spans
      .slice()
      .sort((a, b) => new Date(a.timestamp_start).getTime() - new Date(b.timestamp_start).getTime())
      .flatMap(messagesFromSpan),
  ];

  const seen = new Set<string>();
  return messages.filter(message => {
    const key = messageKey(message);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function latestMessage(messages: ConversationMessage[], roles: string[]): string {
  const roleSet = new Set(roles);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (roleSet.has(messages[i].role) && messages[i].content) return messages[i].content;
  }
  return '';
}

function latestGenerationOutput(trace: TraceDetail): string {
  const values: unknown[] = [trace.output];
  for (const span of trace.spans) {
    if (isGenerationSpan(span)) values.push(span.output);
  }

  let latest = '';
  for (const value of values) {
    if (!hasValue(value) || isAttributeOnly(value) || isToolCallOnly(value)) continue;
    const messages = messagesFromValue(value);
    const assistant = latestMessage(messages, ['assistant']);
    if (assistant) {
      latest = assistant;
      continue;
    }
    const text = textFromContent(value);
    if (text) latest = text;
  }
  return latest;
}

export function extractTraceContent(trace: TraceDetail, language: Language = 'en'): ExtractedTraceContent {
  const messages = messagesFromTrace(trace);
  const fallbackUserInput = textFromContent(trace.input, { cleanPrompt: true });
  const userInput = latestMessage(messages, ['user']) || fallbackUserInput;
  const finalOutput = latestGenerationOutput(trace);
  const tools = trace.spans
    .filter(isToolSpan)
    .map(span => ({
      id: span.id,
      name: spanDisplayName(span, language),
      status: span.status,
      durationMs: span.latency_ms,
      input: textFromContent(span.input, { includeToolCalls: true, parseJsonStrings: true }) || previewValue(span.input, 300),
      output: textFromContent(span.output, { parseJsonStrings: true }) || previewValue(span.output, 300),
    }));

  return { userInput, finalOutput, tools, messages };
}
