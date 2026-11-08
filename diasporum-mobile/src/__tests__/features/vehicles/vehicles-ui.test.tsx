import React from "react";
import {
  act,
  fireEvent,
  render,
  waitFor,
  type RenderResult,
} from "@testing-library/react-native";
import { Linking, Share } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import VehiclesScreen from "@/features/vehicles/screens/vehicles-screen";
import VehicleDetailScreen from "@/features/vehicles/screens/vehicle-detail-screen";
import VehicleEditorScreen from "@/features/vehicles/screens/vehicle-editor-screen";
import VehicleCollectionScreen from "@/features/vehicles/screens/vehicle-collection-screen";
import { VehicleImage } from "@/features/vehicles/components/vehicle-card";
import { ApiError } from "@/core/api/api-error";
import { vehicleErrorMessage } from "@/features/vehicles/utils/vehicle-error";
import type {
  VehicleCategory,
  VehicleListing,
  VehicleView,
} from "@/features/vehicles/types/vehicle-types";

jest.setTimeout(15000);

let screen: RenderResult;
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
};
const mockClient = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};
const mockLocationPermission = jest.fn();
const mockCurrentPosition = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
}));
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockLocationPermission(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockCurrentPosition(...args),
  Accuracy: { Balanced: 3 },
}));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: {
      activeCommunityId: "community-1",
      me: { id: "viewer-1" },
      profile: { currentCountryId: "country-1" },
      memberships: [
        {
          communityId: "community-1",
          userId: "viewer-1",
          role: "MEMBER",
          status: "ACTIVE",
          joinedAt: "2026-01-01",
        },
      ],
    },
  }),
}));

const CATEGORY: VehicleCategory = {
  category: { id: "category-1", key: "CAR", displayName: "Cars", sortOrder: 1 },
  coreFields: [],
  requiredCoreFields: [],
  allowedFeatures: [],
  attributes: {
    drivetrain: {
      type: "ENUM",
      required: false,
      minimum: null,
      maximum: null,
      options: ["FOUR_WD", "AWD"],
      filterable: true,
    },
  },
};

function makeVehicle(overrides: Partial<VehicleListing> = {}): VehicleListing {
  return {
    id: "vehicle-1",
    countryId: "country-1",
    communityId: "community-1",
    ownerUserId: "owner-1",
    businessAccountId: null,
    businessListingId: null,
    createdByUserId: "owner-1",
    visibilityScope: "COMMUNITY",
    listingPurpose: "SALE",
    categoryId: "category-1",
    makeId: "make-1",
    modelId: "model-1",
    variantId: null,
    categoryKey: "CAR",
    categoryName: "Cars",
    makeName: "Volvo",
    modelName: "XC60",
    variantName: null,
    title: "2022 Volvo XC60",
    description: "Well maintained family vehicle",
    modelYear: 2022,
    mileage: 32000,
    mileageUnit: "KM",
    fuelType: "HYBRID",
    transmission: "AUTOMATIC",
    driveType: "FOUR_WD",
    bodyType: "SUV",
    engineSizeCc: 2000,
    colour: "Blue",
    doors: 5,
    seats: 5,
    conditionKey: "GOOD",
    registrationYear: 2022,
    previousOwners: 1,
    additionalAttributes: { drivetrain: "FOUR_WD" },
    motExpiry: "2027-06-30",
    serviceHistory: "FULL",
    priceAmount: 27500,
    currencyCode: "EUR",
    pricePeriod: "TOTAL",
    rentalDeposit: null,
    mileageAllowance: null,
    rentalConditions: null,
    addressId: "address-1",
    status: "PUBLISHED",
    expiresAt: "2027-12-31T23:59:59Z",
    publishedAt: "2026-10-01T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    saved: false,
    distanceMeters: 2500,
    location: null,
    ...overrides,
  };
}

function makeView(
  overrides: Partial<Omit<VehicleView, "listing">> = {},
  listing: Partial<VehicleListing> = {},
): VehicleView {
  return {
    listing: makeVehicle(listing),
    location: {
      countryId: "country-1",
      city: "Frankfurt",
      region: "Hesse",
      formattedAddress: null,
    },
    media: [
      {
        id: "media-1",
        downloadUrl: "https://media.example.com/vehicle.jpg",
        sortOrder: 0,
        cover: true,
      },
    ],
    features: [{ id: "feature-1", featureKey: "ABS", displayName: "ABS" }],
    selectedCommunityIds: [],
    seller: {
      userId: "owner-1",
      displayName: "Vehicle Owner",
      username: "owner",
      businessAccountId: null,
      businessName: null,
    },
    listedBy: null,
    contact: null,
    canManage: false,
    ...overrides,
  };
}

