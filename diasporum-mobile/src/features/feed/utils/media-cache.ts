/**
 * Expiry-aware signed media URL cache.
 * downloadUrlTtl = 2 minutes — conservatively expire after 100s.
 * In-flight dedup prevents concurrent requests for the same mediaId.
 */

import type { ApiClient } from '@/core/api/api-client';

const CACHE_TTL_MS = 100_000; // 100s — safe margin below 2-min backend TTL

interface CacheEntry { url: string; expiresAt: number }

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

export function clearMediaCache() { cache.clear(); }

/** Returns a fresh signed URL, using cache when valid. */
export async function getMediaUrl(apiClient: ApiClient, mediaId: string): Promise<string> {
  const entry = cache.get(mediaId);
  if (entry && Date.now() < entry.expiresAt) return entry.url;
  // In-flight dedup — share one request for concurrent calls
  const existing = inFlight.get(mediaId);
  if (existing) return existing;
  const p = apiClient
    .post<{ downloadUrl: string }>(`/api/v1/media/${mediaId}/download-url`, {}, { authenticated: true })
    .then(r => {
      cache.set(mediaId, { url: r.downloadUrl, expiresAt: Date.now() + CACHE_TTL_MS });
      inFlight.delete(mediaId);
      return r.downloadUrl;
    })
    .catch(err => { inFlight.delete(mediaId); throw err; });
  inFlight.set(mediaId, p);
  return p;
}

/** Invalidate a URL (e.g. on 403/expired playback failure) and refetch. */
export async function refreshMediaUrl(apiClient: ApiClient, mediaId: string): Promise<string> {
  cache.delete(mediaId);
  return getMediaUrl(apiClient, mediaId);
}

/** Synchronous warm-cache read — lets renderers skip the placeholder frame. */
function peek(key: string): string | null {
  const entry = cache.get(key);
  return entry && Date.now() < entry.expiresAt ? entry.url : null;
}

export function peekMediaUrl(mediaId: string): string | null {
  return peek(mediaId);
}

// ---- feed-scoped variants (parent-authorized endpoint) ----
// Media attached to feed posts resolves through POST /feed/media/{id}/download-url,
// which re-checks the parent post's viewability (membership/blocks/moderation).

export async function getFeedMediaUrl(apiClient: ApiClient, mediaId: string): Promise<string> {
  const key = `feed:${mediaId}`;
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.url;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = apiClient
    .post<{ downloadUrl: string }>(`/api/v1/feed/media/${mediaId}/download-url`, {}, { authenticated: true })
    .then(r => {
      cache.set(key, { url: r.downloadUrl, expiresAt: Date.now() + CACHE_TTL_MS });
      inFlight.delete(key);
      return r.downloadUrl;
    })
    .catch(err => { inFlight.delete(key); throw err; });
  inFlight.set(key, p);
  return p;
}

export async function refreshFeedMediaUrl(apiClient: ApiClient, mediaId: string): Promise<string> {
  cache.delete(`feed:${mediaId}`);
  return getFeedMediaUrl(apiClient, mediaId);
}

export function peekFeedMediaUrl(mediaId: string): string | null {
  return peek(`feed:${mediaId}`);
}

// ---- avatar-scoped variants (block-checked social endpoint) ----
// Profile photos resolve through GET /social/profiles/{userId}/avatar/download-url.
// Keyed by userId, not mediaId — one avatar per user.

export async function getAvatarUrl(apiClient: ApiClient, userId: string): Promise<string> {
  const key = `avatar:${userId}`;
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.url;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = apiClient
    .get<{ downloadUrl: string }>(`/api/v1/social/profiles/${userId}/avatar/download-url`, { authenticated: true })
    .then(r => {
      cache.set(key, { url: r.downloadUrl, expiresAt: Date.now() + CACHE_TTL_MS });
      inFlight.delete(key);
      return r.downloadUrl;
    })
    .catch(err => { inFlight.delete(key); throw err; });
  inFlight.set(key, p);
  return p;
}

export async function refreshAvatarUrl(apiClient: ApiClient, userId: string): Promise<string> {
  cache.delete(`avatar:${userId}`);
  return getAvatarUrl(apiClient, userId);
}

export function peekAvatarUrl(userId: string): string | null {
  return peek(`avatar:${userId}`);
}
