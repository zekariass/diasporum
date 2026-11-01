import { createApiClient } from '@/core/api/api-client';
import type { AuthContextValue } from '@/core/auth/auth-provider';
import type { AuthState, AuthTokens } from '@/core/auth/auth-types';
/**
 * Regression test for the stale-access-token bug fixed in Phase 2.
 *
 * Bug: executeRequest read authState.tokens from a React state snapshot.
 * After a token refresh, the snapshot was stale — the API client sent the
 * OLD expired token on the next request even though tokensRef had the new one.
 *
 * Fix: getCurrentTokens() reads tokensRef directly — always live.
 * This test proves a request after refresh uses token B, not token A.
 */

jest.mock('@/core/config/env', () => ({
  appConfig: { apiBaseUrl: 'http://localhost:8080', keycloakUrl: 'http://localhost:8081', keycloakRealm: 'diasporum', keycloakClientId: 'diasporum-mobile', authRedirectUri: 'diasporummobile://callback', appEnv: 'development' },
  getTokenEndpoint: jest.fn().mockReturnValue('http://localhost:8081/token'),
  getEndSessionEndpoint: jest.fn(),
  getKeycloakIssuer: jest.fn(),
}));

jest.mock('@/core/auth/auth-service', () => ({
  isTokenExpired: jest.fn().mockReturnValue(true), // force proactive refresh
}));


function makeTokens(accessToken: string): AuthTokens {
  return { accessToken, refreshToken: 'rt', expiresAt: Date.now() + 300_000, tokenType: 'Bearer' };
}

function makeCtx(initialTokens: AuthTokens): AuthContextValue & { _tokens: AuthTokens } {
  const state: { tokens: AuthTokens } = { tokens: initialTokens };
  const authState: AuthState = { status: 'authenticated', tokens: initialTokens, user: { userId: 'u1', sessionId: 'sess-1' } };
  return {
    _tokens: state.tokens,
    authState,
    handleAuthSuccess: jest.fn(),
    logout: jest.fn(),
    // getCurrentTokens reads the LIVE ref — always returns the latest tokens
    getCurrentTokens: jest.fn(() => state.tokens),
    // Simulates refresh: updates tokensRef and authState
    refreshAndUpdate: jest.fn(async () => {
      state.tokens = makeTokens('token-B');
      return state.tokens;
    }),
  };
}

beforeEach(() => { globalThis.fetch = jest.fn(); });

describe('stale-token regression', () => {
  it('uses token B (not token A) after refresh', async () => {
    const ctx = makeCtx(makeTokens('token-A'));
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

    const client = createApiClient({ authContext: ctx });
    await client.get('/api/v1/me');

    const [, opts] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer token-B');
    expect(ctx.refreshAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('second request after refresh still uses token B', async () => {
    const ctx = makeCtx(makeTokens('token-A'));
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

    const client = createApiClient({ authContext: ctx });
    await client.get('/api/v1/me');
    await client.get('/api/v1/me');

    const calls = (globalThis.fetch as jest.Mock).mock.calls as [string, RequestInit][];
    // Both requests must carry token-B (refreshed once, reused for second)
    expect((calls[0][1].headers as Record<string, string>)['Authorization']).toBe('Bearer token-B');
    expect((calls[1][1].headers as Record<string, string>)['Authorization']).toBe('Bearer token-B');
    // refreshAndUpdate called once — second request reuses refreshed token
    expect(ctx.refreshAndUpdate).toHaveBeenCalledTimes(2); // both go through getValidAccessToken
  });

  it('unauthenticated request sends no Authorization header', async () => {
    const ctx: AuthContextValue = {
      authState: { status: 'unauthenticated' },
      handleAuthSuccess: jest.fn(),
      refreshAndUpdate: jest.fn(),
      logout: jest.fn(),
      getCurrentTokens: jest.fn().mockReturnValue(null),
    };
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
    const client = createApiClient({ authContext: ctx });
    await client.get('/api/v1/me');
    const [, opts] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });
});
