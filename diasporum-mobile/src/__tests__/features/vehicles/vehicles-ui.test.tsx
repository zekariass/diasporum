import React from "react";
import { act, fireEvent, render, waitFor, type RenderResult } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import VehiclesScreen from "@/features/vehicles/screens/vehicles-screen";
import VehicleDetailScreen from "@/features/vehicles/screens/vehicle-detail-screen";
import VehicleEditorScreen from "@/features/vehicles/screens/vehicle-editor-screen";
import VehicleCollectionScreen from "@/features/vehicles/screens/vehicle-collection-screen";
import { ApiError } from "@/core/api/api-error";
import { vehicleErrorMessage } from "@/features/vehicles/utils/vehicle-error";
import type {
  VehicleCategory,
  VehicleListing,
  VehicleView,
} from "@/features/vehicles/types/vehicle-types";

jest.setTimeout(15000);

let screen: RenderResult;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) };
const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };
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
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockLocationPermission(...args),
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
      memberships: [{ communityId: "community-1", userId: "viewer-1", role: "MEMBER", status: "ACTIVE", joinedAt: "2026-01-01" }],
    },
  }),
}));

const CATEGORY: VehicleCategory = {
  category: { id: "category-1", key: "CAR", displayName: "Cars", sortOrder: 1 },
  coreFields: [],
  requiredCoreFields: [],
  allowedFeatures: [],
  attributes: {
    drivetrain: { type: "ENUM", required: false, minimum: null, maximum: null, options: ["FOUR_WD", "AWD"], filterable: true },
  },
};

function makeVehicle(overrides: Partial<VehicleListing> = {}): VehicleListing {
  return {
    id: "vehicle-1",
    countryId: "country-1",
    communityId: "community-1",
    ownerUserId: "owner-1",
    businessAccountId: null,
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
    location: { countryId: "country-1", city: "Frankfurt", region: "Hesse", formattedAddress: null },
    media: [{ id: "media-1", downloadUrl: "https://media.example.com/vehicle.jpg", sortOrder: 0, cover: true }],
    features: [{ id: "feature-1", featureKey: "ABS", displayName: "ABS" }],
    selectedCommunityIds: [],
    seller: { userId: "owner-1", displayName: "Vehicle Owner", username: "owner", businessAccountId: null, businessName: null },
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
  mockCurrentPosition.mockResolvedValue({ coords: { latitude: 9.01234, longitude: 38.75678 } });
  mockClient.get.mockImplementation((url: string) => {
    if (url === "/api/v1/vehicles/categories") return Promise.resolve({ items: [CATEGORY] });
    if (url === "/api/v1/vehicles/makes") return Promise.resolve({ items: [] });
    if (url === "/api/v1/vehicles/features") return Promise.resolve({ items: [] });
    if (url === "/api/v1/business-accounts") return Promise.resolve({ items: [
      { id: "business-1", accountName: "Diasporum Motors", status: "ACTIVE", role: "LISTING_MANAGER", profileCount: 0, createdAt: "2026-01-01" },
      { id: "billing-1", accountName: "Billing Only", status: "ACTIVE", role: "BILLING_MANAGER", profileCount: 0, createdAt: "2026-01-01" },
    ] });
    if (url.startsWith("/api/v1/vehicles?")) {
      return Promise.resolve(url.includes("cursor=next")
        ? { items: [makeView({}, { id: "vehicle-2", title: "2020 Toyota Corolla" })], nextCursor: null }
        : { items: [makeView()], nextCursor: "next" });
    }
    if (url === "/api/v1/vehicles/vehicle-1") return Promise.resolve(currentDetail);
    if (url.startsWith("/api/v1/me/vehicles/saved")) return Promise.resolve({ items: [makeView({}, { saved: true })], nextCursor: null });
    if (url.startsWith("/api/v1/me/vehicles")) return Promise.resolve({ items: [makeView()], nextCursor: null });
    return Promise.resolve({ items: [], nextCursor: null });
  });
  mockClient.post.mockImplementation((url: string) => {
    if (url === "/api/v1/vehicles/vehicle-1/contact") return Promise.resolve({ conversationId: "conversation-1" });
    return Promise.resolve(currentDetail);
  });
  mockClient.put.mockImplementation((url: string) => Promise.resolve(url.endsWith("/media") ? currentDetail : {}));
  mockClient.patch.mockImplementation(() => Promise.resolve(currentDetail));
  mockClient.delete.mockResolvedValue({});
});

afterEach(async () => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  jest.restoreAllMocks();
});

async function renderScreen(component: React.ReactElement) {
  screen = await render(<SafeAreaProvider initialMetrics={{
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  }}>{component}</SafeAreaProvider>);
  return screen;
}

