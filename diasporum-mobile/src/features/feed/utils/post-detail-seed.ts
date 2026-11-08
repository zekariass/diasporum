/**
 * Post detail seed — hands the already-rendered feed snapshot to the Post
 * Detail screen so it can paint instantly, then refresh in place from
 * GET /feed/posts/{id}. One-shot: consume removes the entry on read.
 * Also dedupes rapid taps so the same detail screen can't be pushed twice.
 */

import type { useRouter } from "expo-router";
import type {
  FeedItem,
  MediaAttachment,
  Poll,
  PostRow,
  ProfileSummary,
  ReactionKey,
} from "../types/feed-types";

export interface PostDetailSeed {
  post: PostRow;
  tags: string[];
  media: MediaAttachment[];
  poll: Poll | null;
  viewerReaction: ReactionKey | null;
  saved: boolean;
  author: ProfileSummary | null;
}

const seeds = new Map<string, PostDetailSeed>();
const MAX_SEEDS = 20;
const NAV_DEDUPE_MS = 800;
let lastNav: { id: string; at: number } | null = null;

/** PostRow-shaped snapshot — fields not shown on the detail screen are placeholders. */
function toPostRow(item: FeedItem): PostRow {
  return {
    id: item.sourceId,
    authorId: item.author?.id ?? "",
    communityId: item.communityId,
    countryId: "",
    postType: item.contentType,
    status: "PUBLISHED",
    scope: "",
    title: item.title,
    body: item.body,
    linkUrl: null,
    categoryId: item.payload.categoryId ?? null,
    commentsEnabled: true,
    commentCount: item.commentCount,
    reactionCount: item.reactionCount,
    shareCount: item.shareCount,
    publishedAt: item.publishedAt,
    createdAt: item.publishedAt,
  };
}

function seedMedia(item: FeedItem): MediaAttachment[] {
  if (item.media.length > 0) return item.media;
  return item.mediaIds.map((id) => ({
    id,
    purpose: "FEED_IMAGE",
    mimeType: null,
    durationMs: null,
    sizeBytes: null,
  }));
}

export function seedPostDetail(item: FeedItem): void {
  if (seeds.size >= MAX_SEEDS) {
    const oldest = seeds.keys().next().value;
    if (oldest !== undefined) seeds.delete(oldest);
  }
  seeds.set(item.sourceId, {
    post: toPostRow(item),
    tags: item.tags,
    media: seedMedia(item),
    poll: item.payload.poll ?? null,
    viewerReaction: item.viewerReaction,
    saved: item.saved,
    author: item.author,
  });
}

/** One-shot read — null for deep links / unseeded opens. */
export function consumePostDetailSeed(postId: string): PostDetailSeed | null {
  const seed = seeds.get(postId) ?? null;
  if (seed) seeds.delete(postId);
  return seed;
}

type Router = ReturnType<typeof useRouter>;

/** Seed + dedupe + push — the single entry point for opening a post. */
export function openPostDetail(router: Router, item: FeedItem): void {
  const now = Date.now();
  if (lastNav && lastNav.id === item.sourceId && now - lastNav.at < NAV_DEDUPE_MS) {
    return;
  }
  lastNav = { id: item.sourceId, at: now };
  seedPostDetail(item);
  router.push({
    pathname: "/(app)/posts/[id]",
    params: { id: item.sourceId },
  });
}
