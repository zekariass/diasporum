/**
 * Authentication API service — all /api/v1/auth/** calls in one place.
 * Public endpoints use plain fetch; authenticated endpoints go through the
 * shared ApiClient (token injection + refresh).
 */

import { appConfig } from '@/core/config/env';
import type { ApiClient } from '@/core/api/api-client';
import { ApiError, type BackendErrorBody } from '@/core/api/api-error';
import type { AccountMe, AuthResponse, SessionView } from '@/core/auth/auth-types';

export const AUTH_ENDPOINTS = {
  register: '/api/v1/auth/register',
  login: '/api/v1/auth/login',
  google: '/api/v1/auth/google',
  apple: '/api/v1/auth/apple',
  refresh: '/api/v1/auth/refresh',
  logout: '/api/v1/auth/logout',
  logoutAll: '/api/v1/auth/logout-all',
  me: '/api/v1/auth/me',
  sessions: '/api/v1/auth/sessions',
  verifyEmail: '/api/v1/auth/verify-email',
  resendVerification: '/api/v1/auth/resend-verification',
  forgotPassword: '/api/v1/auth/forgot-password',
  resetPassword: '/api/v1/auth/reset-password',
  changePassword: '/api/v1/auth/change-password',
  linkGoogle: '/api/v1/auth/link/google',
  linkApple: '/api/v1/auth/link/apple',
  link: (id: string) => `/api/v1/auth/link/${id}`,
  session: (id: string) => `/api/v1/auth/sessions/${id}`,
} as const;

async function publicPost<T>(
  path: string,
  body: unknown
): Promise<{ status: number; body: T | null; error: BackendErrorBody | null }> {
  let res: Response;
  try {
    res = await fetch(`${appConfig.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch (e) {
    throw ApiError.networkError(e);
  }
  const json = res.status === 204 ? null : ((await res.json().catch(() => null)) as T | BackendErrorBody | null);
  if (res.ok) return { status: res.status, body: json as T | null, error: null };
  const err = (json ?? {}) as BackendErrorBody;
  return { status: res.status, body: null, error: err };
}

export function createAuthApi(client: ApiClient) {
  return {
    // ---- Public endpoints ----
    async register(email: string, password: string): Promise<{ userId: string }> {
      const r = await publicPost<{ userId: string; message: string }>(
        AUTH_ENDPOINTS.register, { email, password });
      if (r.status === 201 && r.body) return r.body;
      throw ApiError.fromHttpResponse(r.status, r.error ?? {});
    },
    async login(email: string, password: string): Promise<AuthResponse> {
      const r = await publicPost<AuthResponse>(AUTH_ENDPOINTS.login, { email, password });
      if (r.status === 200 && r.body) return r.body;
      throw ApiError.fromHttpResponse(r.status, r.error ?? {});
    },
    async externalLogin(provider: 'google' | 'apple', idToken: string): Promise<AuthResponse> {
      const r = await publicPost<AuthResponse>(
        provider === 'google' ? AUTH_ENDPOINTS.google : AUTH_ENDPOINTS.apple,
        { idToken });
      if (r.status === 200 && r.body) return r.body;
      throw ApiError.fromHttpResponse(r.status, r.error ?? {});
    },
    async verifyEmail(token: string): Promise<void> {
      const r = await publicPost(AUTH_ENDPOINTS.verifyEmail, { token });
      if (r.status !== 204) throw ApiError.fromHttpResponse(r.status, r.error ?? {});
    },
    async resendVerification(email: string): Promise<void> {
      const r = await publicPost(AUTH_ENDPOINTS.resendVerification, { email });
      if (r.status !== 204) throw ApiError.fromHttpResponse(r.status, r.error ?? {});
    },
    async forgotPassword(email: string): Promise<void> {
      const r = await publicPost(AUTH_ENDPOINTS.forgotPassword, { email });
      if (r.status !== 204) throw ApiError.fromHttpResponse(r.status, r.error ?? {});
    },
    async resetPassword(token: string, password: string): Promise<void> {
      const r = await publicPost(AUTH_ENDPOINTS.resetPassword, { token, password });
      if (r.status !== 204) throw ApiError.fromHttpResponse(r.status, r.error ?? {});
    },

    // ---- Authenticated endpoints (via shared ApiClient) ----
    me(): Promise<AccountMe> {
      return client.get<AccountMe>(AUTH_ENDPOINTS.me, { authenticated: true });
    },
    sessions(): Promise<SessionView[]> {
      return client.get<SessionView[]>(AUTH_ENDPOINTS.sessions, { authenticated: true });
    },
    revokeSession(sessionId: string): Promise<void> {
      return client.delete<void>(AUTH_ENDPOINTS.session(sessionId), { authenticated: true });
    },
    logout(): Promise<void> {
      return client.post<void>(AUTH_ENDPOINTS.logout, undefined, { authenticated: true });
    },
    logoutAll(): Promise<void> {
      return client.post<void>(AUTH_ENDPOINTS.logoutAll, undefined, { authenticated: true });
    },
    changePassword(currentPassword: string, newPassword: string): Promise<void> {
      return client.post<void>(
        AUTH_ENDPOINTS.changePassword, { currentPassword, newPassword },
        { authenticated: true });
    },
    linkIdentity(provider: 'google' | 'apple', idToken: string): Promise<void> {
      return client.post<void>(
        provider === 'google' ? AUTH_ENDPOINTS.linkGoogle : AUTH_ENDPOINTS.linkApple,
        { idToken }, { authenticated: true });
    },
    unlinkIdentity(externalIdentityId: string): Promise<void> {
      return client.delete<void>(AUTH_ENDPOINTS.link(externalIdentityId), { authenticated: true });
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
