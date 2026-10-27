import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FolderPlus,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { fetchProjects, fetchSpans, fetchTraces } from '../api/client';
import { ObservationTable } from '../components/ObservationTable';
import { TraceTable } from '../components/TraceTable';
import { useI18n, type TranslationKey } from '../i18n';
import type { Span, TraceStatus } from '../types';
import { platformName, spanSearchText, traceDisplayName, traceSearchText } from '../utils/trace';

const PAGE_SIZE = 50;

const TRACE_TABS = [
  { key: 'user_request', labelKey: 'trace.tab.requests' },
  { key: '', labelKey: 'trace.tab.all' },
  { key: 'llm_generation', labelKey: 'trace.tab.generations' },
  { key: 'tool', labelKey: 'trace.tab.tools' },
  { key: 'system', labelKey: 'trace.tab.system' },
] as const;

const OBSERVATION_TABS = [
  { key: '', labelKey: 'trace.tab.allObservations' },
  { key: 'llm_generation', labelKey: 'trace.tab.generations' },
  { key: 'tool', labelKey: 'trace.tab.tools' },
  { key: 'system', labelKey: 'trace.tab.system' },
] as const;

const TIME_RANGES = [
  { key: '1d', labelKey: 'trace.time.1d', hours: 24 },
  { key: '7d', labelKey: 'trace.time.7d', hours: 24 * 7 },
  { key: 'all', labelKey: 'trace.time.all', hours: null },
] as const;

type WorkspaceTab = 'traces' | 'observations';
type TimeRange = typeof TIME_RANGES[number]['key'];

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item) || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10);
}

function fromForRange(range: TimeRange) {
  const item = TIME_RANGES.find(option => option.key === range);
  if (!item?.hours) return undefined;
  return new Date(Date.now() - item.hours * 60 * 60 * 1000).toISOString();
}

function FilterSection({ title, children }: { title: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-slate-200 py-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-slate-600"
      >
        {title}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="mt-2 space-y-1">{children}</div>}
    </section>
  );
}

function FacetButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
        active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="ml-2 font-mono text-[11px] text-slate-400">{count}</span>
    </button>
  );
}

