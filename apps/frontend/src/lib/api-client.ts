// Typed REST client for the NestJS backend (standalone runtime — this is the
// only network boundary the app has; no SaaS/BaaS calls anywhere).

/**
 * Error envelope produced by the backend's AllExceptionsFilter:
 *   { statusCode, error, message, path, timestamp }
 * `message` is always a string.
 */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  path: string;
  timestamp: string;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly errorName: string;
  readonly body: ApiErrorBody | null;

  constructor(statusCode: number, message: string, errorName: string, body: ApiErrorBody | null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errorName = errorName;
    this.body = body;
  }

  get isUnauthorized(): boolean {
    return this.statusCode === 401;
  }
  get isForbidden(): boolean {
    return this.statusCode === 403;
  }
}

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

// Token is provided by the auth layer; the client stays token-agnostic so it can
// be reused before/after auth without importing React context.
type TokenGetter = () => string | null;
let getToken: TokenGetter = () => null;

/** Wired once by AuthProvider so every request carries the current bearer token. */
export function setTokenGetter(fn: TokenGetter): void {
  getToken = fn;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (used by public auth endpoints). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // Non-JSON error (proxy/network) — fall back to status text.
  }
  const message = body?.message ?? res.statusText ?? 'Request failed';
  const errorName = body?.error ?? 'Error';
  return new ApiError(res.status, message, errorName, body);
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!anonymous) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    // Network failure — surface as a synthetic 0-status ApiError so callers
    // have one error type to handle (never swallow it).
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?', 'NetworkError', null);
  }

  if (!res.ok) throw await parseError(res);

  // 204 / empty body
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'DELETE' }),
};
