/**
 * Authentication service — non-React, pure business logic over the
 * first-party Diasporum /api/v1/auth endpoints.
 *
 *  - Token refresh via POST /auth/refresh (opaque rotating refresh tokens)
 *  - Single-flight refresh: concurrent callers share one in-flight request
 *  - Refresh-token rotation: the new refresh token replaces the old one
 *  - Replay/expired refresh → clear credentials → unauthenticated
 *  - Session restoration from SecureStore
 *  - Logout / logout-all via backend session revocation
 */

import type { AppConfig } from '@/core/config/env';
import { AuthError } from './auth-errors';
import type {
  AuthResponse,
  AuthTokens,
  UserInfo,
} from './auth-types';
import { authResponseToTokens } from './auth-types';
import type { AuthStorage } from './auth-storage';

const EXPIRY_BUFFER_SECONDS = 30;

let refreshPromise: Promise<AuthTokens> | null = null;

export function isTokenExpired(tokens: AuthTokens): boolean {
  return tokens.expiresAt - EXPIRY_BUFFER_SECONDS * 1000 <= Date.now();
}

/** Decode JWT payload for UX only (userId/sessionId) — never authoritative. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(globalThis.atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function extractUserInfo(accessToken: string): UserInfo {
  const p = decodeJwtPayload(accessToken);
  return {
    userId: typeof p.sub === 'string' ? p.sub : '',
    sessionId: typeof p.sid === 'string' ? p.sid : '',
    email: typeof p.email === 'string' ? p.email : undefined,
  };
}

async function post<T>(
  config: AppConfig,
  path: string,
  body: unknown,
  accessToken?: string
): Promise<{ status: number; data: T | null }> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AuthError('NETWORK_ERROR', 'Request failed');
  }
  const data = response.status === 204 ? null : ((await response.json().catch(() => null)) as T | null);
  return { status: response.status, data };
}

/** Public auth call returning a session. Used by login feature code. */
export async function loginWithPassword(
  config: AppConfig,
  storage: AuthStorage,
  email: string,
  password: string
): Promise<AuthTokens> {
  const { status, data } = await post<AuthResponse>(config, '/api/v1/auth/login', {
    email,
    password,
  });
  if (status === 401) throw new AuthError('INVALID_CREDENTIALS');
  if (status === 403) throw new AuthError('ACCOUNT_RESTRICTED');
  if (status !== 200 || !data) throw new AuthError('AUTH_FAILED', `HTTP ${status}`);
  const tokens = authResponseToTokens(data);
  await storage.saveTokens(tokens);
  return tokens;
}

export async function loginWithProvider(
  config: AppConfig,
  storage: AuthStorage,
  provider: 'google' | 'apple',
  idToken: string
): Promise<AuthTokens> {
  const { status, data } = await post<AuthResponse>(
    config,
    `/api/v1/auth/${provider}`,
    { idToken }
  );
  if (status === 401) throw new AuthError('PROVIDER_TOKEN_INVALID');
  if (status === 403) throw new AuthError('ACCOUNT_RESTRICTED');
  if (status !== 200 || !data) throw new AuthError('AUTH_FAILED', `HTTP ${status}`);
  const tokens = authResponseToTokens(data);
  await storage.saveTokens(tokens);
  return tokens;
}

export async function refreshTokens(
  currentTokens: AuthTokens,
  config: AppConfig,
  storage: AuthStorage
): Promise<AuthTokens> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = performRefresh(currentTokens, config, storage).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function performRefresh(
  currentTokens: AuthTokens,
  config: AppConfig,
  storage: AuthStorage
): Promise<AuthTokens> {
  const { status, data } = await post<AuthResponse>(config, '/api/v1/auth/refresh', {
    refreshToken: currentTokens.refreshToken,
  });
  if (status === 401 || status === 400) {
    // Expired / revoked / replayed refresh token → session is over.
    await storage.clearTokens();
    throw new AuthError('SESSION_EXPIRED', `Refresh failed HTTP ${status}`);
  }
  if (status !== 200 || !data) {
    throw new AuthError('TOKEN_REFRESH_FAILED', `Refresh HTTP ${status}`);
  }
  // Rotation: the new refresh token REPLACES the old — persist atomically.
  const newTokens = authResponseToTokens(data);
  await storage.saveTokens(newTokens);
  return newTokens;
}

export async function restoreSession(
  config: AppConfig,
  storage: AuthStorage
): Promise<AuthTokens | null> {
  let tokens: AuthTokens | null;
  try {
    tokens = await storage.getTokens();
  } catch {
    return null;
  }
  if (!tokens) return null;
  if (!isTokenExpired(tokens)) return tokens;
  try {
    return await refreshTokens(tokens, config, storage);
  } catch (err) {
    if (AuthError.isAuthError(err) && err.code === 'SESSION_EXPIRED') return null;
    if (AuthError.isAuthError(err) && err.code === 'NETWORK_ERROR') return tokens;
    return null;
  }
}

/** Revokes the current session server-side; local state already cleared. */
export async function logout(
  tokens: AuthTokens,
  config: AppConfig,
  storage: AuthStorage
): Promise<void> {
  await storage.clearTokens();
  try {
    await post(config, '/api/v1/auth/logout', undefined, tokens.accessToken);
  } catch {
    // best-effort — local logout already completed
  }
}

/** Revokes ALL sessions for the account server-side. */
export async function logoutAll(
  tokens: AuthTokens,
  config: AppConfig,
  storage: AuthStorage
): Promise<void> {
  await storage.clearTokens();
  try {
    await post(config, '/api/v1/auth/logout-all', undefined, tokens.accessToken);
  } catch {
    // best-effort
  }
}

export function _resetRefreshState(): void {
  refreshPromise = null;
}
