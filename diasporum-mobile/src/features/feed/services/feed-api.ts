/**
 * Feed API service — wraps all FeedController endpoints.
 * All methods use the shared apiClient (bearer auth, host restriction, 401 retry).
 * Verified against FeedController.java.
 */

import type { ApiClient } from '@/core/api/api-client';
import type {
  CommentPage, CommentRow, CreateHelpPostRequest, CreatePollRequest,
  CreatePostRequest, FeedPage, PostRow, ReactionKey,
} from '../types/feed-types';

export function createFeedApi(client: ApiClient) {
  return {
    // ---- feeds ----
    communityFeed: (communityId: string, mode = 'FOR_YOU', categoryId?: string, cursor?: string, size = 20) =>
      client.get<FeedPage>(
        `/api/v1/feed/community?communityId=${communityId}&mode=${mode}${categoryId ? `&categoryId=${categoryId}` : ''}&size=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { authenticated: true }
      ),

    /** Country practical categories for FEED — GET /categories?module=FEED */
    feedCategories: (countryId: string) =>
      client.get<{ items: import('../types/feed-types').CategoryView[] }>(
        `/api/v1/taxonomy/categories?module=FEED&countryId=${countryId}`,
        { authenticated: true }
      ),

    /** Community detail (name + destinationCountryId) */
    communityDetail: (communityId: string) =>
      client.get<import('../types/feed-types').CommunityDetail>(
        `/api/v1/taxonomy/communities/${communityId}`,
        { authenticated: true }
      ),

    /** Country detail (name for grouping) */
    countryDetail: (countryId: string) =>
      client.get<{ id: string; name: string }>(
        `/api/v1/taxonomy/countries/${countryId}`,
        { authenticated: true }
      ),

    /** Communities the user can join (origin/destination match) */
    availableCommunities: () =>
      client.get<{ items: import('../types/feed-types').CommunityDetail[] }>(
        '/api/v1/me/communities/available',
        { authenticated: true }
      ),

    /** Member count via the members listing total. */
    memberCount: (communityId: string) =>
      client.get<{ total: number }>(
        `/api/v1/communities/${communityId}/members?page=0&size=1`,
        { authenticated: true }
      ),

    followingFeed: (cursor?: string, size = 20) =>
      client.get<FeedPage>(
        `/api/v1/feed/following?size=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { authenticated: true }
      ),

    // ---- posts ----
    createPost: (req: CreatePostRequest) =>
      client.post<PostRow>('/api/v1/feed/posts', req, { authenticated: true }),

    getPost: (postId: string) =>
      client.get<PostRow>(`/api/v1/feed/posts/${postId}`, { authenticated: true }),

    updatePost: (postId: string, data: { title?: string; body?: string; linkUrl?: string }) =>
      client.patch<PostRow>(`/api/v1/feed/posts/${postId}`, data, { authenticated: true }),

    deletePost: (postId: string) =>
      client.delete(`/api/v1/feed/posts/${postId}`, { authenticated: true }),

    // ---- engagement ----
    react: (postId: string, reaction: ReactionKey) =>
      client.put(`/api/v1/feed/posts/${postId}/reaction`, { reaction }, { authenticated: true }),

    unreact: (postId: string) =>
      client.delete(`/api/v1/feed/posts/${postId}/reaction`, { authenticated: true }),

    save: (postId: string) =>
      client.put(`/api/v1/feed/posts/${postId}/save`, {}, { authenticated: true }),

    unsave: (postId: string) =>
      client.delete(`/api/v1/feed/posts/${postId}/save`, { authenticated: true }),

    recordView: (contentType: string, contentId: string) =>
      client.post('/api/v1/feed/views', { contentType, contentId }, { authenticated: true })
        .catch(() => {}), // silent — view tracking must not block

    // ---- comments ----
    comment: (postId: string, body: string, parentCommentId?: string) =>
      client.post<CommentRow>(`/api/v1/feed/posts/${postId}/comments`, {
        body, ...(parentCommentId ? { parentCommentId } : {}),
      }, { authenticated: true }),

    comments: (postId: string, page = 0, size = 20) =>
      client.get<CommentPage>(`/api/v1/feed/posts/${postId}/comments?page=${page}&size=${size}`, { authenticated: true }),

    updateComment: (commentId: string, body: string) =>
      client.patch<CommentRow>(`/api/v1/feed/comments/${commentId}`, { body }, { authenticated: true }),

    deleteComment: (commentId: string) =>
      client.delete(`/api/v1/feed/comments/${commentId}`, { authenticated: true }),

    // ---- community help ----
    createHelpPost: (req: CreateHelpPostRequest) =>
      client.post('/api/v1/feed/community-help', req, { authenticated: true }),

    setHelpStatus: (postId: string, helpStatus: string) =>
      client.patch(`/api/v1/feed/community-help/${postId}/status`, { helpStatus }, { authenticated: true }),

    // ---- author resolution ----
    /** Batch profile summaries — one call per page, not per post. */
    authorSummaries: (ids: string[]) =>
      client.get<import('../types/feed-types').ProfileSummary[]>(
        `/api/v1/feed/authors?ids=${ids.join(',')}`,
        { authenticated: true }
      ),

    // ---- polls ----
    createPoll: (req: CreatePollRequest) =>
      client.post('/api/v1/feed/polls', req, { authenticated: true }),

    getPoll: (postId: string) =>
      client.get<Record<string, unknown>>(`/api/v1/feed/polls/${postId}`, { authenticated: true }),

    vote: (optionId: string, withdraw = false) =>
      client.post(`/api/v1/feed/polls/options/${optionId}/vote`, { withdraw }, { authenticated: true }),
  };
}
