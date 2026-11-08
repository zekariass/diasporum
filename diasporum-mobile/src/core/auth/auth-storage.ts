/**
 * Token storage abstraction backed by expo-secure-store on native platforms.
 * Expo web uses tab-scoped sessionStorage because SecureStore has no web
 * implementation; localStorage and AsyncStorage are never used.
 *
 * Access token, refresh token and metadata are stored under separate keys
 * to stay well within the ~2 KB per-value limit on older iOS releases.
 */

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { AuthTokens } from "./auth-types";
import { AuthError } from "./auth-errors";

const KEY_ACCESS_TOKEN = "dsp_at";
const KEY_REFRESH_TOKEN = "dsp_rt";
const KEY_TOKEN_META = "dsp_meta"; // expiresAt + tokenType + scope

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

function browserStorage(): Storage {
  const storage = globalThis.sessionStorage;
  if (!storage) throw new Error("Browser session storage is unavailable");
  return storage;
}

async function readFragment(key: string): Promise<string | null> {
  return Platform.OS === "web"
    ? browserStorage().getItem(key)
    : SecureStore.getItemAsync(key);
}

async function writeFragment(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    browserStorage().setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteFragment(key: string): Promise<void> {
  if (Platform.OS === "web") {
    browserStorage().removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/**
 * Reads all three token fragments. Returns null if any are missing,
 * which covers first-install and post-logout states safely.
 */
async function getTokens(): Promise<AuthTokens | null> {
  try {
    const [at, rt, metaJson] = await Promise.all([
      readFragment(KEY_ACCESS_TOKEN),
      readFragment(KEY_REFRESH_TOKEN),
      readFragment(KEY_TOKEN_META),
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
      "STORAGE_ERROR",
      `Failed to read tokens from secure storage: ${String(err)}`,
    );
  }
}

/**
 * Persists all token fragments to the current platform's storage.
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
      writeFragment(KEY_ACCESS_TOKEN, tokens.accessToken),
      writeFragment(KEY_REFRESH_TOKEN, tokens.refreshToken),
      writeFragment(KEY_TOKEN_META, JSON.stringify(meta)),
    ]);
  } catch (err) {
    throw new AuthError(
      "STORAGE_ERROR",
      `Failed to save tokens to secure storage: ${String(err)}`,
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
    deleteFragment(KEY_ACCESS_TOKEN),
    deleteFragment(KEY_REFRESH_TOKEN),
    deleteFragment(KEY_TOKEN_META),
  ]);
}

export const authStorage: AuthStorage = {
  getTokens,
  saveTokens,
  clearTokens,
};
