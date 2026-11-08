import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { useReels } from "@/features/feed/hooks/use-reels";
import type { FeedItem, FeedPage } from "@/features/feed/types/feed-types";

const mockClient = { get: jest.fn(), post: jest.fn() };
let mockCommunity = "community-1";
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: { activeCommunityId: mockCommunity },
  }),
}));
let state: ReturnType<typeof useReels>;
function Probe() {
  const reels = useReels();
  React.useEffect(() => {
    state = reels;
  }, [reels]);
  return null;
}
function reel(id: string): FeedItem {
  return {
    itemId: `FEED_POST:${id}`,
    sourceId: id,
    contentType: "REEL",
    sourceModule: "feed",
    author: null,
    communityId: mockCommunity,
    publishedAt: "2026-11-01",
    title: null,
    body: id,
    mediaIds: [id],
    media: [
      {
        id,
        purpose: "FEED_VIDEO",
        mimeType: "video/mp4",
        durationMs: 10000,
        sizeBytes: 100,
      },
    ],
    tags: [],
    commentCount: 0,
    reactionCount: 0,
    shareCount: 0,
    viewerReaction: null,
    viewed: false,
    saved: false,
    payload: {},
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  mockClient.get.mockReset();
  mockCommunity = "community-1";
});

it("walks empty mixed-feed pages and rejects non-video/multiple attachments", async () => {
  mockClient.get
    .mockResolvedValueOnce({
      items: [{ ...reel("text"), contentType: "GENERAL" }],
      nextCursor: "one",
    })
    .mockResolvedValueOnce({
      items: [{ ...reel("bad"), mediaIds: ["a", "b"] }],
      nextCursor: "two",
    })
    .mockResolvedValueOnce({
      items: [reel("valid"), reel("valid")],
      nextCursor: null,
    });
  await render(<Probe />);
  await waitFor(() =>
    expect(state.items.map((i) => i.sourceId)).toEqual(["valid"]),
  );
  expect(mockClient.get).toHaveBeenCalledTimes(3);
  expect(state.hasMore).toBe(false);
});

it("allows continuation after the five-hop scan budget without claiming exhaustion", async () => {
  for (let i = 0; i < 5; i++)
    mockClient.get.mockResolvedValueOnce({
      items: [],
      nextCursor: `cursor-${i}`,
    });
  mockClient.get.mockResolvedValueOnce({
    items: [reel("sixth-page")],
    nextCursor: null,
  });
  await render(<Probe />);
  await waitFor(() => expect(state.loading).toBe(false));
  expect(state.items).toEqual([]);
  expect(state.hasMore).toBe(true);
  await act(() => state.loadMore());
  await waitFor(() => expect(state.items[0]?.sourceId).toBe("sixth-page"));
});

it("ignores a stale community response after switching to Following", async () => {
  const old = deferred<FeedPage>();
  mockClient.get
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ items: [reel("following")], nextCursor: null });
  await render(<Probe />);
  await act(() => state.switchMode("following"));
  await waitFor(() => expect(state.items[0]?.sourceId).toBe("following"));
  await act(() => old.resolve({ items: [reel("stale")], nextCursor: null }));
  expect(state.mode).toBe("following");
  expect(state.items[0].sourceId).toBe("following");
});

it("ignores old membership results and keeps the new community request live", async () => {
  const old = deferred<FeedPage>();
  mockClient.get
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ items: [reel("new")], nextCursor: null });
  const view = await render(<Probe />);
  mockCommunity = "community-2";
  await view.rerender(<Probe />);
  await act(() =>
    old.resolve({ items: [reel("old")], nextCursor: "old-cursor" }),
  );
  await waitFor(() => expect(state.items[0]?.sourceId).toBe("new"));
});

it("refresh supersedes pagination and repeated loadMore does not duplicate requests", async () => {
  const old = deferred<FeedPage>();
  mockClient.get
    .mockResolvedValueOnce({ items: [reel("first")], nextCursor: "next" })
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ items: [reel("fresh")], nextCursor: null });
  await render(<Probe />);
  await waitFor(() => expect(state.items.length).toBe(1));
  await act(() => {
    state.loadMore();
    state.loadMore();
  });
  expect(mockClient.get).toHaveBeenCalledTimes(2);
  await act(() => state.refresh());
  await act(() => old.resolve({ items: [reel("old-page")], nextCursor: null }));
  await waitFor(() =>
    expect(state.items.map((i) => i.sourceId)).toEqual(["fresh"]),
  );
  expect(state.refreshing).toBe(false);
});

it("skips duplicate-only pages caused by view-aware ordering", async () => {
  mockClient.get
    .mockResolvedValueOnce({ items: [reel("first")], nextCursor: "one" })
    .mockResolvedValueOnce({ items: [reel("first")], nextCursor: "two" })
    .mockResolvedValueOnce({ items: [reel("second")], nextCursor: null });
  await render(<Probe />);
  await waitFor(() => expect(state.items.length).toBe(1));
  await act(() => state.loadMore());
  await waitFor(() =>
    expect(state.items.map((i) => i.sourceId)).toEqual(["first", "second"]),
  );
});

it("surfaces pagination failures and preserves items for retry", async () => {
  mockClient.get
    .mockResolvedValueOnce({ items: [reel("first")], nextCursor: "one" })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ items: [reel("second")], nextCursor: null });
  await render(<Probe />);
  await waitFor(() => expect(state.items.length).toBe(1));
  await act(() => state.loadMore());
  await waitFor(() => expect(state.error).toBeTruthy());
  expect(state.items.length).toBe(1);
  await act(() => state.loadMore());
  await waitFor(() => expect(state.items.length).toBe(2));
});

it("stops a repeating cursor instead of looping forever", async () => {
  mockClient.get.mockResolvedValue({ items: [], nextCursor: "same" });
  await render(<Probe />);
  await waitFor(() => expect(state.error).toBeTruthy());
  expect(mockClient.get).toHaveBeenCalledTimes(2);
});
