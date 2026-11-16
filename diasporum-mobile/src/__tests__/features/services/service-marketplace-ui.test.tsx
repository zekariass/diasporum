import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import ReviewEditorScreen from "@/features/services/screens/review-editor-screen";
import ServicesScreen from "@/features/services/screens/services-screen";
import ResponseCollectionScreen from "@/features/services/screens/response-collection-screen";
import QuoteCollectionScreen from "@/features/services/screens/quote-collection-screen";
import RequestDetailScreen from "@/features/services/screens/request-detail-screen";
import RequestEditorScreen, {
  validateRequestForm,
  type RequestFormState,
} from "@/features/services/screens/request-editor-screen";
import { ApiError } from "@/core/api/api-error";
import type {
  ProviderResponse,
  ServiceCategory,
  ServiceProvider,
  ServiceRequest,
} from "@/features/services/types/service-marketplace-types";

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
const mockClient = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};
let mockParams: Record<string, string> = {};
let mockSession: { profile?: { currentCountryId?: string } } | null = null;

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({ apiClient: mockClient, session: mockSession }),
}));

const request = {
  id: "request-1",
  customerUserId: "customer-1",
  customerDisplayName: "Customer",
  serviceCategoryId: "service-1",
  categoryDisplayName: "Test service",
  repostedFromRequestId: null,
  countryId: "country-1",
  addressId: null,
  latitude: 52.52,
  longitude: 13.405,
  title: "Request",
  description: "Description",
  budgetMin: null,
  budgetMax: null,
  currencyCode: null,
  preferredDate: null,
  status: "OPEN",
  expiresAt: null,
  publishedAt: "2026-01-01T00:00:00Z",
  mediaIds: [],
  distanceMeters: null,
  canManage: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} satisfies ServiceRequest;
const response = {
  id: "response-1",
  serviceRequestId: "request-1",
  serviceProviderId: "provider-1",
  providerDisplayName: "Provider",
  respondedByUserId: "provider-user-1",
  responseType: "INTEREST",
  message: "I can help",
  quotedAmount: null,
  currencyCode: null,
  status: "SENT",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} satisfies ProviderResponse;
const categories = [
  {
    id: "category-1",
    categoryKey: "HOME",
    parentId: null,
    displayName: "Home services",
    description: null,
    sortOrder: 1,
  },
  {
    id: "service-1",
    categoryKey: "PLUMBING",
    parentId: "category-1",
    displayName: "Plumbing",
    description: null,
    sortOrder: 1,
  },
] satisfies ServiceCategory[];
const provider = {
  id: "provider-1",
  ownerUserId: "provider-user-1",
  businessAccountId: null,
  displayName: "Provider",
  description: "Approved provider",
  baseLatitude: 52.52,
  baseLongitude: 13.405,
  radiusKm: 50,
  status: "ACTIVE",
  verificationStatus: "UNVERIFIED",
  onboardingStatus: "APPROVED",
  onboardingSubmittedAt: "2026-01-01T00:00:00Z",
  onboardingReviewedAt: "2026-01-01T00:00:00Z",
  onboardingReviewedByUserId: "admin-1",
  onboardingRejectionReason: null,
  categories: [categories[1]],
  distanceMeters: null,
  canManage: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} satisfies ServiceProvider;
const configuration = {
  maxProvidersPerRequest: 5,
  leadPrice: 0,
  leadCurrency: "USD",
};
const noEngagement = () => Promise.reject(ApiError.fromHttpResponse(404, {}));

async function renderScreen(component: React.ReactElement) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {component}
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockSession = null;
  mockClient.get.mockResolvedValue({ items: [], nextCursor: null });
  mockClient.post.mockResolvedValue({});
});

