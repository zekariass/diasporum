/**
 * Shared auth-flow hooks — email login, registration, provider sign-in.
 * All call the first-party Diasporum backend via auth-api/auth-service.
 */

import { useCallback, useMemo, useState } from 'react';

import { useAuth } from '@/core/auth/auth-provider';
import { authStorage } from '@/core/auth/auth-storage';
import { appConfig } from '@/core/config/env';
import { createAuthApi } from '@/features/authentication/services/auth-api';
import {
  getGoogleIdToken,
  getAppleCredential,
} from '@/features/authentication/services/provider-signin';
import { createApiClient } from '@/core/api/api-client';
import { ApiError } from '@/core/api/api-error';
import { AuthError } from '@/core/auth/auth-errors';
import { authResponseToTokens } from '@/core/auth/auth-types';
import * as authService from '@/core/auth/auth-service';

export interface FlowState {
  isLoading: boolean;
  error: string | null;
}

function toMessage(e: unknown): string {
  if (AuthError.isAuthError(e)) return e.userMessage;
  if (ApiError.isApiError(e)) {
    if (e.code === 'UNAUTHENTICATED' || e.httpStatus === 401)
      return 'Incorrect email or password.';
    if (e.httpStatus === 409) return 'An account with this email already exists.';
    if (e.isForbidden) return 'This account is restricted.';
    return e.userMessage;
  }
  return 'Something went wrong. Please try again.';
}

export function useAuthFlow() {
  const auth = useAuth();
  const api = useMemo(() => createAuthApi(createApiClient({ authContext: auth })), [auth]);
  const [state, setState] = useState<FlowState>({ isLoading: false, error: null });

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setState((s) => (s.isLoading ? s : { isLoading: true, error: null }));
      try {
        await fn();
        setState({ isLoading: false, error: null });
        return true;
      } catch (e) {
        if (AuthError.isAuthError(e) && e.code === 'AUTH_CANCELLED') {
          setState({ isLoading: false, error: null });
        } else {
          // Surface the real error in Metro — the UI only gets a safe message.
          console.warn('[auth] flow failed', e);
          setState({ isLoading: false, error: toMessage(e) });
        }
        return false;
      }
    },
    []
  );

  const finish = useCallback(
    async (authResponse: Parameters<typeof authResponseToTokens>[0]) => {
      const tokens = authResponseToTokens(authResponse);
      await authStorage.saveTokens(tokens);
      auth.handleAuthSuccess(tokens);
    },
    [auth]
  );

  const loginWithPassword = useCallback(
    (email: string, password: string) =>
      run(async () => {
        const r = await api.login(email.trim(), password);
        await finish(r);
      }),
    [api, finish, run]
  );

  const loginWithGoogle = useCallback(
    () =>
      run(async () => {
        const idToken = await getGoogleIdToken();
        const r = await api.externalLogin('google', idToken);
        await finish(r);
      }),
    [api, finish, run]
  );

  const loginWithApple = useCallback(
    () =>
      run(async () => {
        const { idToken } = await getAppleCredential();
        const r = await api.externalLogin('apple', idToken);
        await finish(r);
      }),
    [api, finish, run]
  );

  const register = useCallback(
    (email: string, password: string) =>
      run(async () => {
        await api.register(email.trim(), password);
      }),
    [api, run]
  );

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return {
    state,
    loginWithPassword,
    loginWithGoogle,
    loginWithApple,
    register,
    clearError,
    appConfig,
    authService,
  };
}
