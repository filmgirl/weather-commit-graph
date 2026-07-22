import type {
  AddRepoRequest,
  ApiErrorBody,
  ForecastPayload,
  RepoSummary,
  ReposResponse,
} from '@wcg/shared';

/**
 * Error carrying the server's machine-readable code, so the UI can distinguish
 * "you typed a bad path" from "that repo vanished" from "something broke".
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    });
  } catch (error) {
    // An aborted request is a normal cancellation, not a failure to surface.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // fetch only rejects on network-level failure, which here means the API is down.
    throw new ApiError('Cannot reach the local API server.', 'network_error', 0);
  }

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = body as ApiErrorBody | null;
    throw new ApiError(
      error?.error ?? `Request failed with status ${response.status}`,
      error?.code ?? 'unknown_error',
      response.status,
    );
  }

  return body as T;
}

export function listRepos(): Promise<ReposResponse> {
  return request<ReposResponse>('/repos');
}

export function addRepo(path: string): Promise<{ repo: RepoSummary }> {
  const payload: AddRepoRequest = { path };
  return request<{ repo: RepoSummary }>('/repos', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function removeRepo(id: string): Promise<void> {
  return request<void>(`/repos/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function fetchForecast(
  id: string,
  windowDays: number,
  signal?: AbortSignal,
): Promise<ForecastPayload> {
  return request<ForecastPayload>(
    `/repos/${encodeURIComponent(id)}/forecast?window=${windowDays}`,
    { signal },
  );
}
