import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Activity, Flame, UserPlus } from 'lucide-react';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

export function Register() {
  const { t } = useI18n();
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/settings" replace />;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await register({ name, email, password });
      navigate('/settings', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.registerFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-amber-50 text-amber-600">
            <Flame className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">{t('app.name')}</p>
            <h1 className="text-xl font-semibold">{t('auth.registerTitle')}</h1>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-600">{t('auth.name')}</span>
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              required
              className="mt-1 h-10 w-full rounded border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-600">{t('auth.email')}</span>
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
              className="mt-1 h-10 w-full rounded border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-600">{t('auth.password')}</span>
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              minLength={8}
              required
              className="mt-1 h-10 w-full rounded border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400"
            />
          </label>
        </div>

        {error && <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {submitting ? <Activity className="h-4 w-4 animate-pulse" /> : <UserPlus className="h-4 w-4" />}
          {t('auth.register')}
        </button>

        <p className="mt-4 text-center text-sm text-slate-500">
          {t('auth.hasAccount')}{' '}
          <Link to="/login" className="font-medium text-indigo-600 hover:underline">{t('auth.login')}</Link>
        </p>
      </form>
    </div>
  );
}
