import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import ReviewEditorScreen from "@/features/services/screens/review-editor-screen";
import ServicesScreen from "@/features/services/screens/services-screen";
import ResponseCollectionScreen from "@/features/services/screens/response-collection-screen";
import RequestDetailScreen from "@/features/services/screens/request-detail-screen";
import RequestEditorScreen, {
  validateRequestForm,
  type RequestFormState,
} from "@/features/services/screens/request-editor-screen";
import type { ProviderResponse, ServiceRequest } from "@/features/services/types/service-marketplace-types";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockClient = {
  get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(),
};
let mockParams: Record<string, string> = {};
let mockSession: { profile?: { currentCountryId?: string } } | null = null;

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({ apiClient: mockClient, session: mockSession }),
}));

const request = {
  id: "request-1", customerUserId: "customer-1", customerDisplayName: "Customer",
  serviceCategoryId: "category-1", categoryDisplayName: "Test service", countryId: "country-1",
  addressId: null, latitude: 52.52, longitude: 13.405, title: "Request", description: "Description",
  budgetMin: null, budgetMax: null, currencyCode: null, preferredDate: null, status: "OPEN",
  expiresAt: null, publishedAt: "2026-01-01T00:00:00Z", mediaIds: [], distanceMeters: null,
  canManage: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
} satisfies ServiceRequest;
const response = {
  id: "response-1", serviceRequestId: "request-1", serviceProviderId: "provider-1",
  providerDisplayName: "Provider", respondedByUserId: "provider-user-1", responseType: "INTEREST",
  message: "I can help", quotedAmount: null, currencyCode: null, status: "SENT",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
} satisfies ProviderResponse;

async function renderScreen(component: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={{
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  }}>{component}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockSession = null;
  mockClient.get.mockResolvedValue({ items: [], nextCursor: null });
  mockClient.post.mockResolvedValue({});
});

describe("Service Marketplace mobile workflows", () => {
  it("submits an interaction-backed review and returns to the provider", async () => {
    mockParams = { id: "request-1", providerId: "provider-1" };
    await renderScreen(<ReviewEditorScreen />);
    await fireEvent.press(screen.getByText("5 stars"));
    await fireEvent.changeText(screen.getByLabelText("Review text"), "  Clear communication  ");
    await fireEvent.press(screen.getByText("Publish review"));

    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith(
      "/api/v1/service/requests/request-1/reviews", {
        serviceProviderId: "provider-1", rating: 5, reviewText: "Clear communication",
      }, { authenticated: true },
    ));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/services/providers/provider-1");
  });

  it("loads the Services hub and navigates to request creation", async () => {
    await renderScreen(<ServicesScreen />);
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(
      "/api/v1/service/providers?sort=NEWEST&size=20", { authenticated: true },
    ));
    await fireEvent.press(screen.getByText("Request a service"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/services/requests/create");
  });

  it("opens lifecycle-aware editing for an open owned request", async () => {
    mockParams = { id: "request-1" };
    mockClient.get.mockResolvedValue(request);
    await renderScreen(<RequestDetailScreen />);

    await fireEvent.press(await screen.findByText("Edit request"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/services/requests/request-1/edit");
  });

  it("locks published request structure and preserves its original country when saving", async () => {
    mockParams = { id: "request-1" };
    mockSession = { profile: { currentCountryId: "different-country" } };
    mockClient.get.mockImplementation((url: string) => {
      if (url === "/api/v1/service/categories") return Promise.resolve([]);
      if (url === "/api/v1/service/requests/request-1") return Promise.resolve(request);
      return Promise.reject(new Error("Unexpected request"));
    });
    mockClient.put.mockResolvedValue({ ...request, title: "Updated request" });
    await renderScreen(<RequestEditorScreen />);

    const title = await screen.findByLabelText("Request title");
    expect(screen.getByLabelText("Request latitude").props.editable).toBe(false);
    expect(screen.getByLabelText("Request longitude").props.editable).toBe(false);
    expect(screen.getByLabelText("Private address ID").props.editable).toBe(false);
    expect(screen.queryByText("Use approximate current location")).toBeNull();
    await fireEvent.changeText(title, "Updated request");
    await fireEvent.press(screen.getByText("Save changes"));

    await waitFor(() => expect(mockClient.put).toHaveBeenCalledWith(
      "/api/v1/service/requests/request-1", {
        serviceCategoryId: "category-1", countryId: "country-1", latitude: 52.52, longitude: 13.405,
        title: "Updated request", description: "Description", mediaIds: [],
      }, { authenticated: true },
    ));
  });

  it("limits request forms to five images", () => {
    const form = {
      categoryId: "category-1", addressId: "", latitude: "52.52", longitude: "13.405",
      title: "Request", description: "Description", budgetMin: "", budgetMax: "", currencyCode: "",
      preferredDate: "", expiresAt: "", mediaIds: [],
    } satisfies RequestFormState;
    expect(validateRequestForm({ ...form, mediaIds: ["1", "2", "3", "4", "5"] })).toBeNull();
    expect(validateRequestForm({ ...form, mediaIds: ["1", "2", "3", "4", "5", "6"] }))
      .toBe("A request can contain at most five images.");
  });

  it("lets a request owner accept a sent provider response", async () => {
    mockParams = { id: "request-1" };
    mockClient.get.mockImplementation((url: string) => {
      if (url === "/api/v1/service/requests/request-1") return Promise.resolve(request);
      if (url.includes("/responses?")) return Promise.resolve({ items: [response], nextCursor: null });
      return Promise.reject(new Error("No lead access"));
    });
    mockClient.post.mockResolvedValue({ ...response, status: "ACCEPTED" });
    await renderScreen(<ResponseCollectionScreen />);

    const accept = await screen.findByText("Accept response");
    await fireEvent.press(accept);
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith(
      "/api/v1/service/responses/response-1/accept", {}, { authenticated: true },
    ));
    expect(await screen.findByText("Provider · ACCEPTED")).toBeTruthy();
  });
});