describe("vehicle discovery", () => {
  it("renders results, searches, sorts, and loads the next cursor", async () => {
    await renderScreen(<VehiclesScreen />);
    expect(await screen.findByText("2022 Volvo XC60")).toBeTruthy();
    expect(mockLocationPermission).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByPlaceholderText("Search vehicles"), "Volvo & XC60");
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(
      expect.stringContaining("keyword=Volvo%20%26%20XC60"), { authenticated: true },
    ));
    await fireEvent.press(screen.getByText("For rent"));
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining("purpose=RENT"), { authenticated: true }));
    await fireEvent.press(screen.getByText("Price low"));
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining("sort=PRICE_ASC"), { authenticated: true }));
    await fireEvent.press(screen.getByText("Clear filters"));
    await fireEvent(screen.getByTestId("vehicles-discovery-list"), "onEndReached");
    expect(await screen.findByText("2020 Toyota Corolla")).toBeTruthy();
    expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining("cursor=next"), { authenticated: true });
  }, 15000);

  it("requests location only after the explicit action and enables distance search", async () => {
    await renderScreen(<VehiclesScreen />);
    await screen.findByText("2022 Volvo XC60");
    await fireEvent.press(screen.getByLabelText("Toggle vehicle filters"));
    expect(mockLocationPermission).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByLabelText("Use my location"));
    await waitFor(() => expect(mockLocationPermission).toHaveBeenCalled());
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(
      expect.stringMatching(/originLatitude=9\.012&originLongitude=38\.757.*sort=DISTANCE/), { authenticated: true },
    ));
  });

  it("shows empty and error states", async () => {
    mockClient.get.mockImplementation((url: string) => url.startsWith("/api/v1/vehicles?")
      ? Promise.resolve({ items: [], nextCursor: null }) : Promise.resolve({ items: [] }));
    const view = await renderScreen(<VehiclesScreen />);
    expect(await screen.findByText("No vehicles found")).toBeTruthy();
    await view.unmount();
    mockClient.get.mockImplementation((url: string) => url.startsWith("/api/v1/vehicles?")
      ? Promise.reject(new Error("offline")) : Promise.resolve({ items: [] }));
    await renderScreen(<VehiclesScreen />);
    expect(await screen.findByText("Failed to load vehicles.")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});

describe("vehicle details", () => {
  beforeEach(() => { mockParams = { id: "vehicle-1" }; });

  it("renders the batch-presigned gallery, saves, contacts, and reports", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((title, _message, buttons) => {
      if (title === "Contact seller") buttons?.find((button) => button.text === "Contact as personal account")?.onPress?.();
      if (title === "Report vehicle") buttons?.find((button) => button.text === "Scam")?.onPress?.();
    });
    await renderScreen(<VehicleDetailScreen />);
    expect(await screen.findByLabelText("2022 Volvo XC60 image 1")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Save vehicle"));
    await waitFor(() => expect(mockClient.put).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1/save", {}, { authenticated: true }));
    await fireEvent.press(screen.getByLabelText("Contact seller"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1/contact", {}, { authenticated: true }));
    expect(mockRouter.push).toHaveBeenCalledWith("/messages/conversation-1");
    await fireEvent.press(screen.getByLabelText("Report vehicle"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1/report", { reason: "SCAM" }, { authenticated: true }));
    expect(mockClient.post).not.toHaveBeenCalledWith("/api/v1/conversations", expect.anything(), expect.anything());
  });

  it("exposes owner pause and SALE completion actions", async () => {
    currentDetail = makeView({ canManage: true });
    await renderScreen(<VehicleDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Pause listing"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1/pause", undefined, { authenticated: true }));
    await waitFor(() => expect(screen.getByLabelText("Mark as sold").props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByLabelText("Mark as sold"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1/sold", undefined, { authenticated: true }));
  });
});

describe("vehicle editor", () => {
  async function completeRequiredFields() {
    await fireEvent.press(await screen.findByText("Cars"));
    await waitFor(() => expect(screen.getByText("Cars").parent?.props.accessibilityState?.selected).toBe(true));
    await fireEvent.changeText(screen.getByPlaceholderText("Title"), "2022 Volvo XC60");
    await fireEvent.changeText(screen.getByPlaceholderText("Description"), "Well maintained family vehicle");
    await fireEvent.changeText(screen.getByPlaceholderText("Sale price"), "27500");
    await fireEvent.changeText(screen.getByPlaceholderText("City"), "Frankfurt");
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Title").props.value).toBe("2022 Volvo XC60");
      expect(screen.getByPlaceholderText("City").props.value).toBe("Frankfurt");
    });
  }

  it("selects an eligible Business Account and only requests location on demand", async () => {
    await renderScreen(<VehicleEditorScreen />);
    expect(await screen.findByText("Diasporum Motors")).toBeTruthy();
    expect(screen.queryByText("Billing Only")).toBeNull();
    expect(mockLocationPermission).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Diasporum Motors"));
    await completeRequiredFields();
    await fireEvent.press(screen.getByLabelText("Use my location"));
    await waitFor(() => expect(mockCurrentPosition).toHaveBeenCalled());
    await fireEvent.press(screen.getByLabelText("Save draft"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/vehicles", expect.objectContaining({
      businessAccountId: "business-1",
      title: "2022 Volvo XC60",
      location: expect.objectContaining({ city: "Frankfurt" }),
    }), { authenticated: true }));
    expect(mockClient.put).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1/media", { mediaIds: [] }, { authenticated: true });
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/vehicles/vehicle-1");
  });

  it("retains a created draft and explains default-deny publishing", async () => {
    const isApiError = jest.spyOn(ApiError, "isApiError");
    const entitlementError = new ApiError({ code: "FORBIDDEN", httpStatus: 403, message: "ENTITLEMENT_NOT_CONFIGURED" });
    let rejectPublish: (error: ApiError) => void = () => {};
    mockClient.post.mockImplementation((url: string) => {
      if (url === "/api/v1/vehicles/vehicle-1/publish") {
        return new Promise((_, reject: (error: ApiError) => void) => { rejectPublish = reject; });
      }
      return Promise.resolve(currentDetail);
    });
    await renderScreen(<VehicleEditorScreen />);
    await completeRequiredFields();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Publish vehicle"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      rejectPublish(entitlementError);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockClient.post).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1/publish", undefined, { authenticated: true });
    expect(isApiError).toHaveBeenCalled();
    expect(vehicleErrorMessage(entitlementError, "Could not save the vehicle.")).toMatch(/Vehicle publishing is not enabled/);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockClient.post.mock.calls.filter(([url]) => url === "/api/v1/vehicles")).toHaveLength(1);
  });

  it("shows an honest unavailable-catalogue state", async () => {
    mockClient.get.mockImplementation((url: string) => {
      if (url === "/api/v1/vehicles/categories") return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
    await renderScreen(<VehicleEditorScreen />);
    expect(await screen.findByText(/No active vehicle categories are configured/)).toBeTruthy();
  });

  it("loads and updates an editable listing", async () => {
    mockParams = { id: "vehicle-1" };
    currentDetail = makeView({ canManage: true }, { status: "DRAFT" });
    await renderScreen(<VehicleEditorScreen edit />);
    expect(await screen.findByDisplayValue("2022 Volvo XC60")).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText("Title"), "Updated Volvo");
    await waitFor(() => expect(screen.getByPlaceholderText("Title").props.value).toBe("Updated Volvo"));
    await fireEvent.press(screen.getByLabelText("Save changes"));
    await waitFor(() => expect(mockClient.patch).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1", expect.objectContaining({
      title: "Updated Volvo",
    }), { authenticated: true }));
    const request = mockClient.patch.mock.calls[0][1] as Record<string, unknown>;
    expect(request).not.toHaveProperty("businessAccountId");
    expect(mockClient.put).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1/media", {
      mediaIds: ["media-1"], coverMediaId: "media-1",
    }, { authenticated: true });
  });
});

describe("vehicle collections", () => {
  it.each([{ mode: "my" as const, title: "My vehicle listings" }, { mode: "saved" as const, title: "Saved vehicles" }])(
    "loads $title", async ({ mode, title }) => {
      await renderScreen(<VehicleCollectionScreen mode={mode} />);
      expect(await screen.findByText(title)).toBeTruthy();
      expect(await screen.findByText("2022 Volvo XC60")).toBeTruthy();
    },
  );

  it("filters owned listings by status and removes unsaved vehicles", async () => {
    const mine = await renderScreen(<VehicleCollectionScreen mode="my" />);
    await screen.findByText("2022 Volvo XC60");
    await fireEvent.press(screen.getByText("Draft"));
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining("status=DRAFT"), { authenticated: true }));
    await mine.unmount();
    await renderScreen(<VehicleCollectionScreen mode="saved" />);
    await fireEvent.press(await screen.findByLabelText("Unsave 2022 Volvo XC60"));
    await waitFor(() => expect(mockClient.delete).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1/save", { authenticated: true }));
    expect(await screen.findByText("No saved vehicles")).toBeTruthy();
  });
});
