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
