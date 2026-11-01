/**
 * Tests for the auth service: token validation, refresh, session restore, logout.
 */

import {
  isTokenExpired,
  decodeJwtPayload,
  extractUserInfo,
  refreshTokens,
  restoreSession,
  logout,
  _resetRefreshState,
} from '@/core/auth/auth-service';
import { AuthError } from '@/core/auth/auth-errors';
import type { AuthTokens } from '@/core/auth/auth-types';
import type { AppConfig } from '@/core/config/env';
import type { AuthStorage } from '@/core/auth/auth-storage';

// jest.mock is hoisted by babel-jest so these mocks are in effect
// before any module-level code runs, even though they appear after the imports.
jest.mock('@/core/config/env', () => ({
  appConfig: {
    appEnv: 'development',
    apiBaseUrl: 'http://localhost:8080',
    keycloakUrl: 'http://localhost:8081',
    keycloakRealm: 'diasporum',
    keycloakClientId: 'diasporum-mobile',
    authRedirectUri: 'diasporummobile://callback',
  },
  getTokenEndpoint: jest.fn().mockReturnValue(
    'http://localhost:8081/realms/diasporum/protocol/openid-connect/token'
  ),
  getEndSessionEndpoint: jest.fn().mockReturnValue(
    'http://localhost:8081/realms/diasporum/protocol/openid-connect/logout'
  ),
  getKeycloakIssuer: jest.fn().mockReturnValue(
    'http://localhost:8081/realms/diasporum'
  ),
}));

/** Encodes a string to base64url without Buffer (works in any JS environment). */
function toBase64url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

const CONFIG: AppConfig = {
  appEnv: 'development',
  apiBaseUrl: 'http://localhost:8080',
  googleAndroidClientId: '', googleIosClientId: '',
  googleWebClientId: 'test-web-client', appleClientId: 'test-apple',
  authRedirectUri: 'diasporummobile://callback',
};

function makeTokens(overrides: Partial<AuthTokens> = {}): AuthTokens {
  return {
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: Date.now() + 300_000,
    tokenType: 'Bearer',
    ...overrides,
  };
}

function makeStorage(overrides: Partial<AuthStorage> = {}): AuthStorage {
  return {
    getTokens: jest.fn(),
    saveTokens: jest.fn().mockResolvedValue(undefined),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  _resetRefreshState();
  jest.clearAllMocks();
});

// ---------- isTokenExpired ----------

describe('isTokenExpired', () => {
  it('returns false when token has plenty of time left', () => {
    const tokens = makeTokens({ expiresAt: Date.now() + 300_000 });
    expect(isTokenExpired(tokens)).toBe(false);
  });

  it('returns true when token is already expired', () => {
    const tokens = makeTokens({ expiresAt: Date.now() - 1000 });
    expect(isTokenExpired(tokens)).toBe(true);
  });

  it('returns true when token expires within the 30-second buffer', () => {
    const tokens = makeTokens({ expiresAt: Date.now() + 10_000 });
    expect(isTokenExpired(tokens)).toBe(true);
  });
});

// ---------- decodeJwtPayload ----------

describe('decodeJwtPayload', () => {
  it('returns empty object for malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toEqual({});
  });

  it('decodes a real base64url-encoded payload', () => {
    const payload = { sub: 'user-123', preferred_username: 'testuser', iss: 'http://localhost:8081/realms/diasporum' };
    const encoded = toBase64url(JSON.stringify(payload));
    const fakeJwt = `header.${encoded}.signature`;
    expect(decodeJwtPayload(fakeJwt)).toMatchObject({ sub: 'user-123' });
  });
});

// ---------- extractUserInfo ----------

describe('extractUserInfo', () => {
  it('extracts userId/sessionId from a Diasporum access token', () => {
    const payload = { sub: 'abc-123', sid: 'sess-456', email: 'alice@example.com' };
    const encoded = toBase64url(JSON.stringify(payload));
    const fakeToken = `h.${encoded}.s`;
    const info = extractUserInfo(fakeToken);
    expect(info.userId).toBe('abc-123');
    expect(info.sessionId).toBe('sess-456');
    expect(info.email).toBe('alice@example.com');
  });
});

// ---------- refreshTokens ----------

