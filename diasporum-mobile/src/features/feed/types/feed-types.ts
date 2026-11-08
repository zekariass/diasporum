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
  itemId: string; // "FEED_POST:<uuid>"
  contentType: PostType; // GENERAL | ANNOUNCEMENT | POLL | REEL | COMMUNITY_HELP
  sourceModule: string; // "feed"
  sourceId: string; // post UUID
  author: ProfileSummary | null; // resolved server-side via profileSummaries
  communityId: string;
  publishedAt: string; // ISO 8601
  title: string | null;
  body: string | null;
  mediaIds: string[];
  media: MediaAttachment[]; // FeedService.MediaAttachment — kind-aware
  tags: string[]; // hashtag display names, post order
  commentCount: number;
  reactionCount: number;
  shareCount: number;
  viewerReaction: ReactionKey | null;
  viewed: boolean;
  saved: boolean;
  payload: FeedPayload;
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

/** GET /api/v1/feed/mine — own posts plus a total count for profile stats. */
export interface MinePage {
  items: FeedItem[];
  nextCursor: string | null;
  total: number;
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

/** FeedService.MediaAttachment — attachment metadata for kind-aware render. */
export interface MediaAttachment {
  id: string;
  purpose: string; // FEED_IMAGE | FEED_VIDEO | FEED_AUDIO | DOCUMENT
  mimeType: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
}

/** FeedService.TagView — suggestion row. */
export interface TagView {
  tagKey: string;
  displayName: string;
  postCount: number;
}

/** FeedService.PostDetail — GET /feed/posts/{id}. */
export interface PostDetail {
  post: PostRow;
  tags: string[];
  media: MediaAttachment[];
  viewerReaction: ReactionKey | null;
  saved: boolean;
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
  categoryId: string | null;
  commentsEnabled: boolean;
  commentCount: number;
  reactionCount: number;
  shareCount: number;
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

export type PostType =
  | "GENERAL"
  | "ANNOUNCEMENT"
  | "POLL"
  | "REEL"
  | "COMMUNITY_HELP";
export type ReactionKey = "LIKE" | "LOVE" | "HELPFUL" | "INSIGHTFUL" | "THANKS";
export type FeedMode = "FOR_YOU" | "LATEST";
/** Reels screen mode — distinct from the timeline FOR_YOU/LATEST modes. */
export type ReelsMode = "community" | "following";
export type HelpKind = "REQUEST" | "OFFER";
export type HelpStatus = "OPEN" | "PAUSED" | "RESOLVED" | "CLOSED" | "EXPIRED";

export interface CreatePostRequest {
  communityId: string;
  postType: PostType;
  title?: string;
  body?: string;
  linkUrl?: string;
  visibilityScope?: string;
  categoryId?: string;
  mediaIds?: string[];
  tags?: string[];
  idempotencyKey?: string;
}

export interface CreateHelpPostRequest {
  communityId: string;
  categoryId?: string;
  helpKind: HelpKind;
  title?: string;
  body?: string;
  expiresAt?: string;
  mediaIds?: string[];
  tags?: string[];
  idempotencyKey?: string;
}

export type PollStatus = "ACTIVE" | "EXPIRED" | "CLOSED";
export type PollResultsVisibility =
  | "IMMEDIATE"
  | "AFTER_VOTING"
  | "AFTER_CLOSE";
export type ReportReason =
  | "SPAM"
  | "SCAM"
  | "HARASSMENT"
  | "HATE"
  | "SEXUAL_MISCONDUCT"
  | "MISINFORMATION"
  | "IMPERSONATION"
  | "PRIVACY"
  | "OTHER";

export interface PollOption {
  id: string;
  text: string;
  sortOrder: number;
  voteCount: number | null;
  percentage: number | null;
}

export interface Poll {
  postId: string;
  question: string;
  status: PollStatus;
  closesAt: string | null;
  closedAt: string | null;
  allowMultiple: boolean;
  allowVoteChange: boolean;
  allowVoteWithdraw: boolean;
  anonymousVoting: boolean;
  maxOptions: number;
  resultsVisibility: PollResultsVisibility;
  resultsVisible: boolean;
  totalVoters: number | null;
  totalVotes: number | null;
  myVotes: string[];
  options: PollOption[];
}

export interface FeedPayload extends Record<string, unknown> {
  categoryId?: string;
  categoryName?: string;
  helpKind?: HelpKind;
  helpStatus?: HelpStatus;
  poll?: Poll;
}

export interface CreatePollRequest {
  communityId: string;
  categoryId: string;
  question: string;
  options: string[];
  maxOptions?: number;
  closesAt?: string;
  allowMultiple?: boolean;
  allowVoteChange?: boolean;
  allowVoteWithdraw?: boolean;
  anonymousVoting?: boolean;
  resultsVisibility?: PollResultsVisibility;
}

export interface UpdatePollRequest {
  question?: string;
  options?: string[];
  maxOptions?: number;
  closesAt?: string;
  allowMultiple?: boolean;
  allowVoteChange?: boolean;
  allowVoteWithdraw?: boolean;
  anonymousVoting?: boolean;
  resultsVisibility?: PollResultsVisibility;
}

export interface ReportPostRequest {
  reason: ReportReason;
  details?: string;
}

export interface ReportResponse {
  reportId: string;
}
