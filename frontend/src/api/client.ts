import type {
  AuthCredentials,
  AuthToken,
  CreateOrganizationPayload,
  CreateProjectPayload,
  Organization,
  Project,
  RegisterPayload,
  SpanFilters,
  SpanListResponse,
  Stats,
  TraceDetail,
  TraceFilters,
  TraceListResponse,
  User,
} from '../types';

const BASE_URL = import.meta.env.VITE_FIREFLY_API_URL ?? 'http://localhost:8000';
export const AUTH_TOKEN_KEY = 'firefly.auth.token';

export function getStoredAuthToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

export function setStoredAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  else window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const token = getStoredAuthToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firefly API error ${res.status}: ${body}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function fetchTraces(filters: TraceFilters = {}): Promise<TraceListResponse> {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.platform) params.set('platform', filters.platform);
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.page_size) params.set('page_size', String(filters.page_size));

  const qs = params.toString();
  return request<TraceListResponse>(`/api/v1/traces${qs ? `?${qs}` : ''}`);
}

export function fetchSpans(filters: SpanFilters = {}): Promise<SpanListResponse> {
  const params = new URLSearchParams();
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.page_size) params.set('page_size', String(filters.page_size));

  const qs = params.toString();
  return request<SpanListResponse>(`/api/v1/spans${qs ? `?${qs}` : ''}`);
}

export function fetchTraceDetail(traceId: string): Promise<TraceDetail> {
  return request<TraceDetail>(`/api/v1/traces/${encodeURIComponent(traceId)}`);
}

export function fetchTraceBundle(traceId: string): Promise<TraceDetail> {
  return request<TraceDetail>(`/api/v1/traces/${encodeURIComponent(traceId)}/bundle`);
}

export function fetchStats(projectId?: string): Promise<Stats> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return request<Stats>(`/api/v1/stats${qs}`);
}

export function register(payload: RegisterPayload): Promise<AuthToken> {
  return request<AuthToken>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function login(payload: AuthCredentials): Promise<AuthToken> {
  return request<AuthToken>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function logout(): Promise<void> {
  return request<void>('/api/v1/auth/logout', { method: 'POST' });
}

export function fetchMe(): Promise<User> {
  return request<User>('/api/v1/auth/me');
}

export function fetchOrganizations(): Promise<Organization[]> {
  return request<Organization[]>('/api/v1/organizations');
}

export function createOrganization(payload: CreateOrganizationPayload): Promise<Organization> {
  return request<Organization>('/api/v1/organizations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchProjects(organizationId?: string): Promise<Project[]> {
  const qs = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : '';
  return request<Project[]>(`/api/v1/projects${qs}`);
}

export function createProject(payload: CreateProjectPayload): Promise<Project> {
  return request<Project>('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
