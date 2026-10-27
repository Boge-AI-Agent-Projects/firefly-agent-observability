import type { Span, TraceSummary } from '../types';
import { translate, type Language, type TranslationKey } from '../i18n/translations';

export interface FireflyMeta {
  category?: string;
  display_type?: string;
  display_name?: string;
  visibility?: string;
  summary?: Record<string, number>;
}

export function fireflyMeta(item: { metadata: Record<string, unknown> | null }): FireflyMeta {
  const raw = item.metadata?.firefly;
  if (raw && typeof raw === 'object') return raw as FireflyMeta;
  return {};
}

export function traceDisplayName(
  trace: TraceSummary | { name: string; metadata: Record<string, unknown> | null },
  language: Language = 'en',
): string {
  const labels: Record<string, TranslationKey> = {
    'openclaw.model.call': 'label.modelCall',
    'openclaw.model.usage': 'label.modelUsage',
    'openclaw.message.processed': 'label.messageProcessed',
    'openclaw.harness.run': 'label.agentRun',
    'openclaw.tool.execution': 'label.toolExecution',
    'openclaw.exec': 'label.shellExecution',
    'openclaw.session.stuck': 'label.sessionStuck',
    'openclaw.diagnostic.phase': 'label.diagnosticPhase',
  };
  const displayName = fireflyMeta(trace).display_name;
  if (displayName && displayName !== trace.name) {
    const key = labels[trace.name] || labels[`openclaw.${displayName}`];
    return key ? translate(language, key) : displayName;
  }
  return labels[trace.name] ? translate(language, labels[trace.name]) : trace.name.replace(/^openclaw\./, '');
}

export function spanCategory(span: Span): string {
  return fireflyMeta(span).category || span.category || span.type;
}

export function spanDisplayType(span: Span, language: Language = 'en'): string {
  return fireflyMeta(span).display_type || typeLabel(span.type, language);
}

export function spanDisplayName(span: Span, language: Language = 'en'): string {
  const labels: Record<string, TranslationKey> = {
    'openclaw.model.call': 'label.modelCall',
    'openclaw.model.usage': 'label.modelUsage',
    'openclaw.message.processed': 'label.messageProcessed',
    'openclaw.harness.run': 'label.agentRun',
    'openclaw.tool.execution': 'label.toolExecution',
    'openclaw.exec': 'label.shellExecution',
    'openclaw.diagnostic.phase': 'label.diagnosticPhase',
  };
  const displayName = fireflyMeta(span).display_name;
  if (displayName && displayName !== span.name) {
    const key = labels[span.name] || labels[`openclaw.${displayName}`];
    return key ? translate(language, key) : displayName;
  }
  return labels[span.name] ? translate(language, labels[span.name]) : span.name.replace(/^openclaw\./, '');
}

export function platformName(item: { metadata: Record<string, unknown> | null }): string {
  const metadata = item.metadata || {};
  return String(metadata.platform || metadata['service.name'] || metadata.model || 'unknown');
}

export function agentName(item: { metadata: Record<string, unknown> | null }): string {
  const metadata = item.metadata || {};
  return String(metadata.agent_id || metadata.agentId || metadata['openclaw.agent'] || '');
}

export function typeLabel(type: string, language: Language = 'en'): string {
  const labels: Record<string, TranslationKey> = {
    'gen_ai.chat': 'type.generation',
    'gen_ai.tool': 'type.tool',
    'gen_ai.embed': 'type.embedding',
    'gen_ai.embedding': 'type.embedding',
    'gen_ai.retrieval': 'type.retrieval',
    tool: 'type.tool',
    retrieval: 'type.retrieval',
    agent: 'type.agent',
    chain: 'type.chain',
    custom: 'type.span',
  };
  return labels[type] ? translate(language, labels[type]) : type;
}

export function categoryLabel(category: string, language: Language = 'en'): string {
  const labels: Record<string, TranslationKey> = {
    user_request: 'category.userRequest',
    user_trace: 'category.userRequest',
    llm_generation: 'category.generation',
    tool_call: 'category.tool',
    tool: 'category.tool',
    retrieval: 'category.retrieval',
    context_assembly: 'category.context',
    agent_step: 'category.agent',
    agent: 'category.agent',
    chain_step: 'category.chain',
    chain: 'category.chain',
    embedding: 'category.embedding',
    background: 'category.background',
    system: 'category.system',
    custom: 'category.span',
  };
  return labels[category] ? translate(language, labels[category]) : category;
}

export function categoryTone(category: string): string {
  if (category === 'llm_generation' || category === 'user_request' || category === 'user_trace') return 'blue';
  if (category === 'tool_call') return 'green';
  if (category === 'retrieval' || category === 'context_assembly') return 'amber';
  if (category === 'system' || category === 'background') return 'zinc';
  if (category === 'chain_step' || category === 'agent_step') return 'purple';
  return 'zinc';
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatTime(iso: string, language: Language = 'en'): string {
  return new Date(iso).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US');
}

export function safeJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function traceSummary(trace: TraceSummary): Record<string, number> {
  return fireflyMeta(trace).summary || {};
}

function flattenText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = [
      record.content,
      record.text,
      record.message,
      record.prompt,
      record.query,
      record.response,
      record.result,
      record.output,
      record.input,
    ];
    const hit = preferred.map(flattenText).find(Boolean);
    if (hit) return hit;
    return Object.entries(record)
      .slice(0, 8)
      .map(([key, item]) => `${key}: ${flattenText(item)}`)
      .filter(Boolean)
      .join(' ');
  }
  return String(value);
}

export function previewValue(value: unknown, maxLength = 180): string {
  const compact = flattenText(value).replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

export function traceSearchText(trace: TraceSummary): string {
  return [
    trace.id,
    trace.name,
    trace.category,
    trace.status,
    platformName(trace),
    agentName(trace),
    previewValue(trace.input, 400),
    previewValue(trace.output, 400),
    trace.tags?.join(' '),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function spanSearchText(span: Span): string {
  return [
    span.id,
    span.trace_id,
    span.name,
    span.type,
    span.category,
    span.status,
    span.model,
    span.provider,
    previewValue(span.input, 400),
    previewValue(span.output, 400),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function traceLevel(trace: TraceSummary): 'error' | 'warning' | 'default' {
  if (trace.status === 'error' || trace.error_count > 0) return 'error';
  const metadata = trace.metadata || {};
  const level = String(metadata.level || metadata['langfuse.level'] || '').toLowerCase();
  if (level === 'warning' || level === 'warn') return 'warning';
  if (level === 'error') return 'error';
  return 'default';
}