let currentDetail = makeView();

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  currentDetail = makeView();
  mockLocationPermission.mockResolvedValue({ granted: true });
  mockCurrentPosition.mockResolvedValue({
    coords: { latitude: 9.01234, longitude: 38.75678 },
  });
  mockClient.get.mockImplementation((url: string) => {
    if (url === "/api/v1/vehicles/categories")
      return Promise.resolve({ items: [CATEGORY] });
    if (url === "/api/v1/vehicles/makes")
      return Promise.resolve({
        items: [
          { id: "make-1", key: "VOLVO", displayName: "Volvo", sortOrder: 0 },
        ],
      });
    if (url === "/api/v1/vehicles/makes/make-1/models")
      return Promise.resolve({
        items: [
          { id: "model-1", key: "XC60", displayName: "XC60", sortOrder: 0 },
        ],
      });
    if (url === "/api/v1/vehicles/models/model-1/variants")
      return Promise.resolve({
        items: [
          { id: "variant-1", key: "PLUS", displayName: "Plus", sortOrder: 0 },
        ],
      });
    if (url.includes("/download-url"))
      return Promise.resolve({
        downloadUrl: "https://media.example.com/refreshed.jpg",
      });
    if (url === "/api/v1/vehicles/features")
      return Promise.resolve({ items: [] });
    if (url === "/api/v1/business-accounts")
      return Promise.resolve({
        items: [
          {
            id: "business-1",
            accountName: "Diasporum Motors",
            status: "ACTIVE",
            role: "LISTING_MANAGER",
            profileCount: 0,
            createdAt: "2026-01-01",
          },
          {
            id: "billing-1",
            accountName: "Billing Only",
            status: "ACTIVE",
            role: "BILLING_MANAGER",
            profileCount: 0,
            createdAt: "2026-01-01",
          },
        ],
      });
    if (url.startsWith("/api/v1/vehicles?")) {
      return Promise.resolve(
        url.includes("cursor=next")
          ? {
              items: [
                makeView({}, { id: "vehicle-2", title: "2020 Toyota Corolla" }),
              ],
              nextCursor: null,
            }
          : { items: [makeView()], nextCursor: "next" },
      );
    }
    if (url === "/api/v1/vehicles/vehicle-1")
      return Promise.resolve(currentDetail);
    if (url.startsWith("/api/v1/me/vehicles/saved"))
      return Promise.resolve({
        items: [makeView({}, { saved: true })],
        nextCursor: null,
      });
    if (url.startsWith("/api/v1/me/vehicles"))
      return Promise.resolve({ items: [makeView()], nextCursor: null });
    return Promise.resolve({ items: [], nextCursor: null });
  });
  mockClient.post.mockImplementation((url: string, body?: unknown) => {
    if (url === "/api/v1/vehicles/vehicle-1/contact")
      return Promise.resolve({ conversationId: "conversation-1" });
    if (url === "/api/v1/me/vehicle-searches") {
      const request = (body ?? {}) as { name?: string; filters?: object };
      return Promise.resolve({
        id: "search-new",
        name: request.name ?? "Saved search",
        filters: request.filters ?? {},
        createdAt: "2026-01-02T00:00:00Z",
      });
    }
    return Promise.resolve(currentDetail);
  });
  mockClient.put.mockImplementation((url: string) =>
    Promise.resolve(url.endsWith("/media") ? currentDetail : {}),
  );
  mockClient.patch.mockImplementation(() => Promise.resolve(currentDetail));
  mockClient.delete.mockResolvedValue({});
});

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  jest.restoreAllMocks();
});

async function renderScreen(component: React.ReactElement) {
  screen = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {component}
    </SafeAreaProvider>,
  );
  return screen;
}

