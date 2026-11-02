import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import JobApplyScreen from "@/features/jobs/screens/job-apply-screen";
import JobApplicationsScreen from "@/features/jobs/screens/job-applications-screen";
import JobApplicationDetailScreen from "@/features/jobs/screens/job-application-detail-screen";
import type { JobApplication, JobDetail, JobRow } from "@/features/jobs/types/job-types";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) };
const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };
const mockGetDocument = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: (options: unknown) => mockGetDocument(options),
}));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({ apiClient: mockClient, session: { activeCommunityId: "community-1" } }),
}));

const JOB: JobRow = {
  id: "job-1", countryId: "country-1", communityId: "community-1", visibilityScope: "COMMUNITY",
  employerUserId: "owner-1", postedByUserId: "owner-1", businessAccountId: null, businessId: null,
  sourceType: "EMPLOYER_DIRECT", sourceName: null, sourceUrl: null,
  employerName: "Diasporum", title: "Backend engineer", description: "Build community services",
  employmentType: "PERMANENT", workHoursType: "FULL_TIME", workSchedule: "DAY", workplaceType: "REMOTE",
  workplaceAddressId: null, salaryMin: null, salaryMax: null, salaryCurrency: null,
  applicationMethod: "INTERNAL", applicationUrl: null, closesAt: null, status: "PUBLISHED",
  verifiedEmployer: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  publishedAt: "2026-10-01T00:00:00Z", deletedAt: null,
};
const DETAIL: JobDetail = {
  job: JOB, categories: [], location: null, mediaIds: [], saved: false, canManage: false,
  myApplicationId: null, myApplicationStatus: null, owner: null, businessAccountName: null,
};

function makeApplication(overrides: Partial<JobApplication["application"]> = {}): JobApplication {
  return {
    application: {
      id: "application-1", jobId: "job-1", applicantId: "applicant-1", resumeMediaId: null,
      coverLetter: "I would love to contribute.", status: "SUBMITTED",
      submittedAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z",
      ...overrides,
    },
    job: JOB,
    applicant: {
      id: "applicant-1", username: "abel", displayName: "Abel T.", accountStatus: "ACTIVE",
      profileCompleted: true, originCountryId: "country-2", currentCountryId: "country-1",
    },
    canManage: false,
    canWithdraw: true,
  };
}

let currentApplication = makeApplication();

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  currentApplication = makeApplication();
  mockGetDocument.mockResolvedValue({ canceled: true, assets: [] });
  jest.spyOn(Linking, "openURL").mockImplementation(() => Promise.resolve());
  mockClient.get.mockImplementation((url: string) => {
    if (url === "/api/v1/jobs/job-1") return Promise.resolve(DETAIL);
    if (url === "/api/v1/job-applications/application-1") return Promise.resolve(currentApplication);
    if (url === "/api/v1/job-applications/application-1/resume/download-url") {
      return Promise.resolve({ downloadUrl: "https://files.example.com/resume" });
    }
    if (url.startsWith("/api/v1/me/job-applications") || url.startsWith("/api/v1/jobs/job-1/applications?")) {
      return Promise.resolve({ items: [currentApplication], nextCursor: null });
    }
    return Promise.resolve({ items: [], nextCursor: null });
  });
  mockClient.post.mockImplementation((url: string) => {
    if (url.endsWith("/withdraw")) {
      currentApplication = makeApplication({ status: "WITHDRAWN" });
      return Promise.resolve(currentApplication);
    }
    return Promise.resolve(currentApplication);
  });
  mockClient.patch.mockImplementation((_url: string, body: { status: JobApplication["application"]["status"] }) => {
    currentApplication = makeApplication({ status: body.status });
    return Promise.resolve(currentApplication);
  });
  mockClient.delete.mockResolvedValue({});
});

function renderScreen(component: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={{
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  }}>{component}</SafeAreaProvider>);
}

