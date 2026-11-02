import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import JobsScreen from "@/features/jobs/screens/jobs-screen";
import JobDetailScreen from "@/features/jobs/screens/job-detail-screen";
import JobEditorScreen from "@/features/jobs/screens/job-editor-screen";
import JobCollectionScreen from "@/features/jobs/screens/job-collection-screen";
import type { JobCategory, JobDetail, JobItem, JobRow } from "@/features/jobs/types/job-types";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) };
const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: { activeCommunityId: "community-1", me: { id: "viewer-1" } },
  }),
}));

const CATEGORY: JobCategory = {
  id: "category-1", countryId: null, parentId: null, categoryKey: "technology",
  categoryType: "JOB", displayName: "Technology", description: null, sortOrder: 1,
};

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1", countryId: "country-1", communityId: "community-1", visibilityScope: "COMMUNITY",
    employerUserId: "owner-1", postedByUserId: "owner-1", businessAccountId: null, businessId: null,
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

function makeItem(overrides: Partial<Omit<JobItem, "job">> = {}, job: Partial<JobRow> = {}): JobItem {
  return {
    job: makeJob(job), categories: [CATEGORY], location: { city: "Frankfurt", region: "Hesse", formattedAddress: null },
    mediaIds: [], saved: false, canManage: false, myApplicationId: null, myApplicationStatus: null,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<Omit<JobDetail, "job">> = {}, job: Partial<JobRow> = {}): JobDetail {
  return { ...makeItem(overrides, job), owner: null, businessAccountName: null };
}

let currentDetail = makeDetail();

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  currentDetail = makeDetail();
  jest.spyOn(Linking, "openURL").mockImplementation(() => Promise.resolve());
  mockClient.get.mockImplementation((url: string) => {
    if (url === "/api/v1/jobs/categories") return Promise.resolve({ items: [CATEGORY] });
    if (url === "/api/v1/business-accounts") return Promise.resolve({ items: [] });
    if (url.startsWith("/api/v1/jobs?")) {
      return Promise.resolve(url.includes("cursor=next")
        ? { items: [makeItem({}, { id: "job-2", title: "Mobile engineer" })], nextCursor: null }
        : { items: [makeItem()], nextCursor: "next" });
    }
    if (url === "/api/v1/jobs/job-1") return Promise.resolve(currentDetail);
    if (url.startsWith("/api/v1/me/jobs")) return Promise.resolve({ items: [makeItem()], nextCursor: null });
    return Promise.resolve({ items: [], nextCursor: null });
  });
  mockClient.post.mockImplementation((url: string) => {
    if (url === "/api/v1/conversations") return Promise.resolve({ id: "conversation-1" });
    return Promise.resolve(currentDetail);
  });
  mockClient.put.mockResolvedValue({});
  mockClient.patch.mockImplementation(() => Promise.resolve(currentDetail));
  mockClient.delete.mockResolvedValue({});
});

function renderScreen(component: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={{
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  }}>{component}</SafeAreaProvider>);
}

describe("Jobs discovery", () => {
  it("renders results, applies debounced search, and loads the next cursor", async () => {
    await renderScreen(<JobsScreen />);
    expect(await screen.findByText("Backend engineer")).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText("Search title, employer or description"), "nurse");
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(
      expect.stringContaining("search=nurse"), { authenticated: true },
    ));

    await fireEvent(screen.getByTestId("jobs-discovery-list"), "onEndReached");
    expect(await screen.findByText("Mobile engineer")).toBeTruthy();
    expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining("cursor=next"), { authenticated: true });
  }, 15000);

  it("shows empty and error states", async () => {
    mockClient.get.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/jobs?")) return Promise.resolve({ items: [], nextCursor: null });
      return Promise.resolve({ items: [] });
    });
    const view = await renderScreen(<JobsScreen />);
    expect(await screen.findByText("No jobs found")).toBeTruthy();
    await view.unmount();

    mockClient.get.mockImplementation((url: string) => url.startsWith("/api/v1/jobs?")
      ? Promise.reject(new Error("offline")) : Promise.resolve({ items: [] }));
    await renderScreen(<JobsScreen />);
    expect(await screen.findByText("Failed to load jobs.")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});

