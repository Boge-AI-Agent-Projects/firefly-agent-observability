import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, Flame, Globe2, Home, ListTree, LogOut, Settings, UserCircle } from 'lucide-react';
import type { ComponentType } from 'react';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { useAuth } from '../auth';

const navItems = [
  { to: '/', labelKey: 'nav.home', icon: Home, end: true },
  { to: '/traces', labelKey: 'nav.tracing', icon: ListTree },
  { to: '/', labelKey: 'nav.dashboards', icon: BarChart3, disabled: true },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
] satisfies Array<{
  to: string;
  labelKey: TranslationKey;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  disabled?: boolean;
}>;

export function Layout() {
  const { language, setLanguage, t } = useI18n();
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-[184px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex h-12 items-center gap-2 border-b border-slate-100 px-3">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-amber-50 text-amber-600">
            <Flame className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800">{t('app.name')}</div>
            <div className="truncate text-[11px] text-slate-500">{t('app.version')}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-3">
          {navItems.map(item => {
            const Icon = item.icon;
            const label = t(item.labelKey);
            if (item.disabled) {
              return (
                <div key={item.labelKey} className="flex items-center gap-2 rounded px-2.5 py-2 text-sm text-slate-400">
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </div>
              );
            }
            return (
              <NavLink
                key={item.to + item.labelKey}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded px-2.5 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-slate-100 font-medium text-slate-900'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-2">
          <div className="mb-2 rounded border border-slate-200 bg-slate-50 p-1">
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-500">
              <Globe2 className="h-3.5 w-3.5" />
              {t('language.label')}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {(['zh', 'en'] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLanguage(option)}
                  className={`h-7 rounded text-xs font-medium transition-colors ${
                    language === option
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                  }`}
                >
                  {option === 'zh' ? t('language.zh') : t('language.en')}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-2 rounded border border-slate-200 bg-white px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
              <UserCircle className="h-4 w-4 shrink-0" />
              <span className="truncate">{user?.name || user?.email}</span>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="mt-2 flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t('auth.logout')}
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