describe("Internal job application", () => {
  beforeEach(() => { mockParams = { id: "job-1" }; });

  it("submits a cover letter and opens the application detail", async () => {
    await renderScreen(<JobApplyScreen />);
    await fireEvent.changeText(await screen.findByLabelText("Cover letter"), "  I am interested.  ");
    await fireEvent.press(screen.getByLabelText("Submit application"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/jobs/job-1/applications", {
      coverLetter: "I am interested.",
    }, { authenticated: true }));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/jobs/application/application-1");
  });

  it("uploads an authorized DOCUMENT résumé before applying", async () => {
    mockGetDocument.mockResolvedValue({ canceled: false, assets: [{
      uri: "file:///resume.pdf", name: "resume.pdf", mimeType: "application/pdf",
    }] });
    mockClient.post.mockImplementation((url: string) => {
      if (url === "/api/v1/media/uploads") {
        return Promise.resolve({ assetId: "resume-1", uploadUrl: "https://upload.example.com/signed" });
      }
      if (url.endsWith("/complete")) return Promise.resolve({});
      return Promise.resolve(currentApplication);
    });
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, blob: async () => ({ size: 1234 }) })
      .mockResolvedValueOnce({ ok: true });
    globalThis.fetch = fetchMock as never;

    await renderScreen(<JobApplyScreen />);
    await fireEvent.press(await screen.findByLabelText("Choose résumé"));
    expect(await screen.findByText("resume.pdf")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Submit application"));

    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/jobs/job-1/applications", {
      resumeMediaId: "resume-1",
    }, { authenticated: true }));
    expect(mockClient.post).toHaveBeenCalledWith("/api/v1/media/uploads", {
      purpose: "DOCUMENT", mimeType: "application/pdf", declaredSizeBytes: 1234,
    }, { authenticated: true });
    expect(fetchMock).toHaveBeenCalledWith("https://upload.example.com/signed", expect.objectContaining({ method: "PUT" }));
  });
});

describe("Application collections and detail", () => {
  it("lists and opens the applicant's applications", async () => {
    await renderScreen(<JobApplicationsScreen mode="mine" />);
    await fireEvent.press(await screen.findByLabelText("Application for Backend engineer"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/jobs/application/application-1");
  });

  it("filters employer applications by status", async () => {
    mockParams = { id: "job-1" };
    await renderScreen(<JobApplicationsScreen mode="employer" />);
    expect(await screen.findByLabelText("Application from Abel T.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Shortlisted"));
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(
      "/api/v1/jobs/job-1/applications?status=SHORTLISTED&size=20", { authenticated: true },
    ));
  });

  it("withdraws an active application after confirmation", async () => {
    mockParams = { id: "application-1" };
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === "Withdraw")?.onPress?.();
    });
    await renderScreen(<JobApplicationDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Withdraw application"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith(
      "/api/v1/job-applications/application-1/withdraw", undefined, { authenticated: true },
    ));
    expect(await screen.findByText("Withdrawn")).toBeTruthy();
  });

  it("advances an employer review through a valid transition", async () => {
    mockParams = { id: "application-1" };
    currentApplication = { ...makeApplication(), canManage: true, canWithdraw: false };
    await renderScreen(<JobApplicationDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Mark as viewed"));
    await waitFor(() => expect(mockClient.patch).toHaveBeenCalledWith(
      "/api/v1/job-applications/application-1", { status: "VIEWED" }, { authenticated: true },
    ));
    expect(await screen.findByText("Viewed")).toBeTruthy();
  });

  it("shows backend authorization failures and keeps the current status", async () => {
    mockParams = { id: "application-1" };
    currentApplication = { ...makeApplication(), canManage: true, canWithdraw: false };
    mockClient.patch.mockRejectedValue(new Error("forbidden"));
    await renderScreen(<JobApplicationDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Mark as viewed"));
    expect(await screen.findByText("The action could not be completed.")).toBeTruthy();
    expect(screen.getByText("Submitted")).toBeTruthy();
  });

  it("uses an authorized download URL to view a résumé", async () => {
    mockParams = { id: "application-1" };
    currentApplication = makeApplication({ resumeMediaId: "resume-1" });
    await renderScreen(<JobApplicationDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("View résumé"));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith("https://files.example.com/resume"));
  });
});
