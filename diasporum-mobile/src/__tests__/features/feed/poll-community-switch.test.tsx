import React from "react";
import { render, waitFor } from "@testing-library/react-native";

import { useFeed } from "@/features/feed/hooks/use-feed";
import type { FeedItem } from "@/features/feed/types/feed-types";

let mockActiveCommunityId = "community-1";
let renderedItems: FeedItem[] = [];

const mockFeedApi = {
  communityFeed: jest.fn(),
  communityDetail: jest.fn(),
  feedCategories: jest.fn(),
};

jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({
    apiClient: {},
    session: { activeCommunityId: mockActiveCommunityId },
  }),
}));
jest.mock("@/features/feed/services/feed-api", () => ({
  createFeedApi: () => mockFeedApi,
}));

function makePollItem(communityId: string): FeedItem {
  return {
    itemId: `FEED_POST:post-${communityId}`,
    contentType: "POLL",
    sourceModule: "feed",
    sourceId: `post-${communityId}`,
    author: null,
    communityId,
    publishedAt: "2026-11-03T10:00:00Z",
    title: null,
    body: `Poll for ${communityId}`,
    mediaIds: [],
    commentCount: 0,
    reactionCount: 0,
    viewerReaction: null,
    viewed: false,
    saved: false,
    payload: {},
  };
}

function FeedProbe() {
  const feed = useFeed();
  React.useEffect(() => {
    renderedItems = feed.items;
  }, [feed.items]);
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveCommunityId = "community-1";
  renderedItems = [];
  mockFeedApi.communityFeed.mockImplementation(async (communityId: string) => ({
    items: [makePollItem(communityId)],
    nextCursor: null,
  }));
  mockFeedApi.communityDetail.mockImplementation(async (communityId: string) => ({
    id: communityId,
    destinationCountryId: `country-${communityId}`,
  }));
  mockFeedApi.feedCategories.mockResolvedValue({ items: [] });
});

describe("Poll Feed community switching", () => {
  it("replaces the previous community's Poll with the active community's Feed", async () => {
    const { rerender } = await render(<FeedProbe />);

    await waitFor(() => expect(renderedItems.map((item) => item.sourceId)).toEqual([
      "post-community-1",
    ]));

    mockActiveCommunityId = "community-2";
    await rerender(<FeedProbe />);

    await waitFor(() => expect(renderedItems.map((item) => item.sourceId)).toEqual([
      "post-community-2",
    ]));
    expect(mockFeedApi.communityFeed).toHaveBeenCalledWith(
      "community-2",
      "FOR_YOU",
      undefined,
      undefined,
    );
    expect(renderedItems.some((item) => item.communityId === "community-1")).toBe(false);
  });
});