describe("vehicle discovery", () => {
  it("renders results, searches, sorts, and loads the next cursor", async () => {
    await renderScreen(<VehiclesScreen />);
    expect(await screen.findByText("2022 Volvo XC60")).toBeTruthy();
    expect(mockLocationPermission).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Toggle vehicle filters"));
    await fireEvent.changeText(
      screen.getByPlaceholderText("Search make, model or keyword..."),
      "Volvo & XC60",
    );
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        expect.stringContaining("keyword=Volvo%20%26%20XC60"),
        { authenticated: true },
      ),
    );
    await fireEvent.press(screen.getByText("For Rent"));
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        expect.stringContaining("purpose=RENT"),
        { authenticated: true },
      ),
    );
    await fireEvent.press(screen.getByLabelText("Show results"));
    await fireEvent.press(screen.getByLabelText(/Sort vehicles/));
    await fireEvent.press(screen.getByText("Lowest price"));
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        expect.stringContaining("sort=PRICE_ASC"),
        { authenticated: true },
      ),
    );
    await fireEvent.press(screen.getByLabelText("Toggle vehicle filters"));
    await fireEvent.press(screen.getByLabelText("Clear all"));
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenLastCalledWith(
        "/api/v1/vehicles?sort=NEWEST&size=20",
        { authenticated: true },
      ),
    );
    await fireEvent.press(screen.getByLabelText("Show results"));
    await fireEvent(
      screen.getByTestId("vehicles-discovery-list"),
      "onEndReached",
    );
    expect(await screen.findByText("2020 Toyota Corolla")).toBeTruthy();
    expect(mockClient.get).toHaveBeenCalledWith(
      expect.stringContaining("cursor=next"),
      { authenticated: true },
    );
  }, 15000);

  it("requests location only after the explicit action and enables distance search", async () => {
    await renderScreen(<VehiclesScreen />);
    await screen.findByText("2022 Volvo XC60");
    await fireEvent.press(screen.getByLabelText("Toggle vehicle filters"));
    expect(mockLocationPermission).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByLabelText("Use my location"));
    await waitFor(() => expect(mockLocationPermission).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        expect.stringMatching(
          /originLatitude=9\.012&originLongitude=38\.757.*sort=DISTANCE/,
        ),
        { authenticated: true },
      ),
    );
  });

  it("preserves catalogue relationships, advanced fields, units, and rental pricing", async () => {
    await renderScreen(<VehiclesScreen />);
    await screen.findByText("2022 Volvo XC60");
    await fireEvent.press(screen.getByLabelText("Toggle vehicle filters"));
    await fireEvent.press(screen.getByText("Cars"));
    await fireEvent.press(screen.getByText("For Rent"));
    await fireEvent.press(screen.getByLabelText("Make"));
    await fireEvent.press(await screen.findByText("Volvo"));
    await fireEvent.press(await screen.findByLabelText("Model"));
    await fireEvent.press(await screen.findByText("XC60"));
    await fireEvent.press(await screen.findByLabelText("Variant"));
    await fireEvent.press(await screen.findByText("Plus"));
    await fireEvent.press(screen.getByText("Miles"));
    await fireEvent.changeText(
      screen.getByLabelText("Maximum mileage"),
      "100000",
    );
    await fireEvent.changeText(screen.getByLabelText("Minimum year"), "2018");
    await fireEvent.changeText(
      screen.getByLabelText("Min registration year"),
      "2019",
    );
    await fireEvent.changeText(screen.getByLabelText("Colour"), "Blue");
    await fireEvent.changeText(screen.getByLabelText("Minimum price"), "100");
    await fireEvent.press(screen.getByLabelText("Rental price period"));
    await fireEvent.press(await screen.findByText("Per day"));
    await waitFor(() => {
      const url = mockClient.get.mock.calls
        .filter(([path]) => path.startsWith("/api/v1/vehicles?"))
        .at(-1)![0];
      for (const part of [
        "purpose=RENT",
        "categoryId=category-1",
        "makeId=make-1",
        "modelId=model-1",
        "variantId=variant-1",
        "yearMin=2018",
        "registrationYearMin=2019",
        "mileageMax=100000",
        "mileageUnit=MILES",
        "colour=Blue",
        "pricePeriod=DAY",
        "currency=EUR",
      ])
        expect(url).toContain(part);
    });
    await fireEvent.press(screen.getByLabelText("Make"));
    await fireEvent.press(await screen.findByText("Any make"));
    await waitFor(() => {
      const url = mockClient.get.mock.calls
        .filter(([path]) => path.startsWith("/api/v1/vehicles?"))
        .at(-1)![0];
      expect(url).not.toMatch(/makeId=|modelId=|variantId=/);
    });
  });

  it("ignores stale discovery responses after a fast purpose change", async () => {
    const original = mockClient.get.getMockImplementation()!;
    let finishOld: (value: unknown) => void = () => {};
    mockClient.get.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/vehicles?") && !url.includes("purpose=RENT"))
        return new Promise((resolve) => {
          finishOld = resolve;
        });
      if (url.startsWith("/api/v1/vehicles?"))
        return Promise.resolve({
          items: [makeView({}, { title: "Current rental" })],
          nextCursor: null,
        });
      return original(url);
    });
    await renderScreen(<VehiclesScreen />);
    await fireEvent.press(screen.getByLabelText("Toggle vehicle filters"));
    await fireEvent.press(screen.getByText("For Rent"));
    await fireEvent.press(screen.getByLabelText("Show results"));
    expect(await screen.findByText("Current rental")).toBeTruthy();
    await act(async () => {
      finishOld({ items: [makeView()], nextCursor: "stale" });
    });
    expect(screen.queryByText("2022 Volvo XC60")).toBeNull();
    expect(screen.getByText("Current rental")).toBeTruthy();
  });

  it("applies and removes backend-saved searches and reports total results", async () => {
    const original = mockClient.get.getMockImplementation()!;
    mockClient.get.mockImplementation((url: string) => {
      if (url === "/api/v1/me/vehicle-searches")
        return Promise.resolve({
          items: [
            {
              id: "search-1",
              name: "Volvo under 20k",
              filters: {
                purpose: "SALE",
                makeId: "make-1",
                priceMax: 20000,
                currency: "EUR",
                sort: "NEWEST",
              },
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        });
      if (url.startsWith("/api/v1/vehicles?"))
        return Promise.resolve({
          items: [makeView()],
          nextCursor: null,
          totalCount: 59790,
        });
      return original(url);
    });
    await renderScreen(<VehiclesScreen />);
    expect(await screen.findByText("59,790 results")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Saved searches"));
    await fireEvent.press(
      screen.getByLabelText("Apply saved search Volvo under 20k"),
    );
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        expect.stringContaining("purpose=SALE&makeId=make-1"),
        { authenticated: true },
      ),
    );

    await fireEvent.press(screen.getByLabelText("Remove saved search"));
    await waitFor(() =>
      expect(mockClient.delete).toHaveBeenCalledWith(
        "/api/v1/me/vehicle-searches/search-1",
        { authenticated: true },
      ),
    );

    await fireEvent.press(screen.getByLabelText("Save search"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/me/vehicle-searches",
        expect.objectContaining({
          filters: expect.objectContaining({ sort: "NEWEST" }),
        }),
        { authenticated: true },
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Remove saved search")).toBeTruthy(),
    );
  });

  it("saves, rolls back failures, and preserves details and collection navigation", async () => {
    await renderScreen(<VehiclesScreen />);
    await fireEvent.press(await screen.findByLabelText("Save 2022 Volvo XC60"));
    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1/save",
        {},
        { authenticated: true },
      ),
    );
    mockClient.delete.mockRejectedValueOnce(new Error("offline"));
    await fireEvent.press(screen.getByLabelText("Unsave 2022 Volvo XC60"));
    expect(
      await screen.findByText(
        "Could not update saved vehicles. Please try again.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Unsave 2022 Volvo XC60")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("View 2022 Volvo XC60"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/vehicles/vehicle-1");
    await fireEvent.press(screen.getByLabelText("Saved vehicles"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/vehicles/saved");
    expect(screen.getByText("1+ results")).toBeTruthy();
  });

  it("shows empty and error states", async () => {
    mockClient.get.mockImplementation((url: string) =>
      url.startsWith("/api/v1/vehicles?")
        ? Promise.resolve({ items: [], nextCursor: null })
        : Promise.resolve({ items: [] }),
    );
    const view = await renderScreen(<VehiclesScreen />);
    expect(await screen.findByText("No vehicles found")).toBeTruthy();
    await view.unmount();
    mockClient.get.mockImplementation((url: string) =>
      url.startsWith("/api/v1/vehicles?")
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ items: [] }),
    );
    await renderScreen(<VehiclesScreen />);
    expect(await screen.findByText("Failed to load vehicles.")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});

describe("vehicle details", () => {
  beforeEach(() => {
    mockParams = { id: "vehicle-1" };
  });

  it("renders the batch-presigned gallery, saves, contacts, and reports", async () => {
    await renderScreen(<VehicleDetailScreen />);
    expect(
      await screen.findByLabelText("View 2022 Volvo XC60 image 1 full screen"),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Save vehicle"));
    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1/save",
        {},
        { authenticated: true },
      ),
    );
    await fireEvent.press(screen.getByLabelText("Message seller"));
    await fireEvent.press(screen.getByLabelText("Contact as personal account"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1/contact",
        {},
        { authenticated: true },
      ),
    );
    expect(mockRouter.push).toHaveBeenCalledWith("/messages/conversation-1");
    await fireEvent.press(screen.getByLabelText("More vehicle options"));
    await fireEvent.press(screen.getByLabelText("Report vehicle"));
    await fireEvent.press(screen.getByLabelText("Scam"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1/report",
        { reason: "SCAM" },
        { authenticated: true },
      ),
    );
    expect(mockClient.post).not.toHaveBeenCalledWith(
      "/api/v1/conversations",
      expect.anything(),
      expect.anything(),
    );
  });

  it("shows only enabled contact channels and preserves business messaging", async () => {
    currentDetail = makeView({
      contact: {
        phone: null,
        whatsapp: "+44 7700 900000",
        email: null,
        preferredMethod: "WHATSAPP",
      },
    });
    const link = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await renderScreen(<VehicleDetailScreen />);
    expect(await screen.findByTestId("vehicle-contact-bar")).toBeTruthy();
    expect(screen.queryByLabelText("Call seller")).toBeNull();
    expect(screen.queryByLabelText("Email seller")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Contact seller"));
    await fireEvent.press(screen.getByLabelText("Contact via WhatsApp"));
    expect(link).toHaveBeenCalledWith("https://wa.me/447700900000");
    await fireEvent.press(
      screen.getByRole("button", { name: "Close Contact seller" }),
    );
    await fireEvent.press(screen.getByLabelText("Message seller"));
    expect(screen.queryByText("Contact as Billing Only")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Contact as Diasporum Motors"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1/contact",
        { actingBusinessAccountId: "business-1" },
        { authenticated: true },
      ),
    );
  });

  it("preserves full description, real features, public location and advertiser navigation", async () => {
    currentDetail = makeView(
      {
        listedBy: {
          businessId: "public-business-1",
          name: "Real Motors",
          verificationStatus: "VERIFIED",
          categoryName: null,
          averageRating: 3.6,
          reviewCount: 285,
        },
        location: {
          city: "Leeds",
          region: "West Yorkshire",
          countryId: "country-1",
          formattedAddress: "Private street 12",
        },
      },
      {
        description: "A full vehicle description.\n".repeat(20),
        registrationYear: 2023,
      },
    );
    const share = jest.spyOn(Share, "share").mockResolvedValue({
      action: Share.sharedAction,
      activityType: undefined,
    });
    await renderScreen(<VehicleDetailScreen />);
    await fireEvent.press(await screen.findByText("Read more"));
    expect(screen.getByText("Read less")).toBeTruthy();
    expect(screen.queryByText(/Private street/)).toBeNull();
    expect(screen.getByText("Registration year")).toBeTruthy();
    expect(screen.getByText("2023")).toBeTruthy();
    expect(screen.getByText("ABS")).toBeTruthy();
    expect(screen.queryByText("Heated seats")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Listed by Real Motors"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/businesses/public-business-1",
    );
    await fireEvent.press(screen.getByLabelText("Share vehicle"));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("2022 Volvo XC60"),
      }),
    );
    await fireEvent.press(
      screen.getByLabelText("View 2022 Volvo XC60 image 1 full screen"),
    );
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1/media/media-1/download-url",
        { authenticated: true },
      ),
    );
    expect(screen.getByLabelText("Close photo viewer")).toBeTruthy();
  });

  it("preserves missing-image positions in the gallery and updates its counter", async () => {
    currentDetail = makeView({
      media: [
        { id: "media-1", cover: true, sortOrder: 0, downloadUrl: null },
        {
          id: "media-2",
          cover: false,
          sortOrder: 1,
          downloadUrl: "https://media.example.com/second.jpg",
        },
      ],
    });
    await renderScreen(<VehicleDetailScreen />);
    expect(await screen.findByText("1 / 2")).toBeTruthy();
    const gallery = screen.getByTestId("vehicle-gallery");
    const width = gallery.props.getItemLayout([], 0).length;
    await fireEvent(gallery, "onMomentumScrollEnd", {
      nativeEvent: { contentOffset: { x: width } },
    });
    expect(screen.getByText("2 / 2")).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText("View 2022 Volvo XC60 image 2 full screen"),
    );
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1/media/media-2/download-url",
        { authenticated: true },
      ),
    );
  });

  it("exposes owner pause and SALE completion actions", async () => {
    currentDetail = makeView({ canManage: true });
    await renderScreen(<VehicleDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Pause listing"));
    expect(screen.queryByTestId("vehicle-contact-bar")).toBeNull();
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1/pause",
        undefined,
        { authenticated: true },
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("Mark as sold").props.accessibilityState.disabled,
      ).toBe(false),
    );
    await fireEvent.press(screen.getByLabelText("Mark as sold"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1/sold",
        undefined,
        { authenticated: true },
      ),
    );
  });
});

