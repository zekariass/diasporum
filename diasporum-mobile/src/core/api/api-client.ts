/**
 * Centralized HTTP client for the Diasporum backend.
 *
 * Features:
 *  - Centralized base URL from environment config
 *  - Automatic Bearer token injection for authenticated requests
 *  - Proactive token refresh before expiry + reactive refresh on 401
 *  - Single retry after a successful token refresh (no infinite loops)
 *  - Bearer tokens are NEVER sent to any host other than the configured API
 *  - Consistent error mapping to ApiError
 *  - Request timeout (10 s default)
 */

import { appConfig } from '@/core/config/env';
import { ApiError, type BackendErrorBody } from './api-error';
import type { AuthContextValue } from '@/core/auth/auth-provider';
import { getValidAccessToken } from '@/core/auth/auth-provider';
import { isTokenExpired } from '@/core/auth/auth-service';

const DEFAULT_TIMEOUT_MS = 10_000;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  /**
   * When true (default for most requests), a valid Bearer token is attached.
   * Set to false for public endpoints that do not require authentication.
   */
  authenticated?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiClientDeps {
  authContext: AuthContextValue;
}

/**
 * Determines whether a URL is on the configured API host.
 * Bearer tokens are only attached to requests targeting the Diasporum backend.
 */
export function isApiHost(url: string): boolean {
  try {
    const base = new URL(appConfig.apiBaseUrl);
    const target = new URL(url);
    return target.host === base.host;
  } catch {
    return false;
  }
}

async function executeRequest(
  url: string,
  method: HttpMethod,
  body: unknown,
  options: RequestOptions,
  deps: ApiClientDeps
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
  const signal = options.signal
    ? mergeSignals(options.signal, abortController.signal)
    : abortController.signal;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Attach Bearer token only for authenticated requests to the API host
  if (options.authenticated !== false && isApiHost(url)) {
    // Use live tokens from getCurrentTokens() — authState snapshot may be stale
    const tokens = deps.authContext.getCurrentTokens();
    if (tokens) {
      // Proactively refresh if the token is expired (or near expiry)
      const accessToken = isTokenExpired(tokens)
        ? await getValidAccessToken(deps.authContext)
        : tokens.accessToken;

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError({ code: 'TIMEOUT', message: 'Request timed out' });
    }
    console.warn(`[api] ${method} ${url} — network failure`, err);
    throw ApiError.networkError(err);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  let body: BackendErrorBody = {};
  try {
    const text = await response.text();
    if (text) {
      body = JSON.parse(text) as BackendErrorBody;
    }
  } catch {
    // Non-JSON error body — use defaults
  }
  return ApiError.fromHttpResponse(response.status, body);
}

/**
 * Core request method.
 *
 * On a 401 response (and not already a retry), attempts one token refresh
 * then retries the request once. If the retry also fails with 401, or the
 * refresh itself fails, the error propagates to the caller.
 */
async function request<T>(
  method: HttpMethod,
  path: string,
  body: unknown,
  options: RequestOptions,
  deps: ApiClientDeps
): Promise<T> {
  const url = `${appConfig.apiBaseUrl}${path}`;

  const response = await executeRequest(url, method, body, options, deps);

  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  // On 401 and not a retry, attempt refresh and retry once
  if (response.status === 401 && options.authenticated !== false) {
    try {
      await deps.authContext.refreshAndUpdate();
    } catch (refreshErr) {
      // Refresh failed — throw the original 401
      console.warn(`[api] token refresh failed`, refreshErr);
      throw await parseErrorResponse(response);
    }

    // Single retry after successful refresh
    const retryResponse = await executeRequest(
      url,
      method,
      body,
      options,
      deps
    );

    if (retryResponse.ok) {
      if (retryResponse.status === 204) return undefined as T;
      return (await retryResponse.json()) as T;
    }

    const apiErr = await parseErrorResponse(retryResponse);
    console.warn(`[api] ${method} ${path} — ${retryResponse.status}`,
        apiErr.code, apiErr.message);
    throw apiErr;
  }

  const apiErr = await parseErrorResponse(response);
  console.warn(`[api] ${method} ${path} — ${response.status}`,
      apiErr.code, apiErr.message);
  throw apiErr;
}

/** Merges two AbortSignals — aborts when either fires. */
function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

/**
 * Creates an API client bound to the given AuthContext.
 * Obtain the context from `useAuth()` in a React component or hook,
 * then pass it here so the client can access and refresh tokens.
 */
export function createApiClient(deps: ApiClientDeps) {
  return {
    get<T>(path: string, options: RequestOptions = {}): Promise<T> {
      return request<T>('GET', path, undefined, options, deps);
    },
    post<T>(
      path: string,
      body?: unknown,
      options: RequestOptions = {}
    ): Promise<T> {
      return request<T>('POST', path, body, options, deps);
    },
    put<T>(
      path: string,
      body?: unknown,
      options: RequestOptions = {}
    ): Promise<T> {
      return request<T>('PUT', path, body, options, deps);
    },
    patch<T>(
      path: string,
      body?: unknown,
      options: RequestOptions = {}
    ): Promise<T> {
      return request<T>('PATCH', path, body, options, deps);
    },
    delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
      return request<T>('DELETE', path, undefined, options, deps);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
