/* eslint-disable react-refresh/only-export-components -- tree builder is intentionally exported */
import { useMemo, useState } from 'react';
import {
  Bot,
  Box,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Layers3,
  Search,
  Wrench,
  Zap,
} from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { useI18n } from '../i18n';
import type { Span } from '../types';
import {
  categoryLabel,
  formatDuration,
  spanCategory,
  spanDisplayName,
  spanDisplayType,
} from '../utils/trace';

export interface SpanNodeModel extends Span {
  children: SpanNodeModel[];
}

const categoryColor: Record<string, string> = {
  llm_generation: 'var(--color-accent-blue)',
  tool_call: 'var(--color-accent-green)',
  tool: 'var(--color-accent-green)',
  retrieval: 'var(--color-accent-amber)',
  context_assembly: 'var(--color-accent-orange)',
  agent_step: 'var(--color-accent-purple)',
  chain_step: 'var(--color-accent-purple)',
  embedding: 'var(--color-accent-purple)',
  system: 'var(--color-text-muted)',
  background: 'var(--color-text-muted)',
  custom: 'var(--color-text-muted)',
};

function categoryIcon(category: string) {
  const className = 'h-4 w-4';
  if (category === 'llm_generation') return <Bot className={className} />;
  if (category === 'tool_call' || category === 'tool') return <Wrench className={className} />;
  if (category === 'retrieval') return <Search className={className} />;
  if (category === 'context_assembly') return <Layers3 className={className} />;
  if (category === 'agent_step' || category === 'chain_step') return <GitBranch className={className} />;
  if (category === 'embedding') return <Zap className={className} />;
  return <Box className={className} />;
}

export function buildSpanTree(spans: Span[]): SpanNodeModel[] {
  const byId = new Map<string, SpanNodeModel>();
  const roots: SpanNodeModel[] = [];
  const nodes = spans
    .slice()
    .sort((a, b) => new Date(a.timestamp_start).getTime() - new Date(b.timestamp_start).getTime())
    .map(span => ({ ...span, children: [] }));

  nodes.forEach(node => byId.set(node.id, node));
  nodes.forEach(node => {
    if (node.parent_span_id && byId.has(node.parent_span_id)) {
      byId.get(node.parent_span_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function flatten(nodes: SpanNodeModel[]): SpanNodeModel[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)]);
}

function timelineBounds(spans: Span[]) {
  const starts = spans.map(s => new Date(s.timestamp_start).getTime()).filter(Number.isFinite);
  const ends = spans.map(s => new Date(s.timestamp_end || s.timestamp_start).getTime()).filter(Number.isFinite);
  const min = Math.min(...starts);
  const max = Math.max(...ends, min + 1);
  return { min, max };
}

function SpanNode({
  span,
  depth,
  selectedId,
  onSelect,
  bounds,
}: {
  span: SpanNodeModel;
  depth: number;
  selectedId: string | null;
  onSelect: (span: Span) => void;
  bounds: { min: number; max: number };
}) {
  const { language } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const hasChildren = span.children.length > 0;
  const category = spanCategory(span);
  const color = categoryColor[category] || categoryColor.custom;
  const isSelected = selectedId === span.id;
  const start = new Date(span.timestamp_start).getTime();
  const end = new Date(span.timestamp_end || span.timestamp_start).getTime();
  const total = bounds.max - bounds.min || 1;
  const left = Math.max(0, ((start - bounds.min) / total) * 100);
  const width = Math.max(2, ((Math.max(end, start + 1) - start) / total) * 100);

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(span)}
        className={`grid w-full grid-cols-[minmax(280px,1fr)_160px_92px_92px] items-center gap-3 border-b border-[var(--color-border)] px-3 py-2.5 text-left transition-colors ${
          isSelected ? 'bg-[var(--color-row-hover)]' : 'hover:bg-[var(--color-bg-secondary)]'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * 18}px` }}>
          <span
            role="button"
            tabIndex={0}
            onClick={event => {
              event.stopPropagation();
              setExpanded(!expanded);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                setExpanded(!expanded);
              }
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)]"
          >
            {hasChildren ? (expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
          </span>
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border"
            style={{ color, borderColor: `${color}66`, backgroundColor: `${color}17` }}
          >
            {categoryIcon(category)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{spanDisplayName(span, language)}</p>
              <span className="shrink-0 rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                {spanDisplayType(span, language)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{categoryLabel(category, language)}</p>
          </div>
        </div>

        <div className="relative h-2 rounded-full bg-[var(--color-bg-primary)]">
          <span
            className="absolute top-0 h-2 rounded-full"
            style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, backgroundColor: color }}
          />
        </div>
        <span className="font-mono text-xs text-[var(--color-text-secondary)]">{formatDuration(span.latency_ms)}</span>
        <div className="flex justify-end"><StatusBadge status={span.status} /></div>
      </button>

      {expanded && span.children.map(child => (
        <SpanNode
          key={child.id}
          span={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          bounds={bounds}
        />
      ))}
    </div>
  );
}

export function SpanTree({
  spans,
  selectedId,
  onSelect,
}: {
  spans: Span[];
  selectedId: string | null;
  onSelect: (span: Span) => void;
}) {
  const { t } = useI18n();
  const tree = useMemo(() => buildSpanTree(spans), [spans]);
  const flat = useMemo(() => flatten(tree), [tree]);
  const bounds = useMemo(() => timelineBounds(spans), [spans]);

  if (flat.length === 0) {
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-12 text-center text-[var(--color-text-secondary)]">
        {t('detail.noObservationsInTrace')}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
      <div className="grid grid-cols-[minmax(280px,1fr)_160px_92px_92px] gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
        <span>{t('common.observation')}</span>
        <span>{t('common.timeline')}</span>
        <span>{t('common.latency')}</span>
        <span className="text-right">{t('common.status')}</span>
      </div>
      {tree.map(span => (
        <SpanNode
          key={span.id}
          span={span}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          bounds={bounds}
        />
      ))}
    </div>
  );
}