describe("vehicle editor", () => {
  async function completeRequiredFields(businessAccount?: string) {
    await fireEvent.press(await screen.findByText("Cars"));
    await waitFor(() =>
      expect(
        screen.getByText("Cars").parent?.props.accessibilityState?.selected,
      ).toBe(true),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Title"),
      "2022 Volvo XC60",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Description"),
      "Well maintained family vehicle",
    );
    await fireEvent.press(screen.getByLabelText("Continue"));
    expect(await screen.findByText("Key specifications")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Continue"));
    expect(await screen.findByText("Asking price")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Sale price"), "27500");
    await fireEvent.press(screen.getByLabelText("Continue"));
    expect(await screen.findByText("List as")).toBeTruthy();
    if (businessAccount) {
      expect(await screen.findByText(businessAccount)).toBeTruthy();
      expect(screen.queryByText("Billing Only")).toBeNull();
      await fireEvent.press(screen.getByText(businessAccount));
    }
    await fireEvent.press(screen.getByLabelText("Continue"));
    expect(await screen.findByText("Public general location")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("City"), "Frankfurt");
    await waitFor(() => {
      expect(screen.getByLabelText("City").props.value).toBe("Frankfurt");
    });
  }

  it("selects an eligible Business Account and only requests location on demand", async () => {
    await renderScreen(<VehicleEditorScreen />);
    expect(mockLocationPermission).not.toHaveBeenCalled();
    await completeRequiredFields("Diasporum Motors");
    await fireEvent.press(screen.getByLabelText("Use my location"));
    await waitFor(() => expect(mockCurrentPosition).toHaveBeenCalled());
    await fireEvent.press(screen.getByLabelText("Save draft"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/vehicles",
        expect.objectContaining({
          businessAccountId: "business-1",
          title: "2022 Volvo XC60",
          location: expect.objectContaining({ city: "Frankfurt" }),
        }),
        { authenticated: true },
      ),
    );
    expect(mockClient.put).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/media",
      { mediaIds: [] },
      { authenticated: true },
    );
    expect(mockRouter.replace).toHaveBeenCalledWith(
      "/(app)/vehicles/vehicle-1",
    );
  });

  it("retains a created draft and explains default-deny publishing", async () => {
    const isApiError = jest.spyOn(ApiError, "isApiError");
    const entitlementError = new ApiError({
      code: "FORBIDDEN",
      httpStatus: 403,
      message: "ENTITLEMENT_NOT_CONFIGURED",
    });
    let rejectPublish: (error: ApiError) => void = () => {};
    mockClient.post.mockImplementation((url: string) => {
      if (url === "/api/v1/vehicles/vehicle-1/publish") {
        return new Promise((_, reject: (error: ApiError) => void) => {
          rejectPublish = reject;
        });
      }
      return Promise.resolve(currentDetail);
    });
    await renderScreen(<VehicleEditorScreen />);
    await completeRequiredFields();
    await fireEvent.press(screen.getByLabelText("Continue"));
    expect(await screen.findByText("Ready for a final check")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Publish vehicle"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      rejectPublish(entitlementError);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockClient.post).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/publish",
      undefined,
      { authenticated: true },
    );
    expect(isApiError).toHaveBeenCalled();
    expect(
      vehicleErrorMessage(entitlementError, "Could not save the vehicle."),
    ).toMatch(/Vehicle publishing is not enabled/);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(
      mockClient.post.mock.calls.filter(([url]) => url === "/api/v1/vehicles"),
    ).toHaveLength(1);
  });

  it("keeps validation focused on the current wizard step", async () => {
    await renderScreen(<VehicleEditorScreen />);
    await fireEvent.press(screen.getByLabelText("Continue"));
    expect(await screen.findByText("Select a vehicle category.")).toBeTruthy();
    expect(screen.getByLabelText("Listing progress: step 1 of 6")).toBeTruthy();
    expect(screen.queryByText("Asking price")).toBeNull();
  });

  it("shows an honest unavailable-catalogue state", async () => {
    mockClient.get.mockImplementation((url: string) => {
      if (url === "/api/v1/vehicles/categories")
        return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
    await renderScreen(<VehicleEditorScreen />);
    expect(
      await screen.findByText(/No active vehicle categories are configured/),
    ).toBeTruthy();
  });

  it("loads and updates an editable listing", async () => {
    mockParams = { id: "vehicle-1" };
    currentDetail = makeView({ canManage: true }, { status: "DRAFT" });
    await renderScreen(<VehicleEditorScreen edit />);
    expect(await screen.findByDisplayValue("2022 Volvo XC60")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Title"), "Updated Volvo");
    await waitFor(() =>
      expect(screen.getByLabelText("Title").props.value).toBe("Updated Volvo"),
    );
    await fireEvent.press(screen.getByLabelText("Save changes"));
    await waitFor(() =>
      expect(mockClient.patch).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1",
        expect.objectContaining({
          title: "Updated Volvo",
        }),
        { authenticated: true },
      ),
    );
    const request = mockClient.patch.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(request).not.toHaveProperty("businessAccountId");
    expect(mockClient.put).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/media",
      {
        mediaIds: ["media-1"],
        coverMediaId: "media-1",
      },
      { authenticated: true },
    );
  });
});

describe("vehicle images", () => {
  it("resolves a missing signed URL through the existing media endpoint", async () => {
    await renderScreen(
      <VehicleImage
        vehicleId="vehicle-1"
        label="Vehicle photo"
        style={{ width: 300, height: 200 }}
        media={{ id: "media-1", cover: true, sortOrder: 0, downloadUrl: null }}
      />,
    );
    expect(
      (await screen.findByLabelText("Vehicle photo")).props.source.uri,
    ).toBe("https://media.example.com/refreshed.jpg");
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/media/media-1/download-url",
      { authenticated: true },
    );
  });

  it("refreshes an expired image once and falls back without a retry loop", async () => {
    await renderScreen(
      <VehicleImage
        vehicleId="vehicle-1"
        label="Vehicle photo"
        style={{ width: 300, height: 200 }}
        media={{
          id: "media-1",
          cover: true,
          sortOrder: 0,
          downloadUrl: "https://media.example.com/expired.jpg",
        }}
      />,
    );
    expect(mockClient.get).not.toHaveBeenCalled();
    await fireEvent(screen.getByLabelText("Vehicle photo"), "error");
    await waitFor(() =>
      expect(screen.getByLabelText("Vehicle photo").props.source.uri).toBe(
        "https://media.example.com/refreshed.jpg",
      ),
    );
    await fireEvent(screen.getByLabelText("Vehicle photo"), "error");
    expect(await screen.findByText("Image unavailable")).toBeTruthy();
    expect(mockClient.get).toHaveBeenCalledTimes(1);
  });
});

describe("vehicle collections", () => {
  it.each([
    { mode: "my" as const, title: "My vehicle listings" },
    { mode: "saved" as const, title: "Saved vehicles" },
  ])("loads $title", async ({ mode, title }) => {
    await renderScreen(<VehicleCollectionScreen mode={mode} />);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(await screen.findByText("2022 Volvo XC60")).toBeTruthy();
  });

  it("filters owned listings by status and removes unsaved vehicles", async () => {
    const mine = await renderScreen(<VehicleCollectionScreen mode="my" />);
    await screen.findByText("2022 Volvo XC60");
    await fireEvent.press(screen.getByText("Draft"));
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        expect.stringContaining("status=DRAFT"),
        { authenticated: true },
      ),
    );
    await mine.unmount();
    await renderScreen(<VehicleCollectionScreen mode="saved" />);
    await fireEvent.press(
      await screen.findByLabelText("Unsave 2022 Volvo XC60"),
    );
    await waitFor(() =>
      expect(mockClient.delete).toHaveBeenCalledWith(
        "/api/v1/vehicles/vehicle-1/save",
        { authenticated: true },
      ),
    );
    expect(await screen.findByText("No saved vehicles")).toBeTruthy();
  });
});
