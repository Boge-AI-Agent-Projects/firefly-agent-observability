import { Search, SlidersHorizontal } from 'lucide-react';
import { useI18n } from '../i18n';
import type { TraceStatus } from '../types';

interface FilterBarProps {
  platform: string;
  status: TraceStatus | '';
  projectId: string;
  onPlatformChange: (v: string) => void;
  onStatusChange: (v: TraceStatus | '') => void;
  onProjectIdChange: (v: string) => void;
}

export function FilterBar({
  platform, status, projectId,
  onPlatformChange, onStatusChange, onProjectIdChange,
}: FilterBarProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
        <SlidersHorizontal className="h-4 w-4" />
        <span className="text-sm font-medium">{t('trace.filters')}</span>
      </div>

      <input
        type="text"
        placeholder={t('common.projectId')}
        value={projectId}
        onChange={e => onProjectIdChange(e.target.value)}
        className="h-9 min-w-[260px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent-blue)] focus:outline-none"
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
        <input
          type="text"
          placeholder={t('common.platform')}
          value={platform}
          onChange={e => onPlatformChange(e.target.value)}
          className="h-9 w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] pl-8 pr-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent-blue)] focus:outline-none"
        />
      </div>

      <select
        value={status}
        onChange={e => onStatusChange(e.target.value as TraceStatus | '')}
        className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-blue)] focus:outline-none"
      >
        <option value="">{t('common.allStatus')}</option>
        <option value="ok">{t('status.ok')}</option>
        <option value="error">{t('status.error')}</option>
        <option value="running">{t('status.running')}</option>
      </select>
    </div>
  );
}
