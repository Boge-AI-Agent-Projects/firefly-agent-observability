import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, FolderPlus, Plus, RefreshCw, UserCircle } from 'lucide-react';
import { createOrganization, createProject, fetchOrganizations, fetchProjects } from '../api/client';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

export function WorkspaceSettings() {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');

  const organizationsQuery = useQuery({
    queryKey: ['organizations'],
    queryFn: fetchOrganizations,
  });

  const organizations = useMemo(() => organizationsQuery.data || [], [organizationsQuery.data]);
  const selectedOrg = useMemo(
    () => organizations.find(org => org.id === selectedOrgId) || organizations[0] || null,
    [organizations, selectedOrgId],
  );

  const projectsQuery = useQuery({
    queryKey: ['projects', selectedOrg?.id || 'none'],
    queryFn: () => fetchProjects(selectedOrg?.id),
    enabled: Boolean(selectedOrg),
  });

  const orgMutation = useMutation({
    mutationFn: createOrganization,
    onSuccess(org) {
      setOrgName('');
      setOrgDescription('');
      setSelectedOrgId(org.id);
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });

  const projectMutation = useMutation({
    mutationFn: createProject,
    onSuccess() {
      setProjectName('');
      setProjectDescription('');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  function submitOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    orgMutation.mutate({ name: orgName, description: orgDescription || undefined });
  }

  function submitProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrg) return;
    projectMutation.mutate({
      organization_id: selectedOrg.id,
      name: projectName,
      description: projectDescription || undefined,
    });
  }

  return (
    <div className="h-screen overflow-auto bg-slate-50 p-5 text-slate-900">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-600">{t('settings.workspace')}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t('settings.title')}</h1>
        </div>
        <div className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          <UserCircle className="h-4 w-4" />
          <span>{user?.name}</span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-indigo-600" />
            <h2 className="text-base font-semibold">{t('settings.createOrganization')}</h2>
          </div>
          <form onSubmit={submitOrganization} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-600">{t('settings.organizationName')}</span>
              <input
                value={orgName}
                onChange={event => setOrgName(event.target.value)}
                required
                className="mt-1 h-9 w-full rounded border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-600">{t('settings.description')}</span>
              <textarea
                value={orgDescription}
                onChange={event => setOrgDescription(event.target.value)}
                rows={3}
                className="mt-1 w-full resize-none rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
            </label>
            {orgMutation.error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{String(orgMutation.error.message)}</p>}
            <button
              type="submit"
              disabled={orgMutation.isPending}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {t('settings.createOrganization')}
            </button>
          </form>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-emerald-600" />
              <h2 className="text-base font-semibold">{t('settings.createProject')}</h2>
            </div>
            <button
              type="button"
              onClick={() => { organizationsQuery.refetch(); projectsQuery.refetch(); }}
              className="inline-flex h-8 items-center gap-2 rounded border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              {t('common.refresh')}
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-600">{t('settings.organization')}</span>
                <select
                  value={selectedOrg?.id || ''}
                  onChange={event => setSelectedOrgId(event.target.value)}
                  className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400"
                >
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </label>

              <form onSubmit={submitProject} className="space-y-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-600">{t('settings.projectName')}</span>
                  <input
                    value={projectName}
                    onChange={event => setProjectName(event.target.value)}
                    required
                    disabled={!selectedOrg}
                    className="mt-1 h-9 w-full rounded border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 disabled:bg-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-600">{t('settings.description')}</span>
                  <textarea
                    value={projectDescription}
                    onChange={event => setProjectDescription(event.target.value)}
                    rows={3}
                    disabled={!selectedOrg}
                    className="mt-1 w-full resize-none rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 disabled:bg-slate-100"
                  />
                </label>
                {!selectedOrg && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">{t('settings.createOrgFirst')}</p>}
                {projectMutation.error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{String(projectMutation.error.message)}</p>}
                <button
                  type="submit"
                  disabled={!selectedOrg || projectMutation.isPending}
                  className="inline-flex h-9 items-center gap-2 rounded bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  {t('settings.createProject')}
                </button>
              </form>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-sm font-semibold text-slate-700">{t('settings.projects')}</p>
              <div className="space-y-2">
                {(projectsQuery.data || []).map(project => (
                  <div key={project.id} className="rounded border border-slate-200 bg-white p-3">
                    <p className="text-sm font-medium text-slate-800">{project.name}</p>
                    <p className="mt-1 font-mono text-xs text-slate-500">{project.slug}</p>
                  </div>
                ))}
                {selectedOrg && projectsQuery.data?.length === 0 && (
                  <p className="rounded border border-dashed border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
                    {t('settings.noProjects')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
