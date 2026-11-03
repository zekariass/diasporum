import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError } from "@/core/api/api-error";
import CreatePostScreen from "@/features/feed/screens/create-post-screen";
import EditPostScreen from "@/features/feed/screens/edit-post-screen";
import HomeFeedScreen from "@/features/feed/screens/home-feed-screen";
import PostDetailScreen from "@/features/feed/screens/post-detail-screen";
import type { FeedItem, Poll, PostRow } from "@/features/feed/types/feed-types";

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
const mockSafeBack = jest.fn();
let mockParams: Record<string, string> = {};
let mockSession = defaultSession();

const mockFeedApi = {
  communityDetail: jest.fn(),
  feedCategories: jest.fn(),
  createPoll: jest.fn(),
  getPost: jest.fn(),
  getPoll: jest.fn(),
  updatePoll: jest.fn(),
  updatePost: jest.fn(),
  vote: jest.fn(),
  closePoll: jest.fn(),
  reportPost: jest.fn(),
  comments: jest.fn(),
  authorSummaries: jest.fn(),
};

const mockFeedState = {
  items: [] as FeedItem[],
  categories: [],
  categoryId: null,
  loading: false,
  refreshing: false,
  loadingMore: false,
  error: null,
  updatePost: jest.fn(),
  deletePost: jest.fn(),
  react: jest.fn(),
  toggleSave: jest.fn(),
  loadMore: jest.fn(),
  refresh: jest.fn(),
  setCategory: jest.fn(),
};

jest.mock("@/global.css", () => ({}));
jest.mock("@/core/navigation/safe-back", () => ({ safeBack: () => mockSafeBack() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 1 },
}));
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("expo-router", () => ({
  get router() { return mockRouter; },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({ apiClient: {}, session: mockSession }),
}));
jest.mock("@/features/feed/services/feed-api", () => ({
  createFeedApi: () => mockFeedApi,
}));
jest.mock("@/features/feed/hooks/use-feed", () => ({ useFeed: () => mockFeedState }));
jest.mock("@/features/feed/components/feed-header", () => ({ FeedHeader: () => null }));
jest.mock("@/features/feed/components/community-drawer", () => ({ CommunityDrawer: () => null }));
jest.mock("@/features/feed/components/composer-bar", () => ({ ComposerBar: () => null }));
jest.mock("@/features/feed/components/feed-controls", () => ({ CategoryFilter: () => null }));
jest.mock("@/features/feed/components/feature-panels", () => ({
  MatchmakingPanel: () => null,
  PropertyPanel: () => null,
  VehiclesPanel: () => null,
  EventsPanel: () => null,
  JobsPanel: () => null,
  SpareBagPanel: () => null,
  BusinessPanel: () => null,
}));
jest.mock("@/features/feed/components/media-image", () => ({ MediaImage: () => null }));

function defaultSession() {
  return {
    me: { id: "user-1", email: "sara@example.com" },
    profile: { displayName: "Sara T.", username: "sara", avatarMediaId: null },
    memberships: [{ communityId: "community-1", role: "MEMBER" }],
    activeCommunityId: "community-1",
  };
}

function makePoll(overrides: Partial<Poll> = {}): Poll {
  return {
    postId: "post-1",
    question: "Which venue?",
    status: "ACTIVE",
    closesAt: null,
    closedAt: null,
    allowMultiple: false,
    allowVoteChange: false,
    allowVoteWithdraw: false,
    anonymousVoting: false,
    maxOptions: 10,
    resultsVisibility: "IMMEDIATE",
    resultsVisible: true,
    totalVoters: 0,
    totalVotes: 0,
    myVotes: [],
    options: [
      { id: "option-1", text: "Hall", sortOrder: 0, voteCount: 0, percentage: 0 },
      { id: "option-2", text: "Park", sortOrder: 1, voteCount: 0, percentage: 0 },
    ],
    ...overrides,
  };
}

