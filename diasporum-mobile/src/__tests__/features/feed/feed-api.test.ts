/**
 * Feed API service tests — verifies correct endpoints, methods and payloads.
 * Uses a mock apiClient — no network.
 */

import { createFeedApi } from "@/features/feed/services/feed-api";
import { subscribeFeedUpdates } from "@/features/feed/utils/feed-updates";
import type { FeedItem } from "@/features/feed/types/feed-types";

jest.mock("@/core/config/env", () => ({
  appConfig: { apiBaseUrl: "http://localhost:8080" },
  getTokenEndpoint: jest.fn(),
  getEndSessionEndpoint: jest.fn(),
  getKeycloakIssuer: jest.fn(),
}));

const client = {
  get: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({})),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
};

beforeEach(() => jest.clearAllMocks());

const api = createFeedApi(client as never);

describe("feedApi", () => {
  it("communityFeed hits correct endpoint", async () => {
    await api.communityFeed("c1", "FOR_YOU", undefined, undefined, 20);
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining(
        "/feed/community?communityId=c1&mode=FOR_YOU&size=20",
      ),
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("communityFeed passes cursor when provided", async () => {
    await api.communityFeed("c1", "FOR_YOU", undefined, "abc123", 20);
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining("&cursor=abc123"),
      expect.anything(),
    );
  });

  it("followingFeed hits correct endpoint", async () => {
    await api.followingFeed("cur1", 20);
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining("/feed/following?size=20&cursor=cur1"),
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("createPost posts correct payload", async () => {
    await api.createPost({
      communityId: "c1",
      postType: "GENERAL",
      body: "hello",
    });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/posts",
      { communityId: "c1", postType: "GENERAL", body: "hello" },
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("getPost hits correct path", async () => {
    await api.getPost("p1");
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/feed/posts/p1",
      expect.anything(),
    );
  });

  it("react puts reaction", async () => {
    await api.react("p1", "LIKE");
    expect(client.put).toHaveBeenCalledWith(
      "/api/v1/feed/posts/p1/reaction",
      { reaction: "LIKE" },
      expect.anything(),
    );
  });

  it("unreact deletes reaction", async () => {
    await api.unreact("p1");
    expect(client.delete).toHaveBeenCalledWith(
      "/api/v1/feed/posts/p1/reaction",
      expect.anything(),
    );
  });

  it("save puts save", async () => {
    await api.save("p1");
    expect(client.put).toHaveBeenCalledWith(
      "/api/v1/feed/posts/p1/save",
      {},
      expect.anything(),
    );
  });

  it("unsave deletes save", async () => {
    await api.unsave("p1");
    expect(client.delete).toHaveBeenCalledWith(
      "/api/v1/feed/posts/p1/save",
      expect.anything(),
    );
  });

  it("recordView posts view", async () => {
    await api.recordView("FEED_POST", "p1");
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/views",
      { contentType: "FEED_POST", contentId: "p1" },
      expect.anything(),
    );
  });

  it("comment posts with parentCommentId when provided", async () => {
    await api.comment("p1", "nice", "c1");
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/posts/p1/comments",
      { body: "nice", parentCommentId: "c1" },
      expect.anything(),
    );
  });

  it("comment posts without parentCommentId for top-level", async () => {
    await api.comment("p1", "nice");
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/posts/p1/comments",
      { body: "nice" },
      expect.anything(),
    );
  });

  it("comments uses page/size pagination", async () => {
    await api.comments("p1", 2, 20);
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/feed/posts/p1/comments?page=2&size=20",
      expect.anything(),
    );
  });

  it("normalizes the backend comment parent for list, create and edit responses", async () => {
    const row = {
      id: "reply",
      postId: "p1",
      authorId: "a1",
      parentId: "parent",
      body: "reply",
      createdAt: "2026-11-01",
    };
    client.get.mockResolvedValueOnce({
      items: [row],
      nextCursor: null,
    } as never);
    expect((await api.comments("p1")).items[0].parentCommentId).toBe("parent");
    client.post.mockResolvedValueOnce(row);
    expect((await api.comment("p1", "reply", "parent")).parentCommentId).toBe(
      "parent",
    );
    client.patch.mockResolvedValueOnce(row);
    expect((await api.updateComment("reply", "edited")).parentCommentId).toBe(
      "parent",
    );
  });

  it("synchronizes engagement without double-counting an optimistic source item", async () => {
    let timeline = {
      viewerReaction: null,
      reactionCount: 2,
      saved: false,
      shareCount: 0,
    } as FeedItem;
    let optimistic = {
      ...timeline,
      viewerReaction: "LIKE",
      reactionCount: 3,
    } as FeedItem;
    const unsubscribe = subscribeFeedUpdates(client as never, (id, update) => {
      expect(id).toBe("p1");
      timeline = update(timeline);
      optimistic = update(optimistic);
    });
    const otherSession = jest.fn();
    const unsubscribeOther = subscribeFeedUpdates({} as never, otherSession);
    try {
      await api.react("p1", "LIKE");
      expect(timeline.reactionCount).toBe(3);
      expect(optimistic.reactionCount).toBe(3);
      await api.unreact("p1");
      expect(timeline.reactionCount).toBe(2);
      expect(optimistic.reactionCount).toBe(2);
      await api.save("p1");
      expect(timeline.saved).toBe(true);
      await api.unsave("p1");
      expect(timeline.saved).toBe(false);
      client.post.mockResolvedValueOnce({ shareCount: 4 });
      await api.sharePost("p1");
      expect(timeline.shareCount).toBe(4);
      expect(otherSession).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      unsubscribeOther();
    }
  });

  it("does not broadcast failed mutations or retain unsubscribed listeners", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFeedUpdates(client as never, listener);
    try {
      client.put.mockRejectedValueOnce(new Error("offline"));
      await expect(api.save("p1")).rejects.toThrow("offline");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
    await api.save("p1");
    expect(listener).not.toHaveBeenCalled();
  });

  it("createHelpPost posts correct payload", async () => {
    await api.createHelpPost({
      communityId: "c1",
      helpKind: "REQUEST",
      title: "help",
      body: "need help",
      expiresAt: "2026-11-10T00:00:00Z",
      mediaIds: ["m1"],
      tags: ["Leeds"],
      idempotencyKey: "help-publication-key",
    });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/community-help",
      {
        communityId: "c1",
        helpKind: "REQUEST",
        title: "help",
        body: "need help",
        expiresAt: "2026-11-10T00:00:00Z",
        mediaIds: ["m1"],
        tags: ["Leeds"],
        idempotencyKey: "help-publication-key",
      },
      expect.anything(),
    );
  });

  it("createPoll posts the complete typed Poll contract", async () => {
    const request = {
      communityId: "c1",
      categoryId: "cat1",
      question: "Best city?",
      options: ["A", "B"],
      maxOptions: 8,
      allowMultiple: true,
      allowVoteChange: true,
      allowVoteWithdraw: true,
      anonymousVoting: true,
      resultsVisibility: "IMMEDIATE" as const,
    };
    await api.createPoll(request);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/polls",
      request,
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("vote posts to option endpoint", async () => {
    await api.vote("opt1", false);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/polls/options/opt1/vote",
      { withdraw: false },
      expect.anything(),
    );
  });

  it("getPoll hits the Poll detail endpoint", async () => {
    await api.getPoll("p1");
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/feed/polls/p1",
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("updatePoll patches the Poll endpoint", async () => {
    const request = {
      question: "Updated?",
      options: ["A", "B", "C"],
      maxOptions: 6,
    };
    await api.updatePoll("p1", request);
    expect(client.patch).toHaveBeenCalledWith(
      "/api/v1/feed/polls/p1",
      request,
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("closePoll posts an empty close request", async () => {
    await api.closePoll("p1");
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/polls/p1/close",
      {},
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("reportPost uses the shared post report endpoint", async () => {
    await api.reportPost("p1", {
      reason: "SPAM",
      details: "Repeated unsolicited content",
    });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/posts/p1/reports",
      { reason: "SPAM", details: "Repeated unsolicited content" },
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("recordView swallows errors silently", async () => {
    client.post.mockRejectedValueOnce(new Error("network"));
    await expect(api.recordView("FEED_POST", "p1")).resolves.not.toThrow();
  });

  it("communityFeed passes tag filter when provided", async () => {
    await api.communityFeed("c1", "LATEST", "cat1", undefined, 20, "leeds");
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining("&categoryId=cat1&tag=leeds&size=20"),
      expect.anything(),
    );
  });

  it("feedCategories passes module param", async () => {
    await api.feedCategories("country1", "COMMUNITY_HELP");
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/taxonomy/categories?module=COMMUNITY_HELP&countryId=country1",
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("suggestTags hits the suggest endpoint", async () => {
    await api.suggestTags("lee", 10);
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/feed/tags/suggest?q=lee&size=10",
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("tagFeed hits the community-scoped tag feed", async () => {
    await api.tagFeed("leeds", "c1", undefined, 20);
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/feed/tags/leeds/posts?communityId=c1&size=20",
      expect.objectContaining({ authenticated: true }),
    );
    await api.tagFeed("Visa Advice", "c1", "cur1", 10);
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining(
        "tags/Visa%20Advice/posts?communityId=c1&size=10&cursor=cur1",
      ),
      expect.anything(),
    );
  });

  it("feedMediaDownloadUrl posts to the parent-authorized endpoint", async () => {
    await api.feedMediaDownloadUrl("m1");
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/media/m1/download-url",
      {},
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("createPost preserves its publication idempotency key", async () => {
    const req = {
      communityId: "c1",
      postType: "GENERAL" as const,
      body: "hi #Leeds",
      categoryId: "cat1",
      mediaIds: ["m1"],
      tags: ["leeds"],
      idempotencyKey: "post-publication-key",
    };
    await api.createPost(req);
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/feed/posts",
      req,
      expect.objectContaining({ authenticated: true }),
    );
  });

  it("updatePost sends categoryId and tags when provided", async () => {
    const data = { body: "edited", categoryId: "cat1", tags: ["new"] };
    await api.updatePost("p1", data);
    expect(client.patch).toHaveBeenCalledWith(
      "/api/v1/feed/posts/p1",
      data,
      expect.anything(),
    );
  });
});
