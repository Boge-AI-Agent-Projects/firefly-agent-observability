import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Activity,
  AlertTriangle,
  Bot,
  Braces,
  CheckCircle2,
  Clock,
  FileJson,
  Filter,
  Link2,
  MessageSquare,
  Search,
  User,
  Wrench,
  Zap,
} from 'lucide-react';
import { fetchTraceBundle } from '../api/client';
import { SpanTree } from '../components/SpanTree';
import { TranscriptView } from '../components/TranscriptView';
import { StatusBadge } from '../components/StatusBadge';
import { useI18n, type TranslationKey } from '../i18n';
import type { Span, TraceDetail as TraceDetailType } from '../types';
import {
  agentName,
  categoryLabel,
  formatDuration,
  formatTokens,
  platformName,
  previewValue,
  safeJson,
  spanCategory,
  spanDisplayName,
  spanDisplayType,
  traceDisplayName,
} from '../utils/trace';
import { extractTraceContent } from '../utils/traceContent';

type MainTab = 'observations' | 'transcript' | 'raw';
type DetailTab = 'input' | 'output' | 'metadata';
type ObservationFilter = 'primary' | 'all' | 'generations' | 'tools' | 'retrieval' | 'agent' | 'system';

const observationFilters: Array<{ key: ObservationFilter; labelKey: TranslationKey }> = [
  { key: 'primary', labelKey: 'detail.filter.primary' },
  { key: 'all', labelKey: 'detail.filter.all' },
  { key: 'generations', labelKey: 'detail.filter.generations' },
  { key: 'tools', labelKey: 'detail.filter.tools' },
  { key: 'retrieval', labelKey: 'detail.filter.retrieval' },
  { key: 'agent', labelKey: 'detail.filter.agent' },
  { key: 'system', labelKey: 'detail.filter.system' },
];

function firstInterestingSpan(spans: Span[]): Span | null {
  return spans.find(s => spanCategory(s) !== 'system') || spans[0] || null;
}

function bundleMetadata(trace: TraceDetailType): Record<string, unknown> | null {
  const firefly = trace.metadata?.firefly;
  if (!firefly || typeof firefly !== 'object') return null;
  const bundle = (firefly as Record<string, unknown>).bundle;
  return bundle && typeof bundle === 'object' ? bundle as Record<string, unknown> : null;
}

function observationMatchesFilter(span: Span, filter: ObservationFilter): boolean {
  const category = spanCategory(span);
  if (filter === 'all') return true;
  if (filter === 'primary') return category !== 'system' && category !== 'background';
  if (filter === 'generations') return category === 'llm_generation' || span.type === 'gen_ai.chat';
  if (filter === 'tools') return category === 'tool_call' || category === 'tool' || span.type === 'gen_ai.tool';
  if (filter === 'retrieval') return category === 'retrieval' || category === 'context_assembly';
  if (filter === 'agent') return category === 'agent_step' || category === 'chain_step' || category === 'agent';
  return category === 'system' || category === 'background';
}

function observationSearchText(span: Span): string {
  return [
    span.id,
    span.trace_id,
    span.name,
    span.type,
    spanDisplayType(span),
    spanDisplayName(span),
    spanCategory(span),
    span.status,
    span.model,
    span.provider,
    previewValue(span.input, 240),
    previewValue(span.output, 240),
  ].filter(Boolean).join(' ').toLowerCase();
}

function filterObservations(spans: Span[], filter: ObservationFilter, query: string): Span[] {
  const normalizedQuery = query.trim().toLowerCase();
  return spans.filter(span => {
    if (!observationMatchesFilter(span, filter)) return false;
    if (!normalizedQuery) return true;
    return observationSearchText(span).includes(normalizedQuery);
  });
}

function observationFilterCount(spans: Span[], filter: ObservationFilter): number {
  return spans.filter(span => observationMatchesFilter(span, filter)).length;
}

function shortId(value: unknown): string {
  if (!value) return '-';
  const text = String(value);
  return text.length > 28 ? `${text.slice(0, 18)}...${text.slice(-6)}` : text;
}

