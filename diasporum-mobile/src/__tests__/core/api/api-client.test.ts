/**
 * Tests for the centralized API client.
 */

import { createApiClient, isApiHost } from '@/core/api/api-client';
import { ApiError } from '@/core/api/api-error';
import type { AuthContextValue } from '@/core/auth/auth-provider';
import type { AuthState, AuthTokens } from '@/core/auth/auth-types';

// Patch the module-level appConfig so api-client uses a known base URL
jest.mock('@/core/config/env', () => ({
  appConfig: {
    apiBaseUrl: 'http://localhost:8080',
    keycloakUrl: 'http://localhost:8081',
    keycloakRealm: 'diasporum',
    keycloakClientId: 'diasporum-mobile',
    authRedirectUri: 'diasporummobile://callback',
    appEnv: 'development',
  },
  getKeycloakIssuer: jest.fn(),
  getTokenEndpoint: jest.fn().mockReturnValue('http://localhost:8081/realms/diasporum/protocol/openid-connect/token'),
  getEndSessionEndpoint: jest.fn(),
}));

jest.mock('@/core/auth/auth-service', () => ({
  isTokenExpired: jest.fn().mockReturnValue(false),
}));

function makeTokens(overrides: Partial<AuthTokens> = {}): AuthTokens {
  return {
    accessToken: 'valid-access-token',
    refreshToken: 'valid-refresh-token',
    expiresAt: Date.now() + 300_000,
    tokenType: 'Bearer',
    ...overrides,
  };
}

function makeAuthContext(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const authState: AuthState = {
    status: 'authenticated',
    tokens: makeTokens(),
    user: { userId: 'user-1', sessionId: 'sess-1' },
  };
  return {
    authState,
    handleAuthSuccess: jest.fn(),
    refreshAndUpdate: jest.fn(),
    logout: jest.fn(),
    getCurrentTokens: jest.fn().mockReturnValue(
      authState.status === 'authenticated' ? authState.tokens : null
    ),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn();
});

describe('api-client Bearer token injection', () => {
  it('attaches Authorization header to authenticated requests', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ issuer: 'http://localhost:8081', subject: 'sub-1' }),
    });

    const client = createApiClient({ authContext: makeAuthContext() });
    await client.get('/api/v1/me');

    const [, options] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer valid-access-token'
    );
  });

  it('does NOT attach Authorization header when authenticated=false', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const client = createApiClient({ authContext: makeAuthContext() });
    await client.get('/api/v1/public', { authenticated: false });

    const [, options] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('isApiHost returns true for the configured API host', () => {
    expect(isApiHost('http://localhost:8080/api/v1/me')).toBe(true);
    expect(isApiHost('http://localhost:8080')).toBe(true);
  });

  it('isApiHost returns false for a different host', () => {
    expect(isApiHost('https://api.example.com/api/v1/me')).toBe(false);
    expect(isApiHost('https://localhost:9090/api/v1/me')).toBe(false);
    expect(isApiHost('https://evil.localhost:8080/api/v1/me')).toBe(false);
  });

  it('isApiHost returns false for malformed URLs', () => {
    expect(isApiHost('not-a-url')).toBe(false);
    expect(isApiHost('')).toBe(false);
  });
});

describe('api-client error handling', () => {
  it('throws ApiError with correct code on 401', async () => {
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve('{}') })
      // retry after refresh also 401
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve('{}') });

    const refreshAndUpdate = jest.fn().mockResolvedValue(makeTokens());
    const client = createApiClient({ authContext: makeAuthContext({ refreshAndUpdate }) });

    await expect(client.get('/api/v1/me')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      httpStatus: 401,
    });
    // refresh was attempted once, then the retry also failed
    expect(refreshAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('retries once after 401 and succeeds on second attempt', async () => {
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve('{}') })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'ok' }),
      });

    const refreshAndUpdate = jest.fn().mockResolvedValue(makeTokens());
    const client = createApiClient({ authContext: makeAuthContext({ refreshAndUpdate }) });

    const result = await client.get<{ data: string }>('/api/v1/me');
    expect(result.data).toBe('ok');
    expect(refreshAndUpdate).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws ApiError with SERVER_ERROR code on 500', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"message":"Internal error"}'),
    });

    const client = createApiClient({ authContext: makeAuthContext() });
    await expect(client.get('/api/v1/me')).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      httpStatus: 500,
    });
  });

  it('throws ApiError with NETWORK_ERROR when fetch rejects', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('network failed'));
    const client = createApiClient({ authContext: makeAuthContext() });
    await expect(client.get('/api/v1/me')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('uses correct base URL for requests', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    const client = createApiClient({ authContext: makeAuthContext() });
    await client.get('/api/v1/me');
    const [url] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toBe('http://localhost:8080/api/v1/me');
  });
});

describe('ApiError', () => {
  it('isApiError returns true for ApiError instances', () => {
    expect(ApiError.isApiError(new ApiError({ code: 'NOT_FOUND', httpStatus: 404 }))).toBe(true);
  });

  it('isApiError returns false for plain errors', () => {
    expect(ApiError.isApiError(new Error('plain'))).toBe(false);
  });

  it('isUnauthenticated is true for 401', () => {
    const err = new ApiError({ code: 'UNAUTHENTICATED', httpStatus: 401 });
    expect(err.isUnauthenticated).toBe(true);
  });

  it('fromHttpResponse maps status codes correctly', () => {
    expect(ApiError.fromHttpResponse(403, {}).code).toBe('FORBIDDEN');
    expect(ApiError.fromHttpResponse(404, {}).code).toBe('NOT_FOUND');
    expect(ApiError.fromHttpResponse(422, {}).code).toBe('VALIDATION_ERROR');
    expect(ApiError.fromHttpResponse(500, {}).code).toBe('SERVER_ERROR');
  });
});
