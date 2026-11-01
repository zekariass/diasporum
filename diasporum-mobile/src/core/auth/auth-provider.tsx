/**
 * Authentication React context and provider.
 *
 * Manages the application-wide authentication state and exposes:
 *  - `authState` — discriminated union (loading | unauthenticated | authenticated)
 *  - `handleAuthSuccess` — called by the login hook after code exchange
 *  - `refreshAndUpdate` — for the API client to trigger token refresh
 *  - `logout` — clears state and navigates to the unauthenticated flow
 *
 * The provider runs session restoration on mount so the app never shows the
 * login screen before checking whether a valid session exists.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { appConfig } from '@/core/config/env';
import { authStorage } from './auth-storage';
import * as authService from './auth-service';
import type { AuthState, AuthTokens, UserInfo } from './auth-types';

export interface AuthContextValue {
  authState: AuthState;
  /** Called once after a successful code exchange. */
  handleAuthSuccess: (tokens: AuthTokens) => void;
  /** Refreshes the access token and updates context state. Used by the API client. */
  refreshAndUpdate: () => Promise<AuthTokens>;
  /** Logs out locally and clears all auth state. */
  logout: () => Promise<void>;
  /**
   * Returns the current live tokens — reads from tokensRef so it always reflects
   * the most recent refresh. Use this instead of authState.tokens inside async
   * calls (the authState snapshot may be stale after a refresh).
   */
  getCurrentTokens(): AuthTokens | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  // Keep a stable ref to current tokens for the API client to read without
  // causing re-renders.
  const tokensRef = useRef<AuthTokens | null>(null);

  // --- Session restoration on mount ---
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const tokens = await authService.restoreSession(appConfig, authStorage);
        if (cancelled) return;

        if (!tokens) {
          setAuthState({ status: 'unauthenticated' });
          return;
        }

        const user: UserInfo = authService.extractUserInfo(tokens.accessToken);
        tokensRef.current = tokens;
        setAuthState({ status: 'authenticated', tokens, user });
      } catch {
        // Any unrecoverable error during restore — send to login
        if (!cancelled) {
          setAuthState({ status: 'unauthenticated' });
        }
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Handle successful login (called by the login feature hook) ---
  const handleAuthSuccess = useCallback((tokens: AuthTokens) => {
    const user: UserInfo = authService.extractUserInfo(tokens.accessToken);
    tokensRef.current = tokens;
    setAuthState({ status: 'authenticated', tokens, user });
  }, []);

  // --- Token refresh (used by the API client interceptor) ---
  const refreshAndUpdate = useCallback(async (): Promise<AuthTokens> => {
    const current = tokensRef.current;
    if (!current) {
      setAuthState({ status: 'unauthenticated' });
      throw new Error('No tokens available to refresh');
    }

    try {
      const newTokens = await authService.refreshTokens(
        current,
        appConfig,
        authStorage
      );
      const user: UserInfo = authService.extractUserInfo(newTokens.accessToken);
      tokensRef.current = newTokens;
      setAuthState({ status: 'authenticated', tokens: newTokens, user });
      return newTokens;
    } catch (err) {
      // Refresh failed permanently — clear auth state
      tokensRef.current = null;
      setAuthState({ status: 'unauthenticated' });
      throw err;
    }
  }, []);

  // --- Logout ---
  const handleLogout = useCallback(async () => {
    const current = tokensRef.current;
    tokensRef.current = null;
    // Update state immediately so navigation reacts before the network call
    setAuthState({ status: 'unauthenticated' });

    if (current) {
      // Best-effort Keycloak end-session; local logout already done above
      await authService.logout(current, appConfig, authStorage);
    }
  }, []);

  const getCurrentTokens = useCallback(
    () => tokensRef.current,
    []
  );

  const value: AuthContextValue = {
    authState,
    handleAuthSuccess,
    refreshAndUpdate,
    logout: handleLogout,
    getCurrentTokens,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Consume authentication context.
 * Throws if used outside `<AuthProvider>`.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

/**
 * Returns the current valid access token string, refreshing if needed.
 * Used by the API client to attach bearer tokens to requests.
 * Reads live tokens from getCurrentTokens() — never uses the authState snapshot.
 * Returns null if not authenticated.
 */
export async function getValidAccessToken(
  ctx: AuthContextValue
): Promise<string | null> {
  const { getCurrentTokens, refreshAndUpdate } = ctx;
  const tokens = getCurrentTokens();
  if (!tokens) return null;

  if (authService.isTokenExpired(tokens)) {
    try {
      const newTokens = await refreshAndUpdate();
      return newTokens.accessToken;
    } catch {
      return null;
    }
  }

  return tokens.accessToken;
}
