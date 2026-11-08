/**
 * Feed API service — wraps all FeedController endpoints.
 * All methods use the shared apiClient (bearer auth, host restriction, 401 retry).
 * Verified against FeedController.java.
 */

import type { ApiClient } from "@/core/api/api-client";
import { publishFeedUpdate } from "../utils/feed-updates";
import type {
  CommentPage,
  CommentRow,
  CreateHelpPostRequest,
  CreatePollRequest,
  CreatePostRequest,
  FeedPage,
  MinePage,
  Poll,
  PostRow,
  ReactionKey,
  ReportPostRequest,
  ReportResponse,
  UpdatePollRequest,
} from "../types/feed-types";

type CommentWire = Omit<CommentRow, "parentCommentId"> & {
  parentId: string | null;
};
const normalizeComment = (row: CommentWire): CommentRow => ({
  ...row,
  parentCommentId: row.parentId,
});

export function createFeedApi(client: ApiClient) {
  return {
    // ---- feeds ----
    communityFeed: (
      communityId: string,
      mode = "FOR_YOU",
      categoryId?: string,
      cursor?: string,
      size = 20,
      tag?: string,
    ) =>
      client.get<FeedPage>(
        `/api/v1/feed/community?communityId=${communityId}&mode=${mode}${categoryId ? `&categoryId=${categoryId}` : ""}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}&size=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { authenticated: true },
      ),

    /** Country practical categories — GET /categories?module=FEED (or COMMUNITY_HELP). */
    feedCategories: (countryId: string, module = "FEED") =>
      client.get<{ items: import("../types/feed-types").CategoryView[] }>(
        `/api/v1/taxonomy/categories?module=${module}&countryId=${countryId}`,
        { authenticated: true },
      ),

    // ---- hashtags ----
    /** Composer autocomplete — prefix matches ordered by usage. */
    suggestTags: (q: string, size = 10) =>
      client.get<import("../types/feed-types").TagView[]>(
        `/api/v1/feed/tags/suggest?q=${encodeURIComponent(q)}&size=${size}`,
        { authenticated: true },
      ),

    /** Community-scoped hashtag feed — GET /feed/tags/{key}/posts. */
    tagFeed: (
      tagKey: string,
      communityId: string,
      cursor?: string,
      size = 20,
    ) =>
      client.get<FeedPage>(
        `/api/v1/feed/tags/${encodeURIComponent(tagKey)}/posts?communityId=${communityId}&size=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { authenticated: true },
      ),

    /** Parent-authorized short-lived URL for media attached to a feed post. */
    feedMediaDownloadUrl: (mediaId: string) =>
      client.post<{ downloadUrl: string }>(
        `/api/v1/feed/media/${mediaId}/download-url`,
        {},
        { authenticated: true },
      ),

    /** Community detail (name + destinationCountryId) */
    communityDetail: (communityId: string) =>
      client.get<import("../types/feed-types").CommunityDetail>(
        `/api/v1/taxonomy/communities/${communityId}`,
        { authenticated: true },
      ),

    /** Country detail (name for grouping) */
    countryDetail: (countryId: string) =>
      client.get<{ id: string; name: string }>(
        `/api/v1/taxonomy/countries/${countryId}`,
        { authenticated: true },
      ),

    /** Communities the user can join (origin/destination match) */
    availableCommunities: () =>
      client.get<{ items: import("../types/feed-types").CommunityDetail[] }>(
        "/api/v1/me/communities/available",
        { authenticated: true },
      ),

    /** Member count via the members listing total. */
    memberCount: (communityId: string) =>
      client.get<{ total: number }>(
        `/api/v1/communities/${communityId}/members?page=0&size=1`,
        { authenticated: true },
      ),

    followingFeed: (cursor?: string, size = 20) =>
      client.get<FeedPage>(
        `/api/v1/feed/following?size=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { authenticated: true },
      ),

    /** Own posts across communities — profile Posts/Polls/Media tabs. */
    mine: (
      filters: { postType?: string; hasMedia?: boolean } = {},
      cursor?: string,
      size = 20,
    ) =>
      client.get<MinePage>(
        `/api/v1/feed/mine?size=${size}${filters.postType ? `&postType=${filters.postType}` : ""}${filters.hasMedia ? "&hasMedia=true" : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { authenticated: true },
      ),

    // ---- posts ----
    createPost: (req: CreatePostRequest) =>
      client.post<PostRow>("/api/v1/feed/posts", req, { authenticated: true }),

    getPost: (postId: string) =>
      client.get<import("../types/feed-types").PostDetail>(
        `/api/v1/feed/posts/${postId}`,
        { authenticated: true },
      ),

    updatePost: (
      postId: string,
      data: {
        title?: string;
        body?: string;
        linkUrl?: string;
        categoryId?: string;
        tags?: string[];
      },
    ) =>
      client.patch<PostRow>(`/api/v1/feed/posts/${postId}`, data, {
        authenticated: true,
      }),

    deletePost: (postId: string) =>
      client.delete(`/api/v1/feed/posts/${postId}`, { authenticated: true }),

    // ---- engagement ----
    react: (postId: string, reaction: ReactionKey) =>
      client
        .put(
          `/api/v1/feed/posts/${postId}/reaction`,
          { reaction },
          { authenticated: true },
        )
        .then((result) => {
          publishFeedUpdate(client, postId, (item) => ({
            ...item,
            viewerReaction: reaction,
            reactionCount: item.reactionCount + (item.viewerReaction ? 0 : 1),
          }));
          return result;
        }),

    unreact: (postId: string) =>
      client
        .delete(`/api/v1/feed/posts/${postId}/reaction`, {
          authenticated: true,
        })
        .then((result) => {
          publishFeedUpdate(client, postId, (item) => ({
            ...item,
            viewerReaction: null,
            reactionCount: Math.max(
              0,
              item.reactionCount - (item.viewerReaction ? 1 : 0),
            ),
          }));
          return result;
        }),

    save: (postId: string) =>
      client
        .put(`/api/v1/feed/posts/${postId}/save`, {}, { authenticated: true })
        .then((result) => {
          publishFeedUpdate(client, postId, (item) => ({
            ...item,
            saved: true,
          }));
          return result;
        }),

    unsave: (postId: string) =>
      client
        .delete(`/api/v1/feed/posts/${postId}/save`, { authenticated: true })
        .then((result) => {
          publishFeedUpdate(client, postId, (item) => ({
            ...item,
            saved: false,
          }));
          return result;
        }),

    /** Record a share event; returns the updated share_count. */
    sharePost: (
      postId: string,
      target: "COPY_LINK" | "IN_APP" | "SYSTEM_SHARE" = "SYSTEM_SHARE",
    ) =>
      client
        .post<{
          shareCount: number;
        }>(`/api/v1/feed/posts/${postId}/share`, { target }, { authenticated: true })
        .then((result) => {
          publishFeedUpdate(client, postId, (item) => ({
            ...item,
            shareCount: result.shareCount,
          }));
          return result;
        }),

    recordView: (contentType: string, contentId: string) =>
      client
        .post(
          "/api/v1/feed/views",
          { contentType, contentId },
          { authenticated: true },
        )
        .catch(() => {}), // silent — view tracking must not block

    // ---- comments ----
    comment: (postId: string, body: string, parentCommentId?: string) =>
      client
        .post<CommentWire>(
          `/api/v1/feed/posts/${postId}/comments`,
          {
            body,
            ...(parentCommentId ? { parentCommentId } : {}),
          },
          { authenticated: true },
        )
        .then(normalizeComment),

    comments: (postId: string, page = 0, size = 20) =>
      client
        .get<{
          items: CommentWire[];
          nextCursor: string | null;
        }>(`/api/v1/feed/posts/${postId}/comments?page=${page}&size=${size}`, { authenticated: true })
        .then(
          (result): CommentPage => ({
            ...result,
            items: result.items.map(normalizeComment),
          }),
        ),

    updateComment: (commentId: string, body: string) =>
      client
        .patch<CommentWire>(
          `/api/v1/feed/comments/${commentId}`,
          { body },
          { authenticated: true },
        )
        .then(normalizeComment),

    deleteComment: (commentId: string) =>
      client.delete(`/api/v1/feed/comments/${commentId}`, {
        authenticated: true,
      }),

    // ---- community help ----
    createHelpPost: (req: CreateHelpPostRequest) =>
      client.post("/api/v1/feed/community-help", req, { authenticated: true }),

    setHelpStatus: (postId: string, helpStatus: string) =>
      client.patch(
        `/api/v1/feed/community-help/${postId}/status`,
        { helpStatus },
        { authenticated: true },
      ),

    // ---- author resolution ----
    /** Batch profile summaries — one call per page, not per post. */
    authorSummaries: (ids: string[]) =>
      client.get<import("../types/feed-types").ProfileSummary[]>(
        `/api/v1/feed/authors?ids=${ids.join(",")}`,
        { authenticated: true },
      ),

    // ---- polls ----
    createPoll: (req: CreatePollRequest) =>
      client.post<Poll>("/api/v1/feed/polls", req, { authenticated: true }),

    getPoll: (postId: string) =>
      client.get<Poll>(`/api/v1/feed/polls/${postId}`, { authenticated: true }),

    updatePoll: (postId: string, req: UpdatePollRequest) =>
      client.patch<Poll>(`/api/v1/feed/polls/${postId}`, req, {
        authenticated: true,
      }),

    vote: (optionId: string, withdraw = false) =>
      client.post<Poll>(
        `/api/v1/feed/polls/options/${optionId}/vote`,
        { withdraw },
        { authenticated: true },
      ),

    closePoll: (postId: string) =>
      client.post<Poll>(
        `/api/v1/feed/polls/${postId}/close`,
        {},
        { authenticated: true },
      ),

    reportPost: (postId: string, req: ReportPostRequest) =>
      client.post<ReportResponse>(`/api/v1/feed/posts/${postId}/reports`, req, {
        authenticated: true,
      }),
  };
}
