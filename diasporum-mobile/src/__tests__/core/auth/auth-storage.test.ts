/**
 * Tests for the secure token storage abstraction.
 */

import { authStorage } from '@/core/auth/auth-storage';
import type { AuthTokens } from '@/core/auth/auth-types';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store');

const mockSetItem = SecureStore.setItemAsync as jest.MockedFunction<typeof SecureStore.setItemAsync>;
const mockGetItem = SecureStore.getItemAsync as jest.MockedFunction<typeof SecureStore.getItemAsync>;
const mockDeleteItem = SecureStore.deleteItemAsync as jest.MockedFunction<typeof SecureStore.deleteItemAsync>;

const SAMPLE_TOKENS: AuthTokens = {
  accessToken: 'eyJhbGciOiJSUzI1NiJ9.access',
  refreshToken: 'eyJhbGciOiJSUzI1NiJ9.refresh',
  expiresAt: Date.now() + 300_000,
  tokenType: 'Bearer',
  scope: 'openid profile email',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authStorage.saveTokens', () => {
  it('writes access token, refresh token and metadata to SecureStore', async () => {
    mockSetItem.mockResolvedValue(undefined);
    await authStorage.saveTokens(SAMPLE_TOKENS);
    expect(mockSetItem).toHaveBeenCalledWith('dsp_at', SAMPLE_TOKENS.accessToken);
    expect(mockSetItem).toHaveBeenCalledWith('dsp_rt', SAMPLE_TOKENS.refreshToken);
    expect(mockSetItem).toHaveBeenCalledWith(
      'dsp_meta',
      expect.stringContaining('"expiresAt"')
    );
  });

  it('throws AuthError with STORAGE_ERROR when SecureStore fails', async () => {
    mockSetItem.mockRejectedValue(new Error('disk full'));
    await expect(authStorage.saveTokens(SAMPLE_TOKENS)).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
  });
});

describe('authStorage.getTokens', () => {
  it('returns null when access token is missing', async () => {
    mockGetItem.mockResolvedValue(null);
    const result = await authStorage.getTokens();
    expect(result).toBeNull();
  });

  it('returns null when refresh token is missing', async () => {
    mockGetItem
      .mockResolvedValueOnce(SAMPLE_TOKENS.accessToken) // dsp_at
      .mockResolvedValueOnce(null) // dsp_rt
      .mockResolvedValueOnce('{}'); // dsp_meta
    const result = await authStorage.getTokens();
    expect(result).toBeNull();
  });

  it('returns null when metadata is corrupt JSON', async () => {
    mockGetItem
      .mockResolvedValueOnce(SAMPLE_TOKENS.accessToken)
      .mockResolvedValueOnce(SAMPLE_TOKENS.refreshToken)
      .mockResolvedValueOnce('not-json');
    const result = await authStorage.getTokens();
    expect(result).toBeNull();
  });

  it('returns tokens when all fragments are present', async () => {
    const meta = JSON.stringify({
      expiresAt: SAMPLE_TOKENS.expiresAt,
      tokenType: SAMPLE_TOKENS.tokenType,
      scope: SAMPLE_TOKENS.scope,
    });
    mockGetItem
      .mockResolvedValueOnce(SAMPLE_TOKENS.accessToken)
      .mockResolvedValueOnce(SAMPLE_TOKENS.refreshToken)
      .mockResolvedValueOnce(meta);
    const result = await authStorage.getTokens();
    expect(result).toEqual(SAMPLE_TOKENS);
  });

  it('throws AuthError with STORAGE_ERROR when SecureStore throws', async () => {
    mockGetItem.mockRejectedValue(new Error('keychain unavailable'));
    await expect(authStorage.getTokens()).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
  });
});

describe('authStorage.clearTokens', () => {
  it('deletes all three keys', async () => {
    mockDeleteItem.mockResolvedValue(undefined);
    await authStorage.clearTokens();
    expect(mockDeleteItem).toHaveBeenCalledWith('dsp_at');
    expect(mockDeleteItem).toHaveBeenCalledWith('dsp_rt');
    expect(mockDeleteItem).toHaveBeenCalledWith('dsp_meta');
  });

  it('does not throw even when deletion fails', async () => {
    mockDeleteItem.mockRejectedValue(new Error('item not found'));
    await expect(authStorage.clearTokens()).resolves.not.toThrow();
  });
});
