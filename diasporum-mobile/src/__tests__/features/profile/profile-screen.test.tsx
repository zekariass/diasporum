import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import ProfileScreen from "@/features/profile/screens/profile-screen";
import type { FeedItem } from "@/features/feed/types/feed-types";
import type { JobCategory, JobItem, JobRow } from "@/features/jobs/types/job-types";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) };
const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: mockSession,
  }),
}));
jest.mock("@/features/feed/components/media-image", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    MediaImage: () => React.createElement(View),
    clearMediaCache: jest.fn(),
  };
});

const mockSession = {
  me: { id: "user-1", email: "amani@test.com", accountStatus: "ACTIVE", emailVerifiedAt: null },
  profile: {
    id: "user-1", username: "amani", displayName: "Amani Tesfaye",
    bio: "Connecting the diaspora", city: "Berlin", dateOfBirth: null,
    originCountryId: "origin-1", currentCountryId: "dest-1",
    accountStatus: "ACTIVE", profileCompleted: true, avatarMediaId: null,
  },
  memberships: [],
  activeCommunityId: "community-1",
};

const POST: FeedItem = {
  itemId: "FEED_POST:post-1", contentType: "GENERAL", sourceModule: "feed",
  sourceId: "post-1",
  author: {
    id: "user-1", username: "amani", displayName: "Amani Tesfaye",
    accountStatus: "ACTIVE", profileCompleted: true, avatarMediaId: null,
  },
  communityId: "community-1", publishedAt: "2026-10-01T10:00:00Z",
  title: null, body: "Hello Diaspora", mediaIds: [],
  commentCount: 2, reactionCount: 5, shareCount: 0, viewerReaction: null,
  viewed: false, saved: false, payload: {},
  media: [], tags: [],
};

const CATEGORY: JobCategory = {
  id: "category-1", countryId: null, parentId: null, categoryKey: "technology",
  categoryType: "JOB", displayName: "Technology", description: null, sortOrder: 1,
};

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1", countryId: "country-1", communityId: "community-1", visibilityScope: "COMMUNITY",
    employerUserId: "user-1", postedByUserId: "user-1", businessAccountId: null, businessId: null,
    sourceType: "EMPLOYER_DIRECT", sourceName: null, sourceUrl: null,
    employerName: "Diasporum", title: "Backend engineer", description: "Build community services",
    employmentType: "PERMANENT", workHoursType: "FULL_TIME", workSchedule: "DAY", workplaceType: "HYBRID",
    workplaceAddressId: null, salaryMin: "3000", salaryMax: "4500", salaryCurrency: "EUR",
    applicationMethod: "INTERNAL", applicationUrl: null, closesAt: "2027-12-31T23:59:59Z",
    status: "PUBLISHED", verifiedEmployer: false, createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z", publishedAt: "2026-10-01T00:00:00Z", deletedAt: null,
    ...overrides,
  };
}

const JOB: JobItem = {
  job: makeJob(), categories: [CATEGORY],
  location: { city: "Frankfurt", region: "Hesse", formattedAddress: null },
  mediaIds: [], saved: false, canManage: true,
  myApplicationId: null, myApplicationStatus: null,
};

async function renderScreen() {
  return await render(
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 0, left: 0, right: 0, bottom: 0 },
    }}>
      <ProfileScreen />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.get.mockImplementation((url: string) => {
    if (url.startsWith("/api/v1/feed/mine")) {
      return Promise.resolve({ items: [POST], nextCursor: null, total: 4 });
    }
    if (url.startsWith("/api/v1/social/followers")) {
      return Promise.resolve({ items: [], total: 7, page: 0, size: 1 });
    }
    if (url.startsWith("/api/v1/social/following")) {
      return Promise.resolve({ items: [], total: 3, page: 0, size: 1 });
    }
    if (url.startsWith("/api/v1/me/jobs")) {
      return Promise.resolve({ items: [JOB], nextCursor: null });
    }
    if (url.startsWith("/api/v1/me/events")) {
      return Promise.resolve({ items: [], page: 0, size: 20 });
    }
    return Promise.resolve({ items: [], nextCursor: null });
  });
  mockClient.post.mockResolvedValue({});
  mockClient.put.mockResolvedValue({});
  mockClient.patch.mockResolvedValue({});
  mockClient.delete.mockResolvedValue({});
});

describe("ProfileScreen", () => {
  it("renders identity, stats and the default Posts tab", async () => {
    await renderScreen();

    await waitFor(
      () =>
        expect(mockClient.get).toHaveBeenCalledWith(
          "/api/v1/feed/mine?size=20",
          { authenticated: true },
        ),
      { timeout: 4000 },
    );

    // Identity — display name also appears as the post author, so expect ≥1
    expect(await screen.findAllByText("Amani Tesfaye", {}, { timeout: 4000 })).not.toHaveLength(0);
    expect(screen.getByText("@amani")).toBeTruthy();
    expect(screen.getByText("Berlin")).toBeTruthy();
    expect(screen.getByText("Connecting the diaspora")).toBeTruthy();

    // Stats — real totals from the APIs ("4" shows in the stats row and
    // again as the "My Posts" section badge, so query all matches)
    expect((await screen.findAllByText("4", {}, { timeout: 4000 })).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("7")).toBeTruthy(); // followers
    expect(screen.getByText("3")).toBeTruthy(); // following

    // Default tab content
    expect(await screen.findByText("Hello Diaspora", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText("My Posts")).toBeTruthy();
  });

  it("opens edit profile, settings and the business workspace", async () => {
    await renderScreen();
    await screen.findByText("Amani Tesfaye", {}, { timeout: 4000 });

    await fireEvent.press(screen.getByLabelText("Edit profile"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/profile/edit");

    await fireEvent.press(screen.getByLabelText("Settings"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/settings/security");

    await fireEvent.press(screen.getByLabelText("Open Business Workspace"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/business");
  });

  it("lazy-loads the Jobs tab and renders the job listing", async () => {
    await renderScreen();
    await screen.findByText("Hello Diaspora", {}, { timeout: 4000 });

    expect(mockClient.get).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/me/jobs"), expect.anything(),
    );

    await fireEvent.press(screen.getByLabelText("Jobs tab"));

    await waitFor(
      () =>
        expect(mockClient.get).toHaveBeenCalledWith(
          "/api/v1/me/jobs?size=20",
          { authenticated: true },
        ),
      { timeout: 4000 },
    );
    expect(await screen.findByText("Backend engineer", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText("My Jobs")).toBeTruthy();
  });

  it("requests media-filtered posts for the Media tab", async () => {
    await renderScreen();
    await screen.findByText("Hello Diaspora", {}, { timeout: 4000 });

    await fireEvent.press(screen.getByLabelText("Media tab"));

    await waitFor(
      () =>
        expect(mockClient.get).toHaveBeenCalledWith(
          "/api/v1/feed/mine?size=20&hasMedia=true",
          { authenticated: true },
        ),
      { timeout: 4000 },
    );
  });

  it("shows an empty state for a tab with no content", async () => {
    await renderScreen();
    await screen.findByText("Hello Diaspora", {}, { timeout: 4000 });

    await fireEvent.press(screen.getByLabelText("Events tab"));

    await waitFor(
      () =>
        expect(mockClient.get).toHaveBeenCalledWith(
          "/api/v1/me/events?role=organized&page=0&size=20",
          { authenticated: true },
        ),
      { timeout: 4000 },
    );
    expect(await screen.findByText("No events yet", {}, { timeout: 4000 })).toBeTruthy();
  });
});
