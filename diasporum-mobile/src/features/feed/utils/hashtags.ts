/**
 * Hashtag validation + normalization shared by the post and reel composers.
 * Mirrors backend rules: tag_key is lowercase, no '#', letters/digits/underscore, 2–50 chars.
 */

export const MAX_TAGS = 10;

const TAG_TOKEN = /^[\p{L}\p{N}_]{2,50}$/u;

export function normalizeTag(raw: string): string | null {
  const t = raw.trim().replace(/^#+/, "").trim().toLowerCase();
  return TAG_TOKEN.test(t) ? t : null;
}