export function TraceList() {
  const { language, t } = useI18n();
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('traces');
  const [page, setPage] = useState(1);
  const [platform, setPlatform] = useState('');
  const [status, setStatus] = useState<TraceStatus | ''>('');
  const [requestedProjectId, setRequestedProjectId] = useState('');
  const [category, setCategory] = useState('user_request');
  const [traceName, setTraceName] = useState('');
  const [search, setSearch] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [filtersVisible, setFiltersVisible] = useState(() => (
    typeof window === 'undefined' ? true : window.innerWidth >= 1180
  ));

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => fetchProjects(),
    refetchInterval: 30000,
  });
  const projectItems = projectsQuery.data || [];

  const projectId = projectItems.some(project => project.id === requestedProjectId)
    ? requestedProjectId
    : projectItems[0]?.id || '';

  const traceQuery = useQuery({
    queryKey: ['traces', { page, platform, status, projectId, category, timeRange }],
    queryFn: () => fetchTraces({
      page,
      page_size: PAGE_SIZE,
      platform: platform || undefined,
      status: status || undefined,
      project_id: projectId || undefined,
      category: category || undefined,
      from: fromForRange(timeRange),
    }),
    enabled: workspaceTab === 'traces' && Boolean(projectId),
    refetchInterval: 15000,
  });

  const spanQuery = useQuery({
    queryKey: ['spans', { page, status, projectId, category, timeRange }],
    queryFn: () => fetchSpans({
      page,
      page_size: PAGE_SIZE,
      project_id: projectId || undefined,
      status: status || undefined,
      category: category || undefined,
      from: fromForRange(timeRange),
    }),
    enabled: workspaceTab === 'observations' && Boolean(projectId),
    refetchInterval: 15000,
  });

  const facetQuery = useQuery({
    queryKey: ['trace-facets', { projectId, timeRange }],
    queryFn: () => fetchTraces({ page: 1, page_size: 200, project_id: projectId, from: fromForRange(timeRange) }),
    enabled: Boolean(projectId),
    refetchInterval: 30000,
  });

  const facetItems = useMemo(() => facetQuery.data?.items || [], [facetQuery.data?.items]);
  const selectedProject = projectItems.find(project => project.id === projectId) || null;
  const traceNameFacets = useMemo(() => countBy(facetItems, trace => traceDisplayName(trace, language)), [facetItems, language]);
  const sourceFacets = useMemo(() => countBy(facetItems, platformName), [facetItems]);
  const statusFacets = useMemo(() => countBy(facetItems, item => item.status), [facetItems]);

  const traceItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (traceQuery.data?.items || []).filter(trace => {
      if (traceName && traceDisplayName(trace, language) !== traceName) return false;
      if (needle && !traceSearchText(trace).includes(needle)) return false;
      return true;
    });
  }, [traceQuery.data?.items, search, traceName, language]);

  const spanItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (spanQuery.data?.items || []).filter((span: Span) => {
      if (needle && !spanSearchText(span).includes(needle)) return false;
      return true;
    });
  }, [spanQuery.data?.items, search]);

  const activeData = workspaceTab === 'traces' ? traceQuery.data : spanQuery.data;
  const activeItems = workspaceTab === 'traces' ? traceItems : spanItems;
  const isLoading = workspaceTab === 'traces' ? traceQuery.isLoading : spanQuery.isLoading;
  const error = workspaceTab === 'traces' ? traceQuery.error : spanQuery.error;
  const isFetching = workspaceTab === 'traces' ? traceQuery.isFetching : spanQuery.isFetching;
  const totalPages = activeData ? Math.max(1, Math.ceil(activeData.total / PAGE_SIZE)) : 1;
  const tabs = workspaceTab === 'traces' ? TRACE_TABS : OBSERVATION_TABS;
  const activeTimeRange = TIME_RANGES.find(range => range.key === timeRange);
  const activeTimeLabel = activeTimeRange ? t(activeTimeRange.labelKey as TranslationKey) : '';
  const emptyDescription = search || traceName
    ? t('trace.emptySearch', { timeRange: activeTimeLabel })
    : t('trace.emptyFilters', { timeRange: activeTimeLabel });
  const statusLabel = (value: string) => {
    if (value === 'ok') return t('status.ok');
    if (value === 'error') return t('status.error');
    if (value === 'running') return t('status.running');
    return value;
  };

  function switchWorkspace(next: WorkspaceTab) {
    setWorkspaceTab(next);
    setPage(1);
    setTraceName('');
    setCategory(next === 'traces' ? 'user_request' : '');
  }

  if (projectsQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Activity className="mr-2 h-5 w-5 animate-pulse" />
        {t('settings.projects')}
      </div>
    );
  }

  if (projectsQuery.error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="rounded border border-red-200 bg-red-50 px-5 py-4 text-red-700">
          <AlertTriangle className="mr-2 inline h-5 w-5" />
          {t('trace.failedTraces')}
        </div>
      </div>
    );
  }

  if (projectItems.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-6 text-slate-800">
        <div className="max-w-md rounded-md border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded bg-indigo-50 text-indigo-600">
            <FolderPlus className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">{t('trace.projectRequiredTitle')}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t('trace.projectRequiredBody')}</p>
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

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-800">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between px-4 pt-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{t('nav.tracing')}</h1>
            {selectedProject && (
              <p className="mt-0.5 text-xs text-slate-500">
                {t('trace.projectScope')}: <span className="font-medium text-slate-700">{selectedProject.name}</span>
              </p>
            )}
            <div className="mt-2 flex items-center gap-4 text-sm">
              <button
                type="button"
                onClick={() => switchWorkspace('traces')}
                className={`border-b-2 px-1 pb-2 ${
                  workspaceTab === 'traces'
                    ? 'border-indigo-600 font-medium text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
              {t('trace.workspace.traces')}
              </button>
              <button
                type="button"
                onClick={() => switchWorkspace('observations')}
                className={`border-b-2 px-1 pb-2 ${
                  workspaceTab === 'observations'
                    ? 'border-indigo-600 font-medium text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
              {t('trace.workspace.observations')}
              </button>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {t('common.wslFirefly')}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-2 md:flex md:items-center">
          <button
            type="button"
            onClick={() => setFiltersVisible(v => !v)}
            className="inline-flex h-8 items-center justify-center gap-2 rounded border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50 md:justify-start"
          >
            {filtersVisible ? <EyeOff className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
            {filtersVisible ? t('common.hideFilters') : t('common.showFilters')}
          </button>

          <div className="relative col-span-2 md:col-span-1 md:min-w-[320px] md:flex-1">
            <Search className="pointer-events-none absolute left-3 top-2 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder={t('trace.searchPlaceholder')}
              className="h-8 w-full rounded border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-indigo-400"
            />
          </div>

          <select
            value={projectId}
            onChange={event => { setRequestedProjectId(event.target.value); setPage(1); }}
            className="h-8 rounded border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none"
            aria-label={t('common.project')}
          >
            {projectItems.map(project => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>

          <select
            value={timeRange}
            onChange={event => { setTimeRange(event.target.value as TimeRange); setPage(1); }}
            className="h-8 rounded border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none"
          >
            {TIME_RANGES.map(range => <option key={range.key} value={range.key}>{t(range.labelKey as TranslationKey)}</option>)}
          </select>

          <button
            type="button"
            onClick={() => workspaceTab === 'traces' ? traceQuery.refetch() : spanQuery.refetch()}
            className="inline-flex h-8 items-center justify-center gap-2 rounded border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {filtersVisible && (
          <aside className="w-64 shrink-0 overflow-auto border-r border-slate-200 bg-white px-3 py-3">
            <div className="mb-1 text-sm font-medium text-slate-700">{t('trace.filters')}</div>

            {workspaceTab === 'traces' && (
              <>
                <FilterSection title={t('trace.traceName')}>
                  {traceNameFacets.map(([name, count]) => (
                    <FacetButton
                      key={name}
                      label={name}
                      count={count}
                      active={traceName === name}
                      onClick={() => { setTraceName(traceName === name ? '' : name); setPage(1); }}
                    />
                  ))}
                </FilterSection>

                <FilterSection title={t('common.source')}>
                  {sourceFacets.map(([source, count]) => (
                    <FacetButton
                      key={source}
                      label={source}
                      count={count}
                      active={platform === source}
                      onClick={() => { setPlatform(platform === source ? '' : source); setPage(1); }}
                    />
                  ))}
                </FilterSection>
              </>
            )}

            <FilterSection title={t('common.status')}>
              <FacetButton label={t('common.allStatus')} count={facetItems.length} active={!status} onClick={() => { setStatus(''); setPage(1); }} />
              {statusFacets.map(([itemStatus, count]) => (
                <FacetButton
                  key={itemStatus}
                  label={statusLabel(itemStatus)}
                  count={count}
                  active={status === itemStatus}
                  onClick={() => { setStatus(status === itemStatus ? '' : itemStatus as TraceStatus); setPage(1); }}
                />
              ))}
            </FilterSection>

            <FilterSection title={t('common.project')}>
              {projectItems.map(project => (
                <FacetButton
                  key={project.id}
                  label={project.name}
                  count={project.id === projectId ? facetItems.length : 0}
                  active={projectId === project.id}
                  onClick={() => { setRequestedProjectId(project.id); setPage(1); }}
                />
              ))}
            </FilterSection>
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center gap-1">
              {tabs.map(({ key, labelKey }) => {
                const active = category === key;
                return (
                  <button
                    key={key || '_all'}
                    type="button"
                    onClick={() => { setCategory(key); setPage(1); }}
                    className={`rounded px-3 py-1.5 text-sm ${
                      active ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {t(labelKey as TranslationKey)}
                  </button>
                );
              })}
            </div>
            <div className="text-sm text-slate-500">
              <span className="font-mono text-slate-800">{search || traceName ? activeItems.length : activeData?.total || 0}</span> {t('common.records')}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {isLoading && (
              <div className="flex h-[420px] items-center justify-center rounded border border-slate-200 bg-white text-slate-500">
                <Activity className="mr-2 h-5 w-5 animate-pulse" />
                {workspaceTab === 'traces' ? t('trace.loadingTraces') : t('trace.loadingObservations')}
              </div>
            )}

            {error && (
              <div className="flex h-[420px] items-center justify-center rounded border border-red-200 bg-red-50 text-red-700">
                <AlertTriangle className="mr-2 h-5 w-5" />
                {workspaceTab === 'traces' ? t('trace.failedTraces') : t('trace.failedObservations')}
              </div>
            )}

            {workspaceTab === 'traces' && traceQuery.data && (
              <TraceTable traces={traceItems} emptyDescription={emptyDescription} />
            )}
            {workspaceTab === 'observations' && spanQuery.data && (
              <ObservationTable spans={spanItems} emptyDescription={emptyDescription} />
            )}
          </div>

          {activeData && (
            <footer className="flex shrink-0 items-center justify-end gap-4 border-t border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
              <span>
                {t('common.showing')} {activeItems.length ? ((page - 1) * PAGE_SIZE) + 1 : 0}
                {' - '}
                {search || traceName ? activeItems.length : Math.min(page * PAGE_SIZE, activeData.total)}
                {' '}{t('common.of')}{' '}
                {search || traceName ? activeItems.length : activeData.total}
              </span>
              <span>{t('common.page')}</span>
              <input
                value={page}
                onChange={event => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) setPage(Math.min(totalPages, Math.max(1, next)));
                }}
                className="h-8 w-14 rounded border border-slate-200 px-2 text-center font-mono outline-none"
              />
              <span>{t('common.of')} {totalPages}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </footer>
          )}
        </main>
      </div>
    </div>
  );
}