function BundleBanner({ trace }: { trace: TraceDetailType }) {
  const { t } = useI18n();
  const bundle = bundleMetadata(trace);
  const confidence = String(bundle?.confidence || '');
  const isStrong = confidence === 'strong';
  const strategy = String(bundle?.strategy || 'single_trace');
  const correlationId = bundle?.correlation_id || trace.metadata?.['firefly.bundle_id'] || trace.metadata?.['openclaw.run.id'];
  const correlationKey = bundle?.correlation_key;
  const traceCount = Number(bundle?.trace_count || 1);
  const observationCount = Number(bundle?.observation_count || trace.spans.length);

  return (
    <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border ${
              isStrong
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {isStrong ? <CheckCircle2 className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
              {isStrong ? t('detail.strongCorrelation') : t('detail.timeWindowFallback')}
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
              {isStrong ? `${String(correlationKey || t('detail.correlationId'))} = ${shortId(correlationId)}` : strategy}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded bg-[var(--color-bg-tertiary)] px-2 py-1 font-mono text-[var(--color-text-secondary)]">
            {traceCount} {t('unit.traces')}
          </span>
          <span className="rounded bg-[var(--color-bg-tertiary)] px-2 py-1 font-mono text-[var(--color-text-secondary)]">
            {observationCount} {t('unit.observations')}
          </span>
          <span className="rounded bg-[var(--color-bg-tertiary)] px-2 py-1 font-mono text-[var(--color-text-secondary)]">
            {formatDuration(trace.latency_ms)}
          </span>
        </div>
      </div>
    </section>
  );
}

function TurnSummaryPanel({ trace }: { trace: TraceDetailType }) {
  const { language, t } = useI18n();
  const content = useMemo(() => extractTraceContent(trace, language), [trace, language]);
  const toolsPreview = content.tools.slice(0, 8);

  return (
    <section className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
      <div className="flex flex-col gap-2 border-b border-[var(--color-border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('detail.turnSummary')}</h3>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            {content.tools.length} {t('detail.toolExecutions')}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <span className="rounded bg-[var(--color-bg-tertiary)] px-2 py-1">{content.messages.length} {t('common.messages')}</span>
          <span className="rounded bg-[var(--color-bg-tertiary)] px-2 py-1">{formatDuration(trace.latency_ms)}</span>
        </div>
      </div>

      <div className="grid gap-0 border-b border-[var(--color-border)] lg:grid-cols-2">
        <div className="border-b border-[var(--color-border)] p-4 lg:border-b-0 lg:border-r">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            <User className="h-3.5 w-3.5" />
            {t('detail.userInput')}
          </div>
          {content.userInput ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3 font-sans text-sm leading-6 text-[var(--color-text-primary)]">
              {content.userInput}
            </pre>
          ) : (
            <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4 text-sm text-[var(--color-text-muted)]">
              {t('detail.noUserInputCaptured')}
            </div>
          )}
        </div>

        <div className="p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            <Bot className="h-3.5 w-3.5" />
            {t('detail.finalOutput')}
          </div>
          {content.finalOutput ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-emerald-200 bg-emerald-50 p-3 font-sans text-sm leading-6 text-emerald-950">
              {content.finalOutput}
            </pre>
          ) : (
            <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4 text-sm text-[var(--color-text-muted)]">
              {t('detail.outputMissing')}
            </div>
          )}
        </div>
      </div>

      <div className="p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
          <Wrench className="h-3.5 w-3.5" />
          {t('detail.toolExecutionsTitle')}
        </div>
        {toolsPreview.length > 0 ? (
          <div className="overflow-hidden rounded border border-[var(--color-border)]">
            <div className="grid grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_96px] gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              <span>{t('detail.tool')}</span>
              <span>{t('common.input')}</span>
              <span>{t('common.output')}</span>
              <span className="text-right">{t('common.latency')}</span>
            </div>
            {toolsPreview.map(tool => (
              <div key={tool.id} className="grid grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_96px] gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{tool.name}</p>
                  <div className="mt-1"><StatusBadge status={tool.status} /></div>
                </div>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--color-text-secondary)]">
                  {tool.input || t('common.empty')}
                </pre>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--color-text-secondary)]">
                  {tool.output || t('common.empty')}
                </pre>
                <span className="text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatDuration(tool.durationMs)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4 text-sm text-[var(--color-text-muted)]">
            {t('detail.noTools')}
          </div>
        )}
      </div>
    </section>
  );
}