describe("Service Marketplace mobile workflows", () => {
  it("submits a completed-service review and returns to the provider", async () => {
    mockParams = { id: "request-1", providerId: "provider-1" };
    await renderScreen(<ReviewEditorScreen />);
    await fireEvent.press(screen.getByText("5 stars"));
    await fireEvent.changeText(
      screen.getByLabelText("Review text"),
      "  Clear communication  ",
    );
    await fireEvent.press(screen.getByText("Publish review"));

    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/service/requests/request-1/reviews",
        {
          serviceProviderId: "provider-1",
          rating: 5,
          reviewText: "Clear communication",
        },
        { authenticated: true },
      ),
    );
    expect(mockRouter.replace).toHaveBeenCalledWith(
      "/(app)/services/providers/provider-1",
    );
  }, 15000);

  it("loads hierarchical services and preselects a category and service", async () => {
    mockClient.get.mockResolvedValue(categories);
    await renderScreen(<ServicesScreen />);
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith("/api/v1/service/categories"),
    );
    await fireEvent.press(await screen.findByLabelText("Request Plumbing"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/services/requests/create?categoryId=category-1&serviceId=service-1",
    );
    // Cascading dropdowns: category → service → free quotes.
    await fireEvent.press(screen.getByLabelText("Select a category"));
    await fireEvent.press(await screen.findByLabelText("Home services"));
    await fireEvent.press(await screen.findByLabelText("Select a service"));
    await fireEvent.press(await screen.findByLabelText("Plumbing"));
    await fireEvent.press(await screen.findByLabelText("Get free quotes"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/services/requests/create?categoryId=category-1&serviceId=service-1",
    );
  });

  it("adds another dropdown when a category has an intermediate level", async () => {
    mockClient.get.mockResolvedValue([
      ...categories,
      {
        id: "mid-1",
        categoryKey: "RENOVATION",
        parentId: "category-1",
        displayName: "Renovation & Conversion",
        description: null,
        sortOrder: 2,
      },
      {
        id: "deep-1",
        categoryKey: "LOFT_CONVERSION",
        parentId: "mid-1",
        displayName: "Loft Conversion",
        description: null,
        sortOrder: 1,
      },
    ] satisfies ServiceCategory[]);
    await renderScreen(<ServicesScreen />);
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith("/api/v1/service/categories"),
    );
    await fireEvent.press(await screen.findByLabelText("Select a category"));
    await fireEvent.press(await screen.findByLabelText("Home services"));
    await fireEvent.press(await screen.findByLabelText("Select a service"));
    // Mid-tier drills into a third dropdown instead of selecting.
    await fireEvent.press(
      await screen.findByLabelText("Renovation & Conversion"),
    );
    await fireEvent.press(await screen.findByLabelText("Select a service"));
    await fireEvent.press(await screen.findByLabelText("Loft Conversion"));
    await fireEvent.press(await screen.findByLabelText("Get free quotes"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/services/requests/create?categoryId=category-1&serviceId=deep-1",
    );
  });

  it("opens lifecycle-aware editing for an open owned request", async () => {
    mockParams = { id: "request-1" };
    mockClient.get.mockImplementation((url: string) => {
      if (url === "/api/v1/service/requests/request-1")
        return Promise.resolve(request);
      if (url === "/api/v1/service/configuration")
        return Promise.resolve(configuration);
      if (url === "/api/v1/service/requests/request-1/engagement")
        return noEngagement();
      return Promise.reject(new Error("Unexpected request"));
    });
    await renderScreen(<RequestDetailScreen />);

    await fireEvent.press(await screen.findByText("Edit request"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/services/requests/request-1/edit",
    );
  });

  it("locks published request structure and preserves its original country when saving", async () => {
    mockParams = { id: "request-1" };
    mockSession = { profile: { currentCountryId: "different-country" } };
    mockClient.get.mockImplementation((url: string) => {
      if (url === "/api/v1/service/categories")
        return Promise.resolve(categories);
      if (url === "/api/v1/service/requests/request-1")
        return Promise.resolve(request);
      return Promise.reject(new Error("Unexpected request"));
    });
    mockClient.put.mockResolvedValue({ ...request, title: "Updated request" });
    await renderScreen(<RequestEditorScreen />);

    const title = await screen.findByLabelText("Request title");
    expect(screen.getByLabelText("Request latitude").props.editable).toBe(
      false,
    );
    expect(screen.getByLabelText("Request longitude").props.editable).toBe(
      false,
    );
    expect(screen.getByLabelText("Private address ID").props.editable).toBe(
      false,
    );
    expect(screen.queryByText("Use approximate current location")).toBeNull();
    await fireEvent.changeText(title, "Updated request");
    await fireEvent.press(screen.getByText("Save changes"));

    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/service/requests/request-1",
        {
          serviceCategoryId: "service-1",
          countryId: "country-1",
          latitude: 52.52,
          longitude: 13.405,
          title: "Updated request",
          description: "Description",
          mediaIds: [],
        },
        { authenticated: true },
      ),
    );
  });

  it("limits request forms to five images", () => {
    const form = {
      parentCategoryId: "category-1",
      categoryId: "service-1",
      addressId: "",
      latitude: "52.52",
      longitude: "13.405",
      title: "Request",
      description: "Description",
      budgetMin: "",
      budgetMax: "",
      currencyCode: "",
      preferredDate: "",
      expiresAt: "",
      mediaIds: [],
    } satisfies RequestFormState;
    expect(
      validateRequestForm({ ...form, mediaIds: ["1", "2", "3", "4", "5"] }),
    ).toBeNull();
    expect(
      validateRequestForm({
        ...form,
        mediaIds: ["1", "2", "3", "4", "5", "6"],
      }),
    ).toBe("A request can contain at most five images.");
  });

  it("submits a structured quote from an approved provider", async () => {
    mockParams = { id: "request-1", providerId: "provider-1" };
    mockClient.get.mockImplementation((url: string) => {
      if (url === "/api/v1/service/requests/request-1")
        return Promise.resolve({ ...request, canManage: false });
      if (url === "/api/v1/service/requests/request-1/quotes")
        return Promise.resolve([]);
      if (url === "/api/v1/service/requests/request-1/engagement")
        return noEngagement();
      if (url === "/api/v1/service/configuration")
        return Promise.resolve(configuration);
      if (url === "/api/v1/service/providers/provider-1")
        return Promise.resolve(provider);
      return Promise.reject(new Error("Unexpected request"));
    });
    await renderScreen(<QuoteCollectionScreen />);

    await fireEvent.press(await screen.findByText("Send a structured quote"));
    await fireEvent.changeText(
      screen.getByLabelText("Quote title"),
      "Complete repair",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Scope of work"),
      "Parts and labour",
    );
    await fireEvent.changeText(screen.getByLabelText("Quote amount"), "150.00");
    await fireEvent.press(screen.getByText("Send quote"));

    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/service/requests/request-1/quotes",
        {
          serviceProviderId: "provider-1",
          title: "Complete repair",
          scopeOfWork: "Parts and labour",
          amount: 150,
          currencyCode: "USD",
          items: [],
        },
        { authenticated: true },
      ),
    );
  });

  it("lets a request owner accept a sent provider response", async () => {
    mockParams = { id: "request-1" };
    mockClient.get.mockImplementation((url: string) => {
      if (url === "/api/v1/service/requests/request-1")
        return Promise.resolve(request);
      if (url.includes("/responses?"))
        return Promise.resolve({ items: [response], nextCursor: null });
      return Promise.reject(new Error("No lead access"));
    });
    mockClient.post.mockResolvedValue({ ...response, status: "ACCEPTED" });
    await renderScreen(<ResponseCollectionScreen />);

    const accept = await screen.findByText("Accept response");
    await fireEvent.press(accept);
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/service/responses/response-1/accept",
        {},
        { authenticated: true },
      ),
    );
    expect(await screen.findByText("Provider · ACCEPTED")).toBeTruthy();
  });
});
