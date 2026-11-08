import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import BusinessesScreen from "@/features/business-directory/screens/businesses-screen";
import BusinessCollectionScreen from "@/features/business-directory/screens/business-collection-screen";
import BusinessDetailScreen from "@/features/business-directory/screens/business-detail-screen";
import BusinessFormScreen from "@/features/business-directory/screens/business-form-screen";
import ManageBusinessScreen from "@/features/business-directory/screens/manage-business-screen";
import BranchFormScreen, {
  validateBranchForm,
} from "@/features/business-directory/screens/branch-form-screen";
import type {
  Business,
  BusinessBranch,
  BusinessDetail,
} from "@/features/business-directory/types/directory-types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockClient = {
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
};
let mockParams: Record<string, string> = {};

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({ canceled: true }),
}));
jest.mock("expo-router", () => {
  const actualReact = jest.requireActual<typeof import("react")>("react");
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) =>
      actualReact.useEffect(effect, [effect]),
  };
});
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: {
      me: { id: "user-1" },
      profile: { currentCountryId: "country-1" },
      activeCommunityId: "community-1",
      memberships: [
        {
          communityId: "community-1",
          userId: "user-1",
          role: "MEMBER",
          status: "ACTIVE",
          joinedAt: "2026-01-01T00:00:00Z",
        },
      ],
    },
  }),
}));

const category = {
  id: "category-1",
  countryId: null,
  name: "Restaurants",
  slug: "restaurants",
  iconKey: null,
  active: true,
};

function business(overrides: Partial<Business> = {}): Business {
  return {
    id: "business-1",
    countryId: "country-1",
    category,
    name: "Habesha Cafe",
    slug: "habesha-cafe",
    description: "Coffee and traditional food.",
    phone: "+49 30 1234567",
    email: "hello@example.com",
    websiteUrl: "https://example.com",
    verificationStatus: "UNVERIFIED",
    status: "PUBLISHED",
    visibilityScope: "COUNTRY",
    communityId: null,
    averageRating: 4.5,
    reviewCount: 2,
    sponsored: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    saved: false,
    canManage: false,
    businessAccountId: null,
    businessAccountName: null,
    listingCount: 0,
    locationCount: 0,
    logoMediaId: null,
    coverMediaId: null,
    distanceMeters: null,
    ...overrides,
  };
}

const branch: BusinessBranch = {
  id: "branch-1",
  businessId: "business-1",
  addressId: "address-1",
  locationName: "Main branch",
  phone: null,
  primary: true,
  active: true,
  timezone: "Europe/Berlin",
  address: {
    addressLine1: "1 Main Street",
    addressLine2: null,
    city: "Berlin",
    region: null,
    postalCode: "10115",
    formattedAddress: "1 Main Street, Berlin",
    latitude: 52.5,
    longitude: 13.4,
  },
  hours: [
    { dayOfWeek: 1, openTime: "09:00:00", closeTime: "17:00:00", closed: false },
    { dayOfWeek: 7, openTime: null, closeTime: null, closed: true },
  ],
};

function detail(overrides: Partial<Business> = {}): BusinessDetail {
  return {
    business: business(overrides),
    locations: [branch],
    media: [],
  };
}

