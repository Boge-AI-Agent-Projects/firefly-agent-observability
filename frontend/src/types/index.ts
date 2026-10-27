export type TraceStatus = 'ok' | 'error' | 'running';
export type SpanType = 'gen_ai.chat' | 'gen_ai.tool' | 'gen_ai.embed' | 'gen_ai.embedding' | 'gen_ai.retrieval' | 'tool' | 'retrieval' | 'agent' | 'chain' | string;

export interface TraceSummary {
  id: string;
  project_id: string;
  session_id: string | null;
  user_id: string | null;
  name: string;
  input: unknown | null;
  output: unknown | null;
  status: TraceStatus;
  latency_ms: number | null;
  total_tokens: number;
  total_cost: number;
  span_count: number;
  error_count: number;
  timestamp_start: string;
  metadata: Record<string, unknown> | null;
  category: string;
  tags: string[] | null;
  created_at: string;
}

export interface TraceListResponse {
  items: TraceSummary[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
}

export interface Span {
  id: string;
  parent_span_id: string | null;
  trace_id: string;
  type: SpanType;
  name: string;
  model: string | null;
  provider: string | null;
  category: string;
  input: unknown | null;
  output: unknown | null;
  tokens_input: number;
  tokens_output: number;
  total_tokens: number;
  cost_usd: number | null;
  latency_ms: number | null;
  first_token_ms: number | null;
  timestamp_start: string;
  timestamp_end: string | null;
  status: TraceStatus;
  error: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface TraceDetail {
  id: string;
  project_id: string;
  session_id: string | null;
  user_id: string | null;
  name: string;
  input: unknown | null;
  output: unknown | null;
  timestamp_start: string;
  timestamp_end: string | null;
  latency_ms: number | null;
  total_tokens: number;
  total_cost: number;
  span_count: number;
  error_count: number;
  status: TraceStatus;
  category: string;
  metadata: Record<string, unknown> | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
  spans: Span[];
}

export interface Stats {
  total_traces: number;
  total_spans: number;
  error_traces: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
}

export interface TraceFilters {
  project_id?: string;
  platform?: string;
  status?: TraceStatus | '';
  category?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}

export interface SpanFilters {
  project_id?: string;
  type?: string;
  status?: TraceStatus | '';
  category?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}

export interface SpanListResponse {
  items: Span[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
}

export interface TraceIngestPayload {
  project_id: string;
  session_id?: string;
  trace_id?: string;
  name: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  timestamp_start: string;
  latency_ms?: number;
  total_tokens?: number;
  status?: TraceStatus;
  tags?: string[];
  spans?: unknown[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface AuthToken {
  access_token: string;
  token_type: 'bearer';
  expires_at: string;
  user: User;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface RegisterPayload extends AuthCredentials {
  name: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  organization_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOrganizationPayload {
  name: string;
  slug?: string;
  description?: string;
}

export interface CreateProjectPayload {
  organization_id: string;
  name: string;
  slug?: string;
  description?: string;
}
