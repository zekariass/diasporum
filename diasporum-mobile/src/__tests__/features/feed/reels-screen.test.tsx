import React from "react";
import {
  AppState,
  Keyboard,
  Platform,
  Share,
  StyleSheet,
  type KeyboardEvent,
} from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import ReelsScreen from "@/features/feed/screens/reels-screen";
import { clearMediaCache } from "@/features/feed/utils/media-cache";
import type { FeedItem } from "@/features/feed/types/feed-types";

const mockClient = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: () => true,
};
let mockBlur: (() => void) | undefined;
let mockFocus: (() => void) | undefined;
let mockPlayers: MockPlayer[] = [];
let mockMaxPlaying = 0;
let mockData: FeedItem[];
class MockPlayer {
  status = "readyToPlay";
  playing = false;
  muted = false;
  currentTime = 0;
  duration = 10;
  released = false;
  loop = false;
  timeUpdateEventInterval = 0;
  audioMixingMode = "auto";
  staysActiveInBackground = false;
  listeners = new Map<string, Set<(data: Record<string, unknown>) => void>>();
  constructor(public uri: string) {}
  play = jest.fn(() => {
    this.playing = true;
    mockMaxPlaying = Math.max(
      mockMaxPlaying,
      mockPlayers.filter((p) => p.playing).length,
    );
    this.emit("playingChange", { isPlaying: true });
  });
  pause = jest.fn(() => {
    const wasPlaying = this.playing;
    this.playing = false;
    if (wasPlaying) this.emit("playingChange", { isPlaying: false });
  });
  addListener(name: string, listener: (data: Record<string, unknown>) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(listener);
    return { remove: () => this.listeners.get(name)!.delete(listener) };
  }
  emit(name: string, data: Record<string, unknown>) {
    if (name === "statusChange") this.status = data.status as string;
    this.listeners.get(name)?.forEach((listener) => listener(data));
  }
}
jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-linking", () => ({
  createURL: (path: string) => `diasporummobile://${path.replace(/^\//, "")}`,
}));
jest.mock("@/features/feed/components/avatar", () => ({ Avatar: () => null }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  useFocusEffect: (effect: () => () => void) => {
    const React = jest.requireActual("react");
    React.useEffect(() => {
      mockFocus = effect;
      mockBlur = effect();
      return mockBlur;
    }, [effect]);
  },
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: {
      activeCommunityId: "community-1",
      me: { id: "viewer" },
      profile: { displayName: "Viewer" },
    },
  }),
}));
jest.mock("expo-video", () => ({
  useVideoPlayer: (
    source: { uri: string },
    setup: (player: MockPlayer) => void,
  ) => {
    const React = jest.requireActual("react");
    const [player] = React.useState(() => {
      const p = new MockPlayer(source.uri);
      mockPlayers.push(p);
      setup(p);
      return p;
    });
    React.useEffect(
      () => () => {
        player.pause();
        player.released = true;
      },
      [player],
    );
    return player;
  },
  VideoView: () => null,
}));
function reel(id: string): FeedItem {
  return {
    itemId: `FEED_POST:${id}`,
    sourceId: id,
    contentType: "REEL",
    sourceModule: "feed",
    author: {
      id: "creator",
      username: "creator",
      displayName: "Creator",
      accountStatus: "ACTIVE",
      profileCompleted: true,
      avatarMediaId: null,
    },
    communityId: "community-1",
    publishedAt: "2026-11-01",
    title: null,
    body: `Caption ${id}`,
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
    reactionCount: 2,
    shareCount: 0,
    viewerReaction: null,
    viewed: false,
    saved: false,
    payload: {},
  };
}
function detail(id: string) {
  const item = mockData.find((i) => i.sourceId === id)!;
  return {
    post: {
      ...item,
      id,
      postType: "REEL",
      authorId: "creator",
      commentsEnabled: true,
    },
    tags: [],
    media: item.media,
    saved: item.saved,
    viewerReaction: item.viewerReaction,
  };
}
async function mount() {
  const view = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, bottom: 34, left: 0, right: 0 },
      }}
    >
      <ReelsScreen />
    </SafeAreaProvider>,
  );
  await fireEvent(screen.getByTestId("reels-viewport"), "layout", {
    nativeEvent: { layout: { height: 844, width: 390 } },
  });
  await fireEvent(screen.getByTestId("reels-list"), "layout", {
    nativeEvent: { layout: { height: 844, width: 390 } },
  });
  await waitFor(() => expect(mockPlayers.some((p) => p.playing)).toBe(true));
  await fireEvent(
    screen.getByTestId("reels-list"),
    "contentSizeChange",
    390,
    mockData.length * 844,
  );
  return view;
}
async function swipe(index: number) {
  const list = screen.getByTestId("reels-list");
  await fireEvent(list, "scrollBeginDrag");
  const event = {
    nativeEvent: {
      contentOffset: { x: 0, y: index * 844 },
      contentSize: { width: 390, height: mockData.length * 844 },
      layoutMeasurement: { width: 390, height: 844 },
      velocity: { x: 0, y: 0 },
    },
  };
  await fireEvent.scroll(list, event);
  await fireEvent(list, "scrollEndDrag", event);
  await fireEvent(list, "momentumScrollEnd", event);
}
function current() {
  return mockPlayers.find((p) => p.playing)!;
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.values(mockClient).forEach((mock) => mock.mockReset());
  clearMediaCache();
  mockPlayers = [];
  mockMaxPlaying = 0;
  mockData = [reel("one"), reel("two"), reel("three")];
  AppState.currentState = "active";
  mockClient.get.mockImplementation(async (path: string) => {
    if (path.includes("/reels/community") || path.includes("/feed/following"))
      return { items: mockData, nextCursor: null };
    if (path.includes("/relationship/")) return { following: false };
    if (path.includes("/comments?")) return { items: [], nextCursor: null };
    if (path.includes("/authors")) return [];
    return detail(path.split("/").pop()!);
  });
  mockClient.post.mockImplementation(
    async (path: string, data: { body?: string }) => {
      if (path.includes("/download-url"))
        return {
          downloadUrl: `https://media.test/${path.split("/").at(-2)}.mp4`,
        };
      if (path.endsWith("/share")) return { shareCount: 1 };
      if (path.endsWith("/comments")) {
        mockData[0] = {
          ...mockData[0],
          commentCount: mockData[0].commentCount + 1,
        };
        return {
          id: "comment-1",
          postId: "one",
          authorId: "viewer",
          parentId: null,
          body: data.body,
          createdAt: "2026-11-01",
        };
      }
      return {};
    },
  );
  mockClient.put.mockImplementation(async (path: string) => {
    const id = path.split("/").at(-2);
    mockData = mockData.map((i) =>
      i.sourceId !== id
        ? i
        : path.endsWith("/save")
          ? { ...i, saved: true }
          : {
              ...i,
              viewerReaction: "LIKE",
              reactionCount: i.reactionCount + 1,
            },
    );
    return {};
  });
  mockClient.delete.mockImplementation(async (path: string) => {
    const id = path.split("/").at(-2);
    mockData = mockData.map((i) =>
      i.sourceId !== id
        ? i
        : path.endsWith("/save")
          ? { ...i, saved: false }
          : { ...i, viewerReaction: null, reactionCount: i.reactionCount - 1 },
    );
    return {};
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it("autoplays unmuted, preloads only one neighbor, and releases offscreen players", async () => {
  const view = await mount();
  expect(current().uri).toContain("one");
  expect(current().muted).toBe(false);
  await waitFor(() =>
    expect(mockPlayers.filter((p) => !p.released).length).toBe(2),
  );
  const first = current();
  await swipe(1);
  await waitFor(() => expect(current()?.uri).toContain("two"));
  expect(first.playing).toBe(false);
  expect(first.released).toBe(true);
  await swipe(2);
  await waitFor(() => expect(current()?.uri).toContain("three"));
  expect(mockMaxPlaying).toBe(1);
  await view.unmount();
  expect(mockPlayers.every((p) => p.released && !p.playing)).toBe(true);
});

it("pauses on drag, background and navigation blur and resumes at the same time", async () => {
  let appChange!: (state: string) => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    appChange = listener as (state: string) => void;
    return { remove: jest.fn() };
  });
  await mount();
  const player = current();
  player.currentTime = 4;
  await act(() => appChange("background"));
  expect(mockPlayers.some((p) => p.playing)).toBe(false);
  await act(() => appChange("active"));
  await waitFor(() => expect(player.playing).toBe(true));
  expect(player.currentTime).toBe(4);
  await fireEvent(screen.getByTestId("reels-list"), "scrollBeginDrag");
  expect(mockPlayers.some((p) => p.playing)).toBe(false);
  await act(() => mockBlur?.());
  expect(mockPlayers.some((p) => p.playing)).toBe(false);
  await act(() => {
    mockFocus?.();
  });
  await waitFor(() => expect(player.playing).toBe(true));
  expect(player.currentTime).toBe(4);
});

it("toggles pause on single tap and likes on double tap without pausing", async () => {
  await mount();
  const player = current();
  await fireEvent.press(screen.getByLabelText("Pause reel"));
  await act(() => jest.advanceTimersByTime(300));
  expect(player.playing).toBe(false);
  await fireEvent.press(screen.getAllByLabelText("Play reel")[0]);
  await act(() => jest.advanceTimersByTime(300));
  expect(player.playing).toBe(true);
  await fireEvent.press(screen.getByLabelText("Pause reel"));
  await fireEvent.press(screen.getByLabelText("Pause reel"));
  await act(() => jest.advanceTimersByTime(300));
  expect(player.playing).toBe(true);
  expect(screen.getByLabelText("Unlike")).toBeTruthy();
});

it("times out stalled loading and refreshes the signed playback URL", async () => {
  await mount();
  const player = current();
  await act(() => player.emit("statusChange", { status: "loading" }));
  expect(screen.getByLabelText("Loading video")).toBeTruthy();
  await act(() => jest.advanceTimersByTime(20_000));
  await waitFor(() => expect(current()).toBeDefined());
  expect(current()).not.toBe(player);
  expect(player.released).toBe(true);
});

it("keeps playing when tapping the already selected feed tab", async () => {
  await mount();
  const player = current();
  await fireEvent.press(screen.getByText("Community"));
  expect(player.playing).toBe(true);
});

it("starts the new mode even if the previous pager was interrupted mid-drag", async () => {
  await mount();
  await fireEvent(screen.getByTestId("reels-list"), "scrollBeginDrag");
  await fireEvent.press(screen.getByText("Following"));
  await waitFor(() => expect(current()?.uri).toContain("one"));
});

it("preserves the user mute choice across reels", async () => {
  await mount();
  await fireEvent.press(screen.getAllByLabelText("Mute")[0]);
  expect(current().muted).toBe(true);
  await swipe(1);
  await waitFor(() => expect(current()?.uri).toContain("two"));
  expect(current().muted).toBe(true);
});

it("More/Less overlays the full caption, locks paging and never recreates the current player", async () => {
  await mount();
  expect(screen.queryByLabelText("Show more description")).toBeNull();
  const player = current();
  player.currentTime = 3;
  await fireEvent(
    screen.getByTestId("reel-caption-measure-one", {
      includeHiddenElements: true,
    }),
    "textLayout",
    { nativeEvent: { lines: [{}, {}, {}, {}] } },
  );
  await fireEvent.press(screen.getByLabelText("Show more description"));
  expect(screen.getByLabelText("Full Reel description")).toBeTruthy();
  expect(screen.getByTestId("reels-list").props.scrollEnabled).toBe(false);
  expect(current()).toBe(player);
  await fireEvent.press(screen.getByLabelText("Show less description"));
  expect(screen.queryByLabelText("Full Reel description")).toBeNull();
  expect(current()).toBe(player);
  expect(player.currentTime).toBe(3);
});

it("likes/unlikes, saves/unsaves and prevents duplicate pending reactions", async () => {
  await mount();
  let finish!: () => void;
  mockClient.put.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const like = screen.getAllByLabelText("Like")[0];
  await fireEvent.press(like);
  await fireEvent.press(like);
  expect(mockClient.put).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Unlike")).toBeTruthy();
  await act(() => finish());
  await fireEvent.press(screen.getByLabelText("Unlike"));
  expect(mockClient.delete).toHaveBeenCalledWith(
    "/api/v1/feed/posts/one/reaction",
    expect.anything(),
  );
  await fireEvent.press(screen.getAllByLabelText("Save")[0]);
  expect(screen.getByLabelText("Unsave")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Unsave"));
  expect(mockClient.delete).toHaveBeenCalledWith(
    "/api/v1/feed/posts/one/save",
    expect.anything(),
  );
});

it("rolls back failed likes and saves and shows an error", async () => {
  await mount();
  mockClient.put.mockRejectedValueOnce(new Error("offline"));
  await fireEvent.press(screen.getAllByLabelText("Like")[0]);
  await waitFor(() => expect(screen.queryByLabelText("Unlike")).toBeNull());
  expect(screen.getByText("Action failed. Please try again.")).toBeTruthy();
  mockClient.put.mockRejectedValueOnce(new Error("offline"));
  await fireEvent.press(screen.getAllByLabelText("Save")[0]);
  await waitFor(() => expect(screen.queryByLabelText("Unsave")).toBeNull());
});

it("shares a link only counts successful shares and handles cancellation/failure", async () => {
  await mount();
  const share = jest.spyOn(Share, "share").mockResolvedValue({
    action: Share.dismissedAction,
    activityType: undefined,
  });
  await fireEvent.press(screen.getAllByLabelText("Share")[0]);
  expect(
    mockClient.post.mock.calls.some(([url]) => url.endsWith("/share")),
  ).toBe(false);
  share.mockResolvedValueOnce({
    action: Share.sharedAction,
    activityType: undefined,
  });
  await fireEvent.press(screen.getAllByLabelText("Share")[0]);
  expect(share).toHaveBeenLastCalledWith({
    message: expect.stringContaining("diasporummobile://posts/one"),
  });
  expect(mockClient.post).toHaveBeenCalledWith(
    "/api/v1/feed/posts/one/share",
    { target: "SYSTEM_SHARE" },
    expect.anything(),
  );
  share.mockRejectedValueOnce(new Error("unavailable"));
  await fireEvent.press(screen.getAllByLabelText("Share")[0]);
  expect(screen.getByText("Action failed. Please try again.")).toBeTruthy();
});

it("uses shared comments, submits once and restores playback without resetting position", async () => {
  await mount();
  const player = current();
  player.currentTime = 5;
  await fireEvent.press(screen.getAllByLabelText("Comments")[0]);
  expect(player.playing).toBe(false);
  await waitFor(() => expect(screen.getByLabelText("Comment")).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText("Comment"), "Great Reel!");
  await fireEvent.press(screen.getByLabelText("Send comment"));
  await waitFor(() => expect(screen.getByText("Great Reel!")).toBeTruthy());
  expect(mockClient.post).toHaveBeenCalledWith(
    "/api/v1/feed/posts/one/comments",
    { body: "Great Reel!" },
    expect.anything(),
  );
  await fireEvent.press(screen.getAllByLabelText("Close comments")[0]);
  await waitFor(() => expect(player.playing).toBe(true));
  expect(
    within(screen.getAllByLabelText("Comments")[0]).getByText("1"),
  ).toBeTruthy();
  expect(player.currentTime).toBe(5);
});

it("keeps the Reels comment composer above the keyboard", async () => {
  const listeners = new Map<string, unknown[]>();
  const addListener = jest
    .spyOn(Keyboard, "addListener")
    .mockImplementation((event, listener) => {
      const handlers = listeners.get(event) ?? [];
      handlers.push(listener);
      listeners.set(event, handlers);
      return { remove: jest.fn() };
    });
  try {
    await mount();
    await fireEvent.press(screen.getAllByLabelText("Comments")[0]);
    await waitFor(() => expect(screen.getByLabelText("Comment")).toBeTruthy());
    const keyboard = screen.getByTestId("reels-comments-keyboard");
    expect(within(keyboard).getByLabelText("Comment")).toBeTruthy();
    await fireEvent(keyboard, "layout", {
      persist: jest.fn(),
      nativeEvent: {
        layout: { x: 0, y: 0, width: 390, height: 844 },
      },
    });
    await fireEvent(screen.getByLabelText("Comment"), "focus");
    const frame = { screenX: 0, screenY: 504, width: 390, height: 340 };
    const show = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hide = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    await act(async () => {
      listeners.get(show)?.forEach((listener) =>
        (listener as (event: KeyboardEvent) => void)({
          duration: 250,
          easing: "keyboard",
          endCoordinates: frame,
          startCoordinates: { ...frame, screenY: 844 },
          isEventFromThisApp: true,
        } as KeyboardEvent),
      );
    });
    await waitFor(() => {
      const style = StyleSheet.flatten(keyboard.props.style);
      if (Platform.OS === "ios") expect(style.paddingBottom).toBe(340);
      else expect(style).toMatchObject({ height: 504, flex: 0 });
    });
    await act(async () => {
      listeners
        .get(hide)
        ?.forEach((listener) =>
          (listener as (event?: KeyboardEvent) => void)(undefined),
        );
    });
    await waitFor(() => {
      const style = StyleSheet.flatten(keyboard.props.style);
      expect(style.height).toBeUndefined();
      expect(style.paddingBottom ?? 0).toBe(0);
    });
  } finally {
    addListener.mockRestore();
  }
});

it("retains persisted reaction counts and bookmarks after leaving and revisiting a reel", async () => {
  await mount();
  await fireEvent.press(screen.getAllByLabelText("Like")[0]);
  expect(within(screen.getByLabelText("Unlike")).getByText("3")).toBeTruthy();
  await fireEvent.press(screen.getAllByLabelText("Save")[0]);
  await swipe(1);
  await swipe(0);
  await waitFor(() => expect(current()?.uri).toContain("one"));
  expect(within(screen.getByLabelText("Unlike")).getByText("3")).toBeTruthy();
  expect(screen.getByLabelText("Unsave")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Unlike"));
  expect(
    within(screen.getAllByLabelText("Like")[0]).getByText("2"),
  ).toBeTruthy();
});

it("follows and unfollows through the shared social API and rolls back failure", async () => {
  await mount();
  await fireEvent.press(screen.getByLabelText("Follow"));
  expect(mockClient.post).toHaveBeenCalledWith(
    "/api/v1/social/follows/creator",
    {},
    expect.anything(),
  );
  expect(screen.getByLabelText("Unfollow")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Unfollow"));
  expect(mockClient.delete).toHaveBeenCalledWith(
    "/api/v1/social/follows/creator",
    expect.anything(),
  );
  mockClient.post.mockRejectedValueOnce(new Error("offline"));
  await fireEvent.press(screen.getByLabelText("Follow"));
  await waitFor(() => expect(screen.getByLabelText("Follow")).toBeTruthy());
  expect(screen.getByText("Action failed. Please try again.")).toBeTruthy();
});

it("prevents duplicate comment submissions and preserves the draft on failure", async () => {
  await mount();
  await fireEvent.press(screen.getAllByLabelText("Comments")[0]);
  await waitFor(() => expect(screen.getByLabelText("Comment")).toBeTruthy());
  await fireEvent.changeText(
    screen.getByLabelText("Comment"),
    "Keep this draft",
  );
  let reject!: (error: Error) => void;
  mockClient.post.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const user = userEvent.setup();
  await user.press(screen.getByLabelText("Send comment"));
  expect(screen.getByLabelText("Comment").props.editable).toBe(false);
  await user.press(screen.getByLabelText("Send comment"));
  expect(
    mockClient.post.mock.calls.filter(([url]) => url.endsWith("/comments")),
  ).toHaveLength(1);
  await act(() => reject(new Error("offline")));
  expect(screen.getByText("Failed to post comment.")).toBeTruthy();
  expect(screen.getByLabelText("Comment").props.value).toBe("Keep this draft");
});

it("keeps replies visible when their parent comment is deleted", async () => {
  const get = mockClient.get.getMockImplementation()!;
  mockClient.get.mockImplementation((path: string) =>
    path.includes("/comments?")
      ? Promise.resolve({
          items: [
            {
              id: "parent",
              postId: "one",
              authorId: "viewer",
              parentId: null,
              body: "Parent",
              createdAt: "2026-11-01",
            },
            {
              id: "reply",
              postId: "one",
              authorId: "creator",
              parentId: "parent",
              body: "Reply remains",
              createdAt: "2026-11-01",
            },
          ],
          nextCursor: null,
        })
      : get(path),
  );
  await mount();
  await fireEvent.press(screen.getAllByLabelText("Comments")[0]);
  await waitFor(() => expect(screen.getByText("Reply remains")).toBeTruthy());
  await fireEvent.press(screen.getByLabelText("Delete comment"));
  await waitFor(() => expect(screen.queryByText("Parent")).toBeNull());
  expect(screen.getByText("Reply remains")).toBeTruthy();
  expect(mockClient.delete).toHaveBeenCalledWith(
    "/api/v1/feed/comments/parent",
    expect.anything(),
  );
});

it("bounds allocated players during repeated forward and backward browsing", async () => {
  mockData = Array.from({ length: 20 }, (_, index) => reel(`reel-${index}`));
  await mount();
  for (const index of [1, 2, 3, 7, 10, 15, 19, 10, 4, 0]) {
    await swipe(index);
    await waitFor(() => expect(current()?.uri).toContain(`/reel-${index}.mp4`));
    expect(mockPlayers.filter((p) => !p.released).length).toBeLessThanOrEqual(
      2,
    );
  }
  expect(mockMaxPlaying).toBe(1);
});

it("refreshes an expired playback URL once and then offers manual retry", async () => {
  await mount();
  const player = current();
  player.currentTime = 6;
  await act(() => player.emit("statusChange", { status: "error" }));
  await waitFor(() => expect(current()).not.toBe(player));
  expect(current().currentTime).toBe(6);
  await act(() => current().emit("statusChange", { status: "error" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Retry video")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByLabelText("Retry video"));
  await waitFor(() => expect(mockPlayers.some((p) => p.playing)).toBe(true));
});