function ObservationToolbar({
  spans,
  activeFilter,
  onFilterChange,
  query,
  onQueryChange,
}: {
  spans: Span[];
  activeFilter: ObservationFilter;
  onFilterChange: (filter: ObservationFilter) => void;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
      <div className="flex flex-col gap-3 p-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="mr-1 flex items-center gap-1.5 px-1 text-xs font-medium text-[var(--color-text-muted)]">
            <Filter className="h-3.5 w-3.5" />
            {t('common.type')}
          </span>
          {observationFilters.map(item => {
            const count = observationFilterCount(spans, item.key);
            const active = activeFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onFilterChange(item.key)}
                className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[var(--color-text-primary)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {t(item.labelKey)}
                <span className={active ? 'ml-1 text-white/70' : 'ml-1 text-[var(--color-text-muted)]'}>{count}</span>
              </button>
            );
          })}
        </div>
        <label className="relative block w-full xl:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder={t('detail.searchObservations')}
            className="h-9 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] pl-9 pr-3 text-sm text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent-blue)]"
          />
        </label>
      </div>
    </div>
  );
}

function DetailPanel({ span }: { span: Span | null }) {
  const { language, t } = useI18n();
  const [tab, setTab] = useState<DetailTab>('input');

  if (!span) {
    return (
      <aside className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-secondary)]">
        {t('detail.noObservationSelected')}
      </aside>
    );
  }

  const tabs: Array<{ key: DetailTab; labelKey: TranslationKey }> = [
    { key: 'input', labelKey: 'common.input' },
    { key: 'output', labelKey: 'common.output' },
    { key: 'metadata', labelKey: 'common.metadata' },
  ];
  const value = tab === 'input' ? span.input : tab === 'output' ? span.output : span.metadata;

  return (
    <aside className="sticky top-0 max-h-[calc(100vh-150px)] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
      <div className="border-b border-[var(--color-border)] p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-muted)]">{spanDisplayType(span, language)}</p>
        <h3 className="mt-1 truncate text-base font-semibold text-[var(--color-text-primary)]">{spanDisplayName(span, language)}</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={span.status} />
          <span className="rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5 font-mono text-xs text-[var(--color-text-secondary)]">
            {formatDuration(span.latency_ms)}
          </span>
          {span.total_tokens > 0 && (
            <span className="rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5 font-mono text-xs text-[var(--color-text-secondary)]">
              {formatTokens(span.total_tokens)} {t('unit.tokensShort')}
            </span>
          )}
        </div>
      </div>

      <div className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-1">
        {tabs.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
              tab === item.key
                ? 'bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <div className="max-h-[calc(100vh-330px)] overflow-auto p-4">
        {value ? (
          <pre className="whitespace-pre-wrap break-words rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3 font-mono text-xs leading-5 text-[var(--color-text-secondary)]">
            {safeJson(value)}
          </pre>
        ) : (
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-6 text-center text-sm text-[var(--color-text-muted)]">
            {t('common.empty')}
          </div>
        )}
      </div>
    </aside>
  );
}

function MetaRail({ trace }: { trace: TraceDetailType }) {
  const { t } = useI18n();
  const agent = agentName(trace);
  const bundle = bundleMetadata(trace);
  const bundleLabel = bundle
    ? `${bundle.trace_count || 1} ${t('unit.traces')} / ${bundle.observation_count || trace.spans.length} ${t('unit.observationsShort')}`
    : `${formatTokens(trace.total_tokens)} ${t('unit.tokensShort')}`;
  const bundleStrategy = bundle
    ? String(bundle.confidence || bundle.strategy || 'bundle')
    : '';
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <p className="text-xs text-[var(--color-text-muted)]">{t('common.platform')}</p>
        <p className="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]">{platformName(trace)}</p>
      </div>
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <p className="text-xs text-[var(--color-text-muted)]">{t('common.agent')}</p>
        <p className="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]">{agent || '-'}</p>
      </div>
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <p className="text-xs text-[var(--color-text-muted)]">{t('common.latency')}</p>
        <p className="mt-1 font-mono text-sm font-medium text-[var(--color-text-primary)]">{formatDuration(trace.latency_ms)}</p>
      </div>
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <p className="text-xs text-[var(--color-text-muted)]">{bundle ? t('common.bundle') : t('common.tokens')}</p>
        <p className="mt-1 font-mono text-sm font-medium text-[var(--color-text-primary)]">{bundleLabel}</p>
        {bundleStrategy && (
          <p className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">
            {bundleStrategy === 'strong' ? t('detail.correlationId') : t('detail.timeWindowFallback')}
          </p>
        )}
      </div>
    </div>
  );
}

