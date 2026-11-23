import type { ApiErrorBody } from '@almanach/shared';

/** Fired on window when an API call finds the session gone, so the app can ask to sign in again. */
export const SESSION_EXPIRED_EVENT = 'almanach:session-expired';

/** Error raised for any non-2xx answer, or `status: 0` when the server could not be reached. */
export class ApiError extends Error {
  /**
   * Creates the error
   *
   * @param status {number} - HTTP status, 0 for network failures
   * @param body {ApiErrorBody} - parsed error body
   */
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.error);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  installToken?: string;
}

/**
 * Calls the Almanach API with JSON in and out; the server revalidates everything it receives
 *
 * @param path {string} - API path starting with /api/
 * @param options {RequestOptions} - method, JSON body and optional installation token
 * @returns {Promise<T>} - parsed JSON body, or undefined for 204 responses
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.installToken) headers['X-Install-Token'] = options.installToken;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, { error: 'network' });
  }

  if (response.status === 401 && !path.startsWith('/api/auth/') && !path.startsWith('/api/install/')) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => ({ error: 'invalid_response' }));
  if (!response.ok) throw new ApiError(response.status, data as ApiErrorBody);
  return data as T;
}
