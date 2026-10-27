import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchProjects, fetchStats } from '../api/client';
import { BarChart3, Activity, Zap, Clock, AlertTriangle, Coins, FolderPlus } from 'lucide-react';
import { useI18n } from '../i18n';

function StatCard({ title, value, subtitle, icon: Icon, colorClass }: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.1em] text-[var(--color-text-muted)]">{title}</p>
          <p className={`text-2xl font-semibold ${colorClass}`}>{value}</p>
          {subtitle && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{subtitle}</p>}
        </div>
        <div className="rounded-md bg-[var(--color-bg-tertiary)] p-2">
          <Icon className={`h-5 w-5 ${colorClass}`} />
        </div>
      </div>
    </div>
  );
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

export function Dashboard() {
  const { t } = useI18n();
  const [requestedProjectId, setRequestedProjectId] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => fetchProjects(),
    refetchInterval: 30000,
  });
  const projectItems = projectsQuery.data || [];
  const projectId = projectItems.some(project => project.id === requestedProjectId)
    ? requestedProjectId
    : projectItems[0]?.id || '';

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['stats', projectId],
    queryFn: () => fetchStats(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 30000,
  });

  if (projectsQuery.isLoading || (projectId && isLoading)) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
          <Activity className="w-5 h-5 animate-pulse" />
          {t('dashboard.loadingStats')}
        </div>
      </div>
    );
  }

  if (projectsQuery.error || error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-red-400">{t('dashboard.failedStats')}</p>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">{t('dashboard.backendHint')}</p>
        </div>
      </div>
    );
  }

  if (projectItems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded bg-indigo-50 text-indigo-600">
            <FolderPlus className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">{t('trace.projectRequiredTitle')}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t('dashboard.projectRequiredBody')}</p>
          <Link
            to="/settings"
            className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
          >
            <FolderPlus className="h-4 w-4" />
            {t('trace.projectRequiredCta')}
          </Link>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const selectedProject = projectItems.find(project => project.id === projectId) || null;

  const errorRate = stats.total_traces > 0
    ? (stats.error_traces / stats.total_traces * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-accent-amber)]">{t('dashboard.overview')}</p>
          <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">{t('dashboard.operationsSignal')}</h2>
          {selectedProject && (
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {t('trace.projectScope')}: <span className="font-medium text-[var(--color-text-primary)]">{selectedProject.name}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={projectId}
            onChange={event => setRequestedProjectId(event.target.value)}
            className="h-9 rounded border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none"
            aria-label={t('common.project')}
          >
            {projectItems.map(project => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <p className="text-sm text-[var(--color-text-secondary)]">{t('dashboard.autoRefresh')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          title={t('dashboard.totalTraces')}
          value={fmtNum(stats.total_traces)}
          icon={BarChart3}
          colorClass="text-[var(--color-accent-blue)]"
        />
        <StatCard
          title={t('dashboard.totalSpans')}
          value={fmtNum(stats.total_spans)}
          icon={Activity}
          colorClass="text-[var(--color-accent-green)]"
        />
        <StatCard
          title={t('dashboard.errorRate')}
          value={`${errorRate.toFixed(1)}%`}
          subtitle={stats.error_traces > 0 ? `${stats.error_traces} ${t(stats.error_traces > 1 ? 'unit.errors' : 'unit.error')}` : t('dashboard.clean')}
          icon={AlertTriangle}
          colorClass={errorRate > 5 ? 'text-[var(--color-accent-red)]' : 'text-[var(--color-accent-green)]'}
        />
        <StatCard
          title={t('dashboard.totalTokens')}
          value={fmtNum(stats.total_tokens)}
          icon={Zap}
          colorClass="text-[var(--color-accent-purple)]"
        />
        <StatCard
          title={t('dashboard.p95Latency')}
          value={`${Math.round(stats.p95_latency_ms)}ms`}
          icon={Clock}
          colorClass="text-[var(--color-accent-orange)]"
        />
        <StatCard
          title={t('dashboard.totalCost')}
          value={`$${stats.total_cost_usd.toFixed(4)}`}
          icon={Coins}
          colorClass="text-[var(--color-accent-blue)]"
        />
      </div>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-soft)]">
        <h3 className="mb-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('dashboard.runQuality')}</h3>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-[var(--color-text-secondary)]">{t('dashboard.avgLatency')}</p>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">{Math.round(stats.avg_latency_ms)}ms</p>
          </div>
          <div>
            <p className="text-[var(--color-text-secondary)]">{t('dashboard.errorTraces')}</p>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">{stats.error_traces}</p>
          </div>
          <div>
            <p className="text-[var(--color-text-secondary)]">{t('dashboard.tokensPerTrace')}</p>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">
              {stats.total_traces > 0 ? Math.round(stats.total_tokens / stats.total_traces) : 0}
            </p>
          </div>
          <div>
            <p className="text-[var(--color-text-secondary)]">{t('dashboard.spansPerTrace')}</p>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">
              {stats.total_traces > 0 ? (stats.total_spans / stats.total_traces).toFixed(1) : 0}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
