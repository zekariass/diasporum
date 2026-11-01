/**
 * Feed API types — mirror FeedService records exactly.
 * Verified against FeedController.java and FeedService.java.
 */

// ---- ProfileSummary (IdentityApi.ProfileSummary — serialized in FeedItem.author) ----
export interface ProfileSummary {
  id: string;
  username: string;
  displayName: string;
  accountStatus: string;
  profileCompleted: boolean;
  avatarMediaId: string | null;
}

// ---- FeedItem (FeedService.FeedItem — JSON field order follows record order) ----
export interface FeedItem {
  itemId: string;              // "FEED_POST:<uuid>"
  contentType: PostType;       // GENERAL | ANNOUNCEMENT | POLL | REEL | COMMUNITY_HELP
  sourceModule: string;        // "feed"
  sourceId: string;            // post UUID
  author: ProfileSummary | null; // resolved server-side via profileSummaries
  communityId: string;
  publishedAt: string;         // ISO 8601
  title: string | null;
  body: string | null;
  mediaIds: string[];
  commentCount: number;
  reactionCount: number;
  viewerReaction: ReactionKey | null;
  viewed: boolean;
  saved: boolean;
  payload: Record<string, unknown>;
}

// ---- CommunitySummary (TaxonomyApi.CommunityView — serialized by /me/communities/*) ----
export interface CommunitySummary {
  id: string;
  name: string;
  slug: string;
  originCountryId: string;
  destinationCountryId: string;
  description: string | null;
  active: boolean;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

/** TaxonomyApi.CategoryView — country practical category for a module. */
export interface CategoryView {
  id: string;
  countryId: string;
  name: string;
  slug: string;
  active: boolean;
}

/** CommunityView from /api/v1/taxonomy/communities/{id} */
export interface CommunityDetail {
  id: string;
  name: string;
  slug: string;
  originCountryId: string;
  destinationCountryId: string | null;
  description: string | null;
  active: boolean;
}

export interface PostRow {
  id: string;
  authorId: string;
  communityId: string;
  countryId: string;
  postType: PostType;
  status: string;
  scope: string;
  title: string | null;
  body: string | null;
  linkUrl: string | null;
  commentsEnabled: boolean;
  commentCount: number;
  reactionCount: number;
  publishedAt: string;
  createdAt: string;
}

export interface CommentRow {
  id: string;
  postId: string;
  authorId: string;
  parentCommentId: string | null;
  body: string;
  createdAt: string;
}

export interface CommentPage {
  items: CommentRow[];
  nextCursor: string | null;
}

export type PostType = 'GENERAL' | 'ANNOUNCEMENT' | 'POLL' | 'REEL' | 'COMMUNITY_HELP';
export type ReactionKey = 'LIKE' | 'LOVE' | 'HELPFUL' | 'INSIGHTFUL' | 'THANKS';
export type FeedMode = 'FOR_YOU' | 'LATEST';
/** Reels screen mode — distinct from the timeline FOR_YOU/LATEST modes. */
export type ReelsMode = 'community' | 'following';
export type HelpKind = 'REQUEST' | 'OFFER';
export type HelpStatus = 'OPEN' | 'PAUSED' | 'RESOLVED' | 'CLOSED' | 'EXPIRED';

export interface CreatePostRequest {
  communityId: string;
  postType: PostType;
  title?: string;
  body?: string;
  linkUrl?: string;
  visibilityScope?: string;
  categoryId?: string;
  mediaIds?: string[];
}

export interface CreateHelpPostRequest {
  communityId: string;
  categoryId?: string;
  helpKind: HelpKind;
  title?: string;
  body?: string;
  expiresAt?: string;
}

export interface CreatePollRequest {
  communityId: string;
  categoryId?: string;
  question: string;
  options: string[];
  closesAt?: string;
}