async function renderScreen(component: React.ReactElement) {
  return await render(
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
  mockClient.get.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/businesses/categories")) {
      return Promise.resolve({ items: [category] });
    }
    if (path === "/api/v1/me/communities/available") {
      return Promise.resolve({
        items: [
          {
            id: "community-1",
            name: "Berlin Community",
            slug: "berlin",
            originCountryId: "origin-1",
            destinationCountryId: "country-1",
            description: null,
            active: true,
          },
        ],
      });
    }
    if (path === "/api/v1/business-accounts") {
      return Promise.resolve({
        items: [
          {
            id: "account-1",
            accountName: "Habesha Group",
            status: "ACTIVE",
            role: "OWNER",
            profileCount: 1,
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      });
    }
    if (path.startsWith("/api/v1/businesses/business-1/reviews")) {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    if (path === "/api/v1/businesses/business-1") {
      return Promise.resolve(detail());
    }
    if (path.startsWith("/api/v1/me/businesses/saved")) {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    if (path.startsWith("/api/v1/me/businesses")) {
      return Promise.resolve({ items: [business({ canManage: true })], nextCursor: null });
    }
    if (path.startsWith("/api/v1/businesses?")) {
      return Promise.resolve({ items: [business()], nextCursor: null });
    }
    return Promise.resolve({ items: [] });
  });
  mockClient.post.mockImplementation((path: string) => {
    if (path.endsWith("/contact")) return Promise.resolve({ conversationId: "conversation-1" });
    if (path.endsWith("/verification/request")) return Promise.resolve({ status: "PENDING" });
    if (path.endsWith("/publish")) return Promise.resolve(business({ status: "DRAFT", canManage: true }));
    if (path.includes("/download-url")) return Promise.resolve({ downloadUrl: "https://signed.example/image" });
    if (path === "/api/v1/businesses") return Promise.resolve(business({ status: "DRAFT", canManage: true }));
    if (path.endsWith("/locations")) return Promise.resolve({ ...branch, id: "branch-new" });
    return Promise.resolve({});
  });
  mockClient.patch.mockResolvedValue(business({ canManage: true }));
  mockClient.put.mockResolvedValue({ items: [] });
  mockClient.delete.mockResolvedValue(undefined);
});

describe("Business Directory mobile UI", () => {
  it("discovers real API results and opens a business detail", async () => {
    await renderScreen(<BusinessesScreen />);

    expect(await screen.findByText("Habesha Cafe")).toBeTruthy();
    expect(screen.getAllByText("Restaurants").length).toBeGreaterThan(0);
    expect(mockClient.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/businesses?countryId=country-1"),
      { authenticated: true },
    );

    await fireEvent.press(screen.getByLabelText("Open Habesha Cafe"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/businesses/business-1");
  });

  it("shows the saved empty state", async () => {
    await renderScreen(<BusinessCollectionScreen mode="saved" />);

    expect(await screen.findByText("No saved businesses")).toBeTruthy();
  });

  it("shows account-scoped managed results", async () => {
    mockParams = { accountId: "account-1" };
    await renderScreen(<BusinessCollectionScreen mode="managed" />);

    expect(await screen.findByText("Habesha Cafe")).toBeTruthy();
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/v1/me/businesses?businessAccountId=account-1&size=20",
      { authenticated: true },
    );
  });

  it("shows branches, hours, reviews, and delegates contact to messages", async () => {
    mockParams = { businessId: "business-1" };
    mockClient.get.mockImplementation((path: string) => {
      if (path === "/api/v1/businesses/business-1") {
        return Promise.resolve({
          ...detail(),
          media: [{ mediaId: "media-1", role: "GALLERY", sortOrder: 0 }],
        });
      }
      if (path.startsWith("/api/v1/businesses/business-1/reviews")) {
        return Promise.resolve({ items: [], nextCursor: null });
      }
      return Promise.resolve({ items: [] });
    });
    await renderScreen(<BusinessDetailScreen />);

    expect(await screen.findByText("Habesha Cafe")).toBeTruthy();
    expect(screen.getByText("Main branch")).toBeTruthy();
    expect(screen.getByText("09:00–17:00")).toBeTruthy();
    expect(screen.getByText("Gallery")).toBeTruthy();
    expect(screen.getByText("No reviews yet")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Contact business"));
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith(
        "/(app)/messages/conversation-1",
      ),
    );
  });

  it("creates an account-owned draft with validated public fields", async () => {
    mockParams = { accountId: "account-1" };
    await renderScreen(<BusinessFormScreen />);

    await fireEvent.changeText(screen.getByLabelText("Business name"), " Habesha Cafe ");
    await fireEvent.changeText(
      screen.getByLabelText("Description"),
      " Coffee and traditional food. ",
    );
    await fireEvent.press(screen.getByLabelText("Restaurants"));
    await fireEvent.press(screen.getByLabelText("Create draft profile"));

    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/businesses",
        expect.objectContaining({
          countryId: "country-1",
          businessAccountId: "account-1",
          categoryId: "category-1",
          name: "Habesha Cafe",
          description: "Coffee and traditional food.",
          visibilityScope: "COUNTRY",
        }),
        { authenticated: true },
      ),
    );
    expect(mockRouter.replace).toHaveBeenCalledWith(
      "/(app)/businesses/business-1/manage",
    );
  });

  it("supports lifecycle, media-role changes, and verification requests", async () => {
    mockParams = { businessId: "business-1" };
    mockClient.get.mockImplementation((path: string) => {
      if (path === "/api/v1/businesses/business-1") {
        return Promise.resolve({
          ...detail({ status: "DRAFT", canManage: true }),
          media: [{ mediaId: "media-1", role: "GALLERY", sortOrder: 0 }],
        });
      }
      return Promise.resolve({ items: [] });
    });
    await renderScreen(<ManageBusinessScreen />);

    expect(await screen.findByText("Publication")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Publish profile"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/businesses/business-1/publish",
        undefined,
        { authenticated: true },
      ),
    );

    await fireEvent.press(screen.getByLabelText("COVER"));
    await waitFor(() =>
      expect(mockClient.patch).toHaveBeenCalledWith(
        "/api/v1/businesses/business-1/media/media-1",
        { role: "COVER", sortOrder: undefined },
        { authenticated: true },
      ),
    );

    await fireEvent.press(screen.getByLabelText("Request verification"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/businesses/business-1/verification/request",
        undefined,
        { authenticated: true },
      ),
    );
  });

  it("submits a shared-address branch and all seven weekday rows", async () => {
    mockParams = { businessId: "business-1" };
    await renderScreen(<BranchFormScreen />);

    await fireEvent.changeText(screen.getByLabelText("City"), "Berlin");
    await fireEvent.press(screen.getByLabelText("Add branch and hours"));

    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/businesses/business-1/locations",
        expect.objectContaining({
          active: true,
          address: expect.objectContaining({ city: "Berlin" }),
        }),
        { authenticated: true },
      ),
    );
    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/businesses/business-1/locations/branch-new/hours",
        expect.objectContaining({
          hours: expect.arrayContaining([
            expect.objectContaining({ dayOfWeek: 1, closed: false }),
            expect.objectContaining({ dayOfWeek: 7, closed: true }),
          ]),
        }),
        { authenticated: true },
      ),
    );
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("validates nearby branch coordinates and opening times before submission", () => {
    const base = {
      addressLine1: "1 Main Street",
      city: "Berlin",
      formattedAddress: "",
      latitude: "52.5",
      longitude: "",
      clearCoordinates: false,
      timezone: "Europe/Berlin",
      hours: [
        { dayOfWeek: 1, openTime: "25:00", closeTime: "17:00", closed: false },
      ],
    };
    expect(validateBranchForm(base, true)).toContain("both latitude and longitude");
    expect(
      validateBranchForm({ ...base, longitude: "13.4" }, true),
    ).toContain("opening time must be HH:MM");
    expect(
      validateBranchForm(
        {
          ...base,
          longitude: "13.4",
          hours: [
            { dayOfWeek: 1, openTime: "09:00", closeTime: "17:00", closed: false },
          ],
        },
        true,
      ),
    ).toBeNull();
  });
});
