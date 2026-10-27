import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckSquare2, Info, Square, Star } from 'lucide-react';
import { useI18n } from '../i18n';
import type { TraceSummary } from '../types';
import {
  categoryLabel,
  formatDuration,
  formatTime,
  formatTokens,
  platformName,
  previewValue,
  traceDisplayName,
  traceLevel,
} from '../utils/trace';

function LevelBadge({ trace }: { trace: TraceSummary }) {
  const level = traceLevel(trace);
  if (level === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
        <AlertTriangle className="h-3 w-3" />
        {trace.error_count || 1}
      </span>
    );
  }
  if (level === 'warning') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        {trace.span_count}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
      <Info className="h-3 w-3" />
      {trace.span_count}
    </span>
  );
}

function EmptyPreview({ label }: { label: string }) {
  return <span className="text-xs text-slate-400">{label}</span>;
}

export function TraceTable({
  traces,
  emptyDescription,
}: {
  traces: TraceSummary[];
  emptyDescription?: string;
}) {
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  if (traces.length === 0) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
        <p className="text-sm font-medium text-slate-700">{t('trace.noTraces')}</p>
        <p className="mt-1 max-w-md text-center text-xs">{emptyDescription || t('trace.emptyFilters', { timeRange: t('trace.time.7d') })}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="overflow-auto">
        <table className="min-w-[1040px] w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-medium text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="w-10 px-3 py-2">
                <Square className="h-4 w-4 text-slate-400" />
              </th>
              <th className="w-8 px-1 py-2" />
              <th className="w-[140px] px-3 py-2">{t('common.timestamp')}</th>
              <th className="w-[230px] px-3 py-2">{t('common.name')}</th>
              <th className="min-w-[220px] px-3 py-2">{t('common.input')}</th>
              <th className="min-w-[220px] px-3 py-2">{t('common.output')}</th>
              <th className="w-[130px] px-3 py-2">{t('trace.observationLevels')}</th>
              <th className="w-[90px] px-3 py-2 text-right">{t('common.latency')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {traces.map(trace => {
              const input = previewValue(trace.input);
              const output = previewValue(trace.output);
              const isChecked = Boolean(checked[trace.id]);
              return (
                <tr
                  key={trace.id}
                  onClick={() => navigate(`/trace/${encodeURIComponent(trace.id)}`)}
                  className="cursor-pointer bg-white text-slate-700 hover:bg-indigo-50/50"
                >
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setChecked(prev => ({ ...prev, [trace.id]: !isChecked }));
                      }}
                      className="mt-0.5 text-slate-400 hover:text-indigo-600"
                      aria-label={isChecked ? t('trace.unselectTrace') : t('trace.selectTrace')}
                    >
                      {isChecked ? <CheckSquare2 className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-1 py-2 align-top">
                    <Star className="mt-0.5 h-4 w-4 text-slate-400 hover:text-amber-500" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs text-slate-600">
                    {formatTime(trace.timestamp_start, language)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">
                        {categoryLabel(trace.category, language)}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-medium text-slate-800">{traceDisplayName(trace, language)}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                      {trace.id.slice(0, 8)}...{trace.id.slice(-6)}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{platformName(trace)}</p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {input ? (
                      <p className="line-clamp-2 max-w-[360px] text-slate-600">{input}</p>
                    ) : (
                      <EmptyPreview label={t('trace.noInput')} />
                    )}
                  </td>
                  <td className="bg-emerald-50/70 px-3 py-2 align-top">
                    {output ? (
                      <p className="line-clamp-2 max-w-[360px] text-emerald-950">{output}</p>
                    ) : (
                      <EmptyPreview label={t('trace.noOutput')} />
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <LevelBadge trace={trace} />
                      {trace.total_tokens > 0 && (
                        <span className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
                          {formatTokens(trace.total_tokens)} {t('unit.tokensShort')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right align-top font-mono text-xs text-slate-700">
                    {formatDuration(trace.latency_ms)}
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