describe("Job details", () => {
  beforeEach(() => { mockParams = { id: "job-1" }; });

  it("saves and unsaves a job", async () => {
    await renderScreen(<JobDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Save job"));
    await waitFor(() => expect(mockClient.put).toHaveBeenCalledWith(
      "/api/v1/jobs/job-1/save", {}, { authenticated: true },
    ));
    await fireEvent.press(await screen.findByLabelText("Unsave job"));
    await waitFor(() => expect(mockClient.delete).toHaveBeenCalledWith(
      "/api/v1/jobs/job-1/save", { authenticated: true },
    ));
  });

  it("opens external applications without creating an application row", async () => {
    currentDetail = makeDetail({}, { applicationMethod: "EXTERNAL", applicationUrl: "https://example.com/apply" });
    await renderScreen(<JobDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Apply on external website"));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith("https://example.com/apply"));
    expect(mockClient.post).not.toHaveBeenCalledWith(
      "/api/v1/jobs/job-1/applications", expect.anything(), expect.anything(),
    );
  });

  it("creates a JOB_LISTING conversation through existing messaging", async () => {
    await renderScreen(<JobDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Contact employer"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/conversations", {
      contextType: "JOB_LISTING", contextId: "job-1", recipientUserId: "owner-1",
    }, { authenticated: true }));
    expect(mockRouter.push).toHaveBeenCalledWith("/messages/conversation-1");
  });

  it("exposes owner lifecycle and application management", async () => {
    currentDetail = makeDetail({ canManage: true });
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === "Close")?.onPress?.();
    });
    await renderScreen(<JobDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Review applications"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/jobs/applications/job-1");
    await fireEvent.press(screen.getByLabelText("Close listing"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith(
      "/api/v1/jobs/job-1/close", undefined, { authenticated: true },
    ));
  });
});

describe("Job editor and collections", () => {
  it("validates and creates a job", async () => {
    await renderScreen(<JobEditorScreen />);
    await fireEvent.press(await screen.findByText("Technology"));
    await fireEvent.changeText(screen.getByPlaceholderText("Employer name"), "Diasporum");
    await fireEvent.press(screen.getByLabelText("Publish job"));
    expect(await screen.findByText("Enter a job title.")).toBeTruthy();
    expect(mockClient.post).not.toHaveBeenCalledWith("/api/v1/jobs", expect.anything(), expect.anything());

    await fireEvent.changeText(screen.getByPlaceholderText("Job title"), "Backend engineer");
    await fireEvent.changeText(screen.getByPlaceholderText("Description"), "Build community services");
    await fireEvent.changeText(screen.getByPlaceholderText("City"), "Frankfurt");
    await fireEvent.press(screen.getByLabelText("Publish job"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/jobs",
      expect.objectContaining({ title: "Backend engineer", categoryIds: ["category-1"], draft: false }),
      { authenticated: true }));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/jobs/job-1");
  });

  it("omits immutable category IDs when editing a published job", async () => {
    mockParams = { id: "job-1" };
    currentDetail = makeDetail({ canManage: true });
    await renderScreen(<JobEditorScreen edit />);
    expect(await screen.findByDisplayValue("Backend engineer")).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText("Job title"), "Senior backend engineer");
    await fireEvent.press(screen.getByLabelText("Save changes"));
    await waitFor(() => expect(mockClient.patch).toHaveBeenCalledWith(
      "/api/v1/jobs/job-1", expect.objectContaining({ title: "Senior backend engineer" }), { authenticated: true },
    ));
    const request = mockClient.patch.mock.calls[0][1] as Record<string, unknown>;
    expect(request).not.toHaveProperty("categoryIds");
  });

  it.each([{ mode: "my" as const, title: "My job listings" }, { mode: "saved" as const, title: "Saved jobs" }])(
    "loads $title", async ({ mode, title }) => {
      await renderScreen(<JobCollectionScreen mode={mode} />);
      expect(await screen.findByText(title)).toBeTruthy();
      expect(await screen.findByText("Backend engineer")).toBeTruthy();
    },
  );
});