describe('refreshTokens', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  it('returns new tokens on a successful refresh', async () => {
    const refreshResponse = { accessToken: 'new-at', refreshToken: 'new-rt', expiresIn: 300, tokenType: 'Bearer', userId: 'u1', sessionId: 's1' };
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(refreshResponse),
    });

    const storage = makeStorage();
    const result = await refreshTokens(makeTokens(), CONFIG, storage);
    expect(result.accessToken).toBe('new-at');
    expect(result.refreshToken).toBe('new-rt');
    expect(storage.saveTokens).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'new-at' }));
  });

  it('throws SESSION_EXPIRED when the backend returns 400', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve(null) });
    const storage = makeStorage();
    await expect(refreshTokens(makeTokens(), CONFIG, storage)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(storage.clearTokens).toHaveBeenCalled();
  });

  it('throws NETWORK_ERROR when fetch rejects', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    const storage = makeStorage();
    await expect(refreshTokens(makeTokens(), CONFIG, storage)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('prevents concurrent refresh requests (single-flight)', async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstCall = new Promise((resolve) => { resolveFirst = resolve; });
    const refreshBody = { accessToken: 'shared-at', refreshToken: 'shared-rt', expiresIn: 300, tokenType: 'Bearer', userId: 'u1', sessionId: 's1' };

    (globalThis.fetch as jest.Mock).mockReturnValueOnce(
      firstCall.then(() => ({ ok: true, status: 200, json: () => Promise.resolve(refreshBody) }))
    );

    const storage = makeStorage();
    const tokens = makeTokens();

    const p1 = refreshTokens(tokens, CONFIG, storage);
    const p2 = refreshTokens(tokens, CONFIG, storage);

    resolveFirst(undefined);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.accessToken).toBe('shared-at');
    expect(r2.accessToken).toBe('shared-at');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------- restoreSession ----------

describe('restoreSession', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  it('returns null when no tokens are stored', async () => {
    const storage = makeStorage({ getTokens: jest.fn().mockResolvedValue(null) });
    const result = await restoreSession(CONFIG, storage);
    expect(result).toBeNull();
  });

  it('returns tokens directly when they are still valid', async () => {
    const tokens = makeTokens({ expiresAt: Date.now() + 300_000 });
    const storage = makeStorage({ getTokens: jest.fn().mockResolvedValue(tokens) });
    const result = await restoreSession(CONFIG, storage);
    expect(result).toEqual(tokens);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refreshes expired tokens during restore', async () => {
    const expiredTokens = makeTokens({ expiresAt: Date.now() - 1000 });
    const newBody = { accessToken: 'fresh-at', refreshToken: 'fresh-rt', expiresIn: 300, tokenType: 'Bearer', userId: 'u1', sessionId: 's1' };
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(newBody) });
    const storage = makeStorage({ getTokens: jest.fn().mockResolvedValue(expiredTokens) });
    const result = await restoreSession(CONFIG, storage);
    expect(result?.accessToken).toBe('fresh-at');
  });

  it('returns null when refresh fails with SESSION_EXPIRED', async () => {
    const expiredTokens = makeTokens({ expiresAt: Date.now() - 1000 });
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve(null) });
    const storage = makeStorage({ getTokens: jest.fn().mockResolvedValue(expiredTokens) });
    const result = await restoreSession(CONFIG, storage);
    expect(result).toBeNull();
  });
});

// ---------- logout ----------

describe('logout', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  it('clears local tokens regardless of end-session result', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const storage = makeStorage();
    await logout(makeTokens(), CONFIG, storage);
    expect(storage.clearTokens).toHaveBeenCalled();
  });

  it('still clears tokens when the end-session network call fails', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const storage = makeStorage();
    await logout(makeTokens(), CONFIG, storage);
    expect(storage.clearTokens).toHaveBeenCalled();
  });
});

// ---------- AuthError ----------

describe('AuthError', () => {
  it('isAuthError returns true for AuthError instances', () => {
    expect(AuthError.isAuthError(new AuthError('AUTH_FAILED'))).toBe(true);
  });

  it('isAuthError returns false for plain errors', () => {
    expect(AuthError.isAuthError(new Error('plain'))).toBe(false);
  });
});