function makePost(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: "post-1",
    authorId: "user-1",
    communityId: "community-1",
    countryId: "country-1",
    postType: "POLL",
    status: "PUBLISHED",
    scope: "COMMUNITY",
    title: null,
    body: "Which venue?",
    linkUrl: null,
    categoryId: "category-1",
    commentsEnabled: true,
    commentCount: 0,
    reactionCount: 0,
    publishedAt: "2026-11-03T10:00:00Z",
    createdAt: "2026-11-03T10:00:00Z",
    ...overrides,
  };
}

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    itemId: "FEED_POST:post-1",
    contentType: "POLL",
    sourceModule: "feed",
    sourceId: "post-1",
    author: {
      id: "user-1",
      username: "sara",
      displayName: "Sara T.",
      accountStatus: "ACTIVE",
      profileCompleted: true,
      avatarMediaId: null,
    },
    communityId: "community-1",
    publishedAt: "2026-11-03T10:00:00Z",
    title: null,
    body: "Which venue?",
    mediaIds: [],
    commentCount: 0,
    reactionCount: 0,
    viewerReaction: null,
    viewed: false,
    saved: false,
    payload: { categoryId: "category-1", categoryName: "Social", poll: makePoll() },
    ...overrides,
  };
}

function mount(component: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 0, left: 0, right: 0, bottom: 0 },
    }}>
      {component}
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockSession = defaultSession();
  mockFeedState.items = [makeFeedItem()];
  mockFeedApi.communityDetail.mockResolvedValue({ destinationCountryId: "country-1" });
  mockFeedApi.feedCategories.mockResolvedValue({ items: [
    { id: "category-1", countryId: "country-1", name: "Social", slug: "social", active: true },
    { id: "category-2", countryId: "country-1", name: "Archived", slug: "archived", active: false },
  ] });
  mockFeedApi.createPoll.mockResolvedValue(makePoll());
  mockFeedApi.getPost.mockResolvedValue(makePost());
  mockFeedApi.getPoll.mockResolvedValue(makePoll());
  mockFeedApi.updatePoll.mockResolvedValue(makePoll({ question: "Updated question?" }));
  mockFeedApi.updatePost.mockResolvedValue(makePost());
  mockFeedApi.vote.mockResolvedValue(makePoll({ myVotes: ["option-1"], totalVoters: 1, totalVotes: 1 }));
  mockFeedApi.closePoll.mockResolvedValue(makePoll({ status: "CLOSED", closedAt: "2026-11-03T12:00:00Z" }));
  mockFeedApi.reportPost.mockResolvedValue({ reportId: "report-1" });
  mockFeedApi.comments.mockResolvedValue({ items: [], nextCursor: null });
  mockFeedApi.authorSummaries.mockResolvedValue([]);
});

afterEach(() => jest.restoreAllMocks());

