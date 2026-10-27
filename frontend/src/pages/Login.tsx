import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Flame, LogIn } from 'lucide-react';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

export function Login() {
  const { t } = useI18n();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await login({ email, password });
      const state = location.state as { from?: { pathname?: string } } | null;
      navigate(state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-slate-50 text-slate-900 lg:grid-cols-[minmax(420px,520px)_1fr]">
      <section className="flex flex-col justify-between border-r border-slate-200 bg-white p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-amber-50 text-amber-600">
            <Flame className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold">{t('app.name')}</div>
            <div className="text-xs text-slate-500">{t('app.version')}</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="mx-auto w-full max-w-sm space-y-5">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-amber-600">{t('auth.welcomeBack')}</p>
            <h1 className="mt-2 text-2xl font-semibold">{t('auth.loginTitle')}</h1>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-600">{t('auth.email')}</span>
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
              className="mt-1 h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-600">{t('auth.password')}</span>
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
              className="mt-1 h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400"
            />
          </label>

          {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? <Activity className="h-4 w-4 animate-pulse" /> : <LogIn className="h-4 w-4" />}
            {t('auth.login')}
          </button>

          <p className="text-center text-sm text-slate-500">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="font-medium text-indigo-600 hover:underline">{t('auth.createAccount')}</Link>
          </p>
        </form>

        <p className="text-xs text-slate-400">{t('auth.loginFootnote')}</p>
      </section>

      <section className="hidden bg-slate-100 p-10 lg:block">
        <div className="flex h-full items-center justify-center">
          <div className="w-full max-w-xl rounded-md border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t('auth.workspace')}</p>
            <h2 className="mt-2 text-2xl font-semibold">{t('auth.workspaceHeadline')}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t('auth.workspaceCopy')}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