export function TraceDetail() {
  const { language, t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<MainTab>('observations');
  const [observationFilter, setObservationFilter] = useState<ObservationFilter>('primary');
  const [observationQuery, setObservationQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: trace, isLoading, error } = useQuery({
    queryKey: ['trace-bundle', id],
    queryFn: () => fetchTraceBundle(id!),
    enabled: !!id,
  });

  const visibleSpans = useMemo(() => {
    if (!trace) return [];
    return filterObservations(trace.spans, observationFilter, observationQuery);
  }, [trace, observationFilter, observationQuery]);

  const selectedSpan = useMemo(() => {
    if (!trace) return null;
    return visibleSpans.find(s => s.id === selectedId) || firstInterestingSpan(visibleSpans);
  }, [trace, visibleSpans, selectedId]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
          <Activity className="h-5 w-5 animate-pulse" />
          {t('detail.loadingTrace')}
        </div>
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="flex h-64 flex-col items-center justify-center">
        <AlertTriangle className="mb-2 h-8 w-8 text-[var(--color-accent-red)]" />
        <p className="text-[var(--color-accent-red)]">{t('detail.failedTrace')}</p>
        <Link to="/traces" className="mt-2 text-sm text-[var(--color-accent-blue)] hover:underline">
          {t('common.backToTraces')}
        </Link>
      </div>
    );
  }

  const tabs = [
    { key: 'observations' as const, labelKey: 'common.observations' as const, icon: Braces },
    { key: 'transcript' as const, labelKey: 'common.transcript' as const, icon: MessageSquare },
    { key: 'raw' as const, labelKey: 'common.raw' as const, icon: FileJson },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Link
          to="/traces"
          className="mt-1 rounded p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={trace.status} />
            <span className="rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">
              {categoryLabel(trace.category || 'user_request', language)}
            </span>
          </div>
          <h2 className="mt-2 truncate text-2xl font-semibold text-[var(--color-text-primary)]">{traceDisplayName(trace, language)}</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">{trace.id}</p>
        </div>
        <div className="hidden items-center gap-4 text-sm text-[var(--color-text-secondary)] md:flex">
          <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />{formatDuration(trace.latency_ms)}</span>
          <span className="flex items-center gap-1.5"><Zap className="h-4 w-4" />{formatTokens(trace.total_tokens)} {t('unit.tokensShort')}</span>
        </div>
      </div>

      <MetaRail trace={trace} />
      <BundleBanner trace={trace} />
      <TurnSummaryPanel trace={trace} />

      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {tabs.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-[var(--color-accent-amber)] text-[var(--color-text-primary)]'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Icon className="h-4 w-4" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {tab === 'observations' && (
        <div className="space-y-3">
          <ObservationToolbar
            spans={trace.spans}
            activeFilter={observationFilter}
            onFilterChange={setObservationFilter}
            query={observationQuery}
            onQueryChange={setObservationQuery}
          />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <SpanTree
              spans={visibleSpans}
              selectedId={selectedSpan?.id || null}
              onSelect={span => setSelectedId(span.id)}
            />
            <DetailPanel span={selectedSpan} />
          </div>
        </div>
      )}

      {tab === 'transcript' && <TranscriptView trace={trace} />}

      {tab === 'raw' && (
        <pre className="overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 font-mono text-xs leading-5 text-[var(--color-text-secondary)] shadow-[var(--shadow-soft)]">
          {safeJson(trace)}
        </pre>
      )}
    </div>
  );
}