describe("Poll creation and deep link", () => {
  it("opens directly in Poll mode and submits the complete typed request", async () => {
    mockParams = { mode: "poll" };
    await mount(<CreatePostScreen />);

    expect(await screen.findByLabelText("Category Social")).toBeTruthy();
    expect(screen.queryByLabelText("Category Archived")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Category Social"));
    await fireEvent.changeText(screen.getByLabelText("Question (required)"), "  Which venue?  ");
    await fireEvent.changeText(screen.getByLabelText("Option 1 (required)"), " Hall ");
    await fireEvent.changeText(screen.getByLabelText("Option 2 (required)"), " Park ");
    await fireEvent(screen.getByLabelText("Allow multiple selections"), "valueChange", true);
    await fireEvent(screen.getByLabelText("Allow vote changes"), "valueChange", true);
    await fireEvent.press(screen.getByLabelText("Results immediate"));
    await fireEvent.press(screen.getByLabelText("Publish post"));

    await waitFor(() => expect(mockFeedApi.createPoll).toHaveBeenCalledWith(expect.objectContaining({
      communityId: "community-1",
      categoryId: "category-1",
      question: "Which venue?",
      options: ["Hall", "Park"],
      maxOptions: 10,
      allowMultiple: true,
      allowVoteChange: true,
      allowVoteWithdraw: false,
      anonymousVoting: false,
      resultsVisibility: "IMMEDIATE",
    })));
    await waitFor(() => expect(mockSafeBack).toHaveBeenCalled());
  });

  it("blocks creation without a FEED category", async () => {
    mockParams = { mode: "poll" };
    await mount(<CreatePostScreen />);

    await screen.findByLabelText("Category Social");
    await fireEvent.changeText(screen.getByLabelText("Question (required)"), "Which venue?");
    await fireEvent.changeText(screen.getByLabelText("Option 1 (required)"), "Hall");
    await fireEvent.changeText(screen.getByLabelText("Option 2 (required)"), "Park");
    await fireEvent.press(screen.getByLabelText("Publish post"));

    expect(await screen.findByText("Choose a FEED category.")).toBeTruthy();
    expect(mockFeedApi.createPoll).not.toHaveBeenCalled();
  });

  it("retains entered values after a failed creation", async () => {
    mockParams = { mode: "poll" };
    mockFeedApi.createPoll.mockRejectedValue(new Error("network"));
    await mount(<CreatePostScreen />);

    await screen.findByLabelText("Category Social");
    await fireEvent.press(screen.getByLabelText("Category Social"));
    await fireEvent.changeText(screen.getByLabelText("Question (required)"), "Keep this question");
    await fireEvent.changeText(screen.getByLabelText("Option 1 (required)"), "Hall");
    await fireEvent.changeText(screen.getByLabelText("Option 2 (required)"), "Park");
    await fireEvent.press(screen.getByLabelText("Publish post"));

    expect(await screen.findByText("Failed to post.")).toBeTruthy();
    expect(screen.getByLabelText("Question (required)").props.value).toBe("Keep this question");
    expect(screen.getByLabelText("Option 1 (required)").props.value).toBe("Hall");
    expect(mockSafeBack).not.toHaveBeenCalled();
  });
});

describe("Poll editing", () => {
  beforeEach(() => { mockParams = { id: "post-1" }; });

  it("loads Poll detail and saves question and configuration before votes", async () => {
    await mount(<EditPostScreen />);

    expect(await screen.findByText("Edit poll")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Question (required)"), "Updated question?");
    await fireEvent.press(screen.getByLabelText("Save changes"));

    await waitFor(() => expect(mockFeedApi.updatePoll).toHaveBeenCalledWith("post-1",
      expect.objectContaining({ question: "Updated question?", options: ["Hall", "Park"], maxOptions: 10 })));
    expect(mockFeedApi.getPoll).toHaveBeenCalledWith("post-1");
    expect(await screen.findByText("Saved ✓")).toBeTruthy();
    await waitFor(() => expect(mockSafeBack).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("omits locked options and policies after the first vote", async () => {
    mockFeedApi.getPoll.mockResolvedValue(makePoll({ totalVoters: 1, totalVotes: 1 }));
    await mount(<EditPostScreen />);

    expect(await screen.findByText(/locked after the first vote/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Question (required)"), "Question only");
    await fireEvent.press(screen.getByLabelText("Save changes"));

    await waitFor(() => expect(mockFeedApi.updatePoll).toHaveBeenCalled());
    const request = mockFeedApi.updatePoll.mock.calls[0][1] as Record<string, unknown>;
    expect(request.question).toBe("Question only");
    expect(request).not.toHaveProperty("options");
    expect(request).not.toHaveProperty("allowMultiple");
    await waitFor(() => expect(mockSafeBack).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("locks configuration after an authoritative conflict when results hid prior votes", async () => {
    mockFeedApi.getPoll.mockResolvedValue(makePoll({
      resultsVisible: false,
      totalVoters: null,
      totalVotes: null,
    }));
    mockFeedApi.updatePoll.mockRejectedValue(new ApiError({
      code: "VALIDATION_ERROR",
      httpStatus: 409,
      userMessage: "Options are locked after voting starts.",
    }));
    await mount(<EditPostScreen />);

    await screen.findByText("Edit poll");
    await fireEvent.press(screen.getByLabelText("Save changes"));

    expect(await screen.findByText("Options are locked after voting starts.")).toBeTruthy();
    expect(screen.getByText(/locked after the first vote/)).toBeTruthy();
    expect(screen.getByLabelText("Option 1 (required)")).not.toBeEnabled();
  });

  it("makes closed Polls read-only and hides saving", async () => {
    mockFeedApi.getPoll.mockResolvedValue(makePoll({ status: "CLOSED" }));
    await mount(<EditPostScreen />);

    expect(await screen.findByText("Closed or expired polls are read-only.")).toBeTruthy();
    expect(screen.queryByLabelText("Save changes")).toBeNull();
    expect(mockFeedApi.updatePoll).not.toHaveBeenCalled();
  });

  it("allows a matching community moderator to edit another author's Poll", async () => {
    mockSession = {
      ...defaultSession(),
      memberships: [{ communityId: "community-1", role: "COMMUNITY_ADMIN" }],
    };
    mockFeedApi.getPost.mockResolvedValue(makePost({ authorId: "author-2" }));
    await mount(<EditPostScreen />);

    expect(await screen.findByText("Edit poll")).toBeTruthy();
    expect(screen.queryByText("You can only edit your own posts.")).toBeNull();
  });
});

describe("Feed Poll workflows", () => {
  it("renders a Poll once and applies vote responses in place", async () => {
    await mount(<HomeFeedScreen />);

    expect(screen.getAllByText("Which venue?")).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText("Hall"));
    await fireEvent.press(screen.getByLabelText("Submit vote"));

    await waitFor(() => expect(mockFeedApi.vote).toHaveBeenCalledWith("option-1", false));
    expect(mockFeedState.updatePost).toHaveBeenCalledWith("post-1", {
      payload: expect.objectContaining({ poll: expect.objectContaining({ myVotes: ["option-1"] }) }),
    });
    expect(mockFeedState.refresh).not.toHaveBeenCalled();
  });

  it("routes the Poll feature to the Poll composer deep link", async () => {
    await mount(<HomeFeedScreen />);
    await fireEvent.press(screen.getByLabelText("Polls"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/posts/create?mode=poll");
  });

  it("requires confirmation before closing and updates the existing Feed item", async () => {
    await mount(<HomeFeedScreen />);

    await fireEvent.press(screen.getByLabelText("Post options"));
    await fireEvent.press(screen.getByLabelText("Close poll"));
    expect(screen.getByText("Close this poll? This cannot be undone.")).toBeTruthy();
    expect(mockFeedApi.closePoll).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Confirm close poll"));

    await waitFor(() => expect(mockFeedApi.closePoll).toHaveBeenCalledWith("post-1"));
    expect(mockFeedState.updatePost).toHaveBeenCalledWith("post-1", {
      payload: expect.objectContaining({ poll: expect.objectContaining({ status: "CLOSED" }) }),
    });
  });

  it("requires confirmation before deleting through the existing post workflow", async () => {
    await mount(<HomeFeedScreen />);

    await fireEvent.press(screen.getByLabelText("Post options"));
    await fireEvent.press(screen.getByLabelText("Delete post"));
    expect(mockFeedState.deletePost).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Confirm delete"));

    expect(mockFeedState.deletePost).toHaveBeenCalledWith("post-1");
  });

  it("offers reporting to non-owners through shared moderation reasons", async () => {
    const item = makeFeedItem();
    mockFeedState.items = [{ ...item, author: item.author && { ...item.author, id: "author-2" } }];
    jest.spyOn(Alert, "alert").mockImplementation((title, _message, buttons) => {
      if (title === "Report poll") buttons?.find((button) => button.text === "scam")?.onPress?.();
    });
    await mount(<HomeFeedScreen />);

    await fireEvent.press(screen.getByLabelText("Post options"));
    expect(screen.queryByLabelText("Close poll")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Report poll"));

    await waitFor(() => expect(mockFeedApi.reportPost).toHaveBeenCalledWith("post-1", { reason: "SCAM" }));
  });
});

describe("Poll detail workflows", () => {
  beforeEach(() => { mockParams = { id: "post-1" }; });

  it("loads Poll detail, preserves comments and submits votes", async () => {
    await mount(<PostDetailScreen />);

    expect(await screen.findByText("Which venue?")).toBeTruthy();
    expect(screen.getByText("No replies yet. Be the first.")).toBeTruthy();
    expect(mockFeedApi.getPoll).toHaveBeenCalledWith("post-1");
    await fireEvent.press(screen.getByLabelText("Hall"));
    await fireEvent.press(screen.getByLabelText("Submit vote"));

    await waitFor(() => expect(mockFeedApi.vote).toHaveBeenCalledWith("option-1", false));
  });

  it("does not request Poll detail for an ordinary post", async () => {
    mockFeedApi.getPost.mockResolvedValue(makePost({ postType: "GENERAL", body: "Ordinary body" }));
    await mount(<PostDetailScreen />);

    expect(await screen.findByText("Ordinary body")).toBeTruthy();
    expect(mockFeedApi.getPoll).not.toHaveBeenCalled();
    expect(screen.queryByTestId("poll-card")).toBeNull();
  });
});
