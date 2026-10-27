import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bot, Braces, Info, Square, Star, Wrench } from 'lucide-react';
import { useI18n } from '../i18n';
import type { Span } from '../types';
import { formatDuration, formatTime, formatTokens, previewValue, spanDisplayName, typeLabel } from '../utils/trace';

function ObservationIcon({ type, category }: { type: string; category: string }) {
  if (type.includes('tool') || category === 'tool_call' || category === 'tool') return <Wrench className="h-3.5 w-3.5" />;
  if (type.includes('chat') || category === 'llm_generation') return <Bot className="h-3.5 w-3.5" />;
  if (type.includes('retrieval') || category === 'retrieval') return <Braces className="h-3.5 w-3.5" />;
  return <Info className="h-3.5 w-3.5" />;
}

function LevelBadge({ span }: { span: Span }) {
  const { t } = useI18n();
  if (span.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
        <AlertTriangle className="h-3 w-3" />
        {t('status.error')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
      <Info className="h-3 w-3" />
      {t('level.default')}
    </span>
  );
}

function EmptyPreview({ label }: { label: string }) {
  return <span className="text-xs text-slate-400">{label}</span>;
}

export function ObservationTable({
  spans,
  emptyDescription,
}: {
  spans: Span[];
  emptyDescription?: string;
}) {
  const navigate = useNavigate();
  const { language, t } = useI18n();

  if (spans.length === 0) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center rounded border border-slate-200 bg-white text-slate-500">
        <p className="text-sm font-medium text-slate-700">{t('trace.noObservations')}</p>
        <p className="mt-1 max-w-md text-center text-xs">{emptyDescription || t('trace.emptyFilters', { timeRange: t('trace.time.7d') })}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-slate-200 bg-white">
      <div className="overflow-auto">
        <table className="min-w-[1040px] w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-medium text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="w-10 px-3 py-2"><Square className="h-4 w-4 text-slate-400" /></th>
              <th className="w-8 px-1 py-2" />
              <th className="w-[140px] px-3 py-2">{t('common.timestamp')}</th>
              <th className="w-[260px] px-3 py-2">{t('common.name')}</th>
              <th className="min-w-[220px] px-3 py-2">{t('common.input')}</th>
              <th className="min-w-[220px] px-3 py-2">{t('common.output')}</th>
              <th className="w-[120px] px-3 py-2">{t('trace.observationLevels')}</th>
              <th className="w-[90px] px-3 py-2 text-right">{t('common.latency')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {spans.map(span => {
              const input = previewValue(span.input);
              const output = previewValue(span.output);
              return (
                <tr
                  key={span.id}
                  onClick={() => navigate(`/trace/${encodeURIComponent(span.trace_id)}`)}
                  className="cursor-pointer bg-white text-slate-700 hover:bg-indigo-50/50"
                >
                  <td className="px-3 py-2 align-top"><Square className="h-4 w-4 text-slate-300" /></td>
                  <td className="px-1 py-2 align-top"><Star className="h-4 w-4 text-slate-300 hover:text-amber-500" /></td>
                  <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs text-slate-600">
                    {formatTime(span.timestamp_start, language)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">
                        <ObservationIcon type={span.type} category={span.category} />
                        {typeLabel(span.type, language)}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-medium text-slate-800">{spanDisplayName(span, language)}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                      trace {span.trace_id.slice(0, 8)}...{span.trace_id.slice(-6)}
                    </p>
                    {(span.model || span.provider) && (
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{[span.provider, span.model].filter(Boolean).join(' / ')}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {input ? <p className="line-clamp-2 max-w-[360px] text-slate-600">{input}</p> : <EmptyPreview label={t('trace.noInput')} />}
                  </td>
                  <td className="bg-emerald-50/70 px-3 py-2 align-top">
                    {output ? <p className="line-clamp-2 max-w-[360px] text-emerald-950">{output}</p> : <EmptyPreview label={t('trace.noOutput')} />}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1.5">
                      <LevelBadge span={span} />
                      {span.total_tokens > 0 && (
                        <span className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
                          {formatTokens(span.total_tokens)} {t('unit.tokensShort')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right align-top font-mono text-xs text-slate-700">
                    {formatDuration(span.latency_ms)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
