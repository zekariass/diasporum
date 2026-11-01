/**
 * Secure token storage abstraction backed by expo-secure-store.
 *
 * Tokens are NEVER stored in AsyncStorage or plain files.
 * Access token, refresh token and metadata are stored under separate keys
 * to stay well within the ~2 KB per-value limit on older iOS releases.
 */

import * as SecureStore from 'expo-secure-store';

import type { AuthTokens } from './auth-types';
import { AuthError } from './auth-errors';

const KEY_ACCESS_TOKEN = 'dsp_at';
const KEY_REFRESH_TOKEN = 'dsp_rt';
const KEY_TOKEN_META = 'dsp_meta'; // expiresAt + tokenType + scope

interface StoredMeta {
  expiresAt: number;
  tokenType: string;
  scope?: string;
}

export interface AuthStorage {
  getTokens(): Promise<AuthTokens | null>;
  saveTokens(tokens: AuthTokens): Promise<void>;
  clearTokens(): Promise<void>;
}

/**
 * Reads all three token fragments. Returns null if any are missing,
 * which covers first-install and post-logout states safely.
 */
async function getTokens(): Promise<AuthTokens | null> {
  try {
    const [at, rt, metaJson] = await Promise.all([
      SecureStore.getItemAsync(KEY_ACCESS_TOKEN),
      SecureStore.getItemAsync(KEY_REFRESH_TOKEN),
      SecureStore.getItemAsync(KEY_TOKEN_META),
    ]);

    if (!at || !rt || !metaJson) return null;

    let meta: StoredMeta;
    try {
      meta = JSON.parse(metaJson) as StoredMeta;
    } catch {
      // Corrupt metadata — treat as no session
      return null;
    }

    return {
      accessToken: at,
      refreshToken: rt,
      expiresAt: meta.expiresAt,
      tokenType: meta.tokenType,
      scope: meta.scope,
    };
  } catch (err) {
    throw new AuthError(
      'STORAGE_ERROR',
      `Failed to read tokens from secure storage: ${String(err)}`
    );
  }
}

/**
 * Persists all token fragments to SecureStore.
 * Access token and refresh token are stored separately to avoid size limits.
 */
async function saveTokens(tokens: AuthTokens): Promise<void> {
  const meta: StoredMeta = {
    expiresAt: tokens.expiresAt,
    tokenType: tokens.tokenType,
    scope: tokens.scope,
  };

  try {
    await Promise.all([
      SecureStore.setItemAsync(KEY_ACCESS_TOKEN, tokens.accessToken),
      SecureStore.setItemAsync(KEY_REFRESH_TOKEN, tokens.refreshToken),
      SecureStore.setItemAsync(KEY_TOKEN_META, JSON.stringify(meta)),
    ]);
  } catch (err) {
    throw new AuthError(
      'STORAGE_ERROR',
      `Failed to save tokens to secure storage: ${String(err)}`
    );
  }
}

/**
 * Removes all stored token fragments. Called on logout and on session expiry.
 * Failures are swallowed — clearing is best-effort; the session is considered
 * invalid regardless.
 */
async function clearTokens(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(KEY_ACCESS_TOKEN),
    SecureStore.deleteItemAsync(KEY_REFRESH_TOKEN),
    SecureStore.deleteItemAsync(KEY_TOKEN_META),
  ]);
}

export const authStorage: AuthStorage = {
  getTokens,
  saveTokens,
  clearTokens,
};
