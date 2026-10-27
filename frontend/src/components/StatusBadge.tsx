import type { TraceStatus } from '../types';
import { useI18n, type TranslationKey } from '../i18n';

const statusConfig: Record<TraceStatus, { labelKey: TranslationKey; className: string }> = {
  ok: { labelKey: 'status.ok', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  error: { labelKey: 'status.error', className: 'bg-red-500/10 text-red-400 border-red-500/30' },
  running: { labelKey: 'status.running', className: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
};

export function StatusBadge({ status }: { status: TraceStatus }) {
  const { t } = useI18n();
  const cfg = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        status === 'ok' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : 'bg-amber-400'
      }`} />
      {t(cfg.labelKey)}
    </span>
  );
}
