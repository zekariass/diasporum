import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import PropertiesScreen from "@/features/property/screens/properties-screen";
import PropertyDetailScreen from "@/features/property/screens/property-detail-screen";
import PropertyFormScreen from "@/features/property/screens/property-form-screen";
import MyPropertiesScreen from "@/features/property/screens/my-properties-screen";
import { PropertyMediaManager } from "@/features/property/components/property-media-manager";
import type { PropertyDetail, PropertyItem } from "@/features/property/types/property-types";

jest.setTimeout(30_000);

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };
const mockSession = {
  me: { id: "user-1" },
  profile: { currentCountryId: "country-1" },
  activeCommunityId: "community-1",
  memberships: [{ communityId: "community-1", userId: "user-1", role: "MEMBER", status: "ACTIVE", joinedAt: "2026-01-01" }],
};
let mockParams: Record<string, string> = {};
const mockLocation = {
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn((_options?: unknown) => Promise.resolve({ coords: { latitude: 0, longitude: 0 } })),
  Accuracy: { Balanced: 3 },
};

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: () => mockLocation.requestForegroundPermissionsAsync(),
  getCurrentPositionAsync: (options?: unknown) => mockLocation.getCurrentPositionAsync(options),
  Accuracy: { Balanced: 3 },
}));
jest.mock("expo-image-picker", () => ({ requestMediaLibraryPermissionsAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock("expo-router", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    router: mockRouter,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => actual.useEffect(effect, [effect]),
  };
});
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({ apiClient: mockClient, session: mockSession }),
}));

const type = { id: "type-1", typeKey: "APARTMENT", displayName: "Apartment" };
const item: PropertyItem = {
  property: {
    id: "property-1", countryId: "country-1", communityId: "community-1", ownerUserId: "owner-1", businessAccountId: null, createdByUserId: "owner-1", propertyTypeId: "type-1", visibilityScope: "COMMUNITY", listingPurpose: "RENT", title: "Sunny apartment", description: "A bright home near transit.", additionalAttributes: null, priceAmount: 1200, currencyCode: "EUR", pricePeriod: "MONTH", bedrooms: 2, bathrooms: 1, receptionRooms: 1, floorArea: 70, floorAreaUnit: "SQM", furnishedStatus: "FURNISHED", rentalDeposit: 2400, billsIncluded: false, minimumTenancyMonths: 12, availabilityDate: "2026-08-01", tenure: null, conditionKey: "GOOD", status: "PUBLISHED", expiresAt: null, publishedAt: "2026-01-01", closedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  propertyType: type,
  location: { city: "Frankfurt", region: "Hesse", latitude: 50.11, longitude: 8.68 },
  coverMediaId: null,
  saved: false,
  canManage: false,
};
const detail: PropertyDetail = {
  item,
  media: [],
  amenities: [{ id: "amenity-1", amenityKey: "BALCONY", displayName: "Balcony" }],
  contact: { phone: "+491234", whatsapp: null, email: "owner@example.com", preferredMethod: "PHONE" },
  owner: { displayName: "Owner", businessAccountName: null },
};

function cloneDetail(overrides: Partial<PropertyItem> = {}, status?: PropertyItem["property"]["status"]): PropertyDetail {
  return { ...detail, item: { ...item, ...overrides, property: { ...item.property, ...(overrides.property ?? {}), ...(status ? { status } : {}) } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockClient.get.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/properties/types")) return Promise.resolve({ items: [type] });
    if (path === "/api/v1/properties/amenities") return Promise.resolve({ items: detail.amenities });
    if (path === "/api/v1/business-accounts") return Promise.resolve({ items: [{ id: "business-1", accountName: "Diaspora Homes", status: "ACTIVE", role: "LISTING_MANAGER", profileCount: 0, createdAt: "2026-01-01" }] });
    if (path === "/api/v1/me/communities/available") return Promise.resolve({ items: [{ id: "community-1", name: "Frankfurt Community", slug: "frankfurt", originCountryId: "origin-1", destinationCountryId: "country-1", description: null, active: true }] });
    if (path === "/api/v1/business-accounts/business-1/workspace") return Promise.resolve({ id: "business-1", accountName: "Diaspora Homes", status: "ACTIVE", role: "LISTING_MANAGER", profileCount: 0, createdAt: "2026-01-01", capabilities: { manageProfiles: false, manageListings: true, manageTeam: false, manageBilling: false, manageSettings: false } });
    if (path === "/api/v1/properties/property-1") return Promise.resolve(cloneDetail());
    if (path.includes("/download-url")) return Promise.resolve({ downloadUrl: "https://images.example/photo.jpg" });
    if (path.startsWith("/api/v1/me/properties")) return Promise.resolve({ items: [item], nextCursor: null });
    if (path.startsWith("/api/v1/properties?")) return Promise.resolve({ items: [item], nextCursor: null });
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
  mockClient.post.mockImplementation((path: string) => {
    if (path.endsWith("/enquiry")) return Promise.resolve({ conversationId: "conversation-1" });
    if (path.endsWith("/publish")) return Promise.resolve(cloneDetail({ canManage: true }, "PUBLISHED"));
    if (path.endsWith("/report")) return Promise.resolve({ id: "report-1" });
    if (path === "/api/v1/properties") return Promise.resolve(cloneDetail({ canManage: true }, "DRAFT"));
    return Promise.resolve(cloneDetail());
  });
  mockClient.put.mockResolvedValue(undefined);
  mockClient.delete.mockResolvedValue(undefined);
});

async function renderScreen(component: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>{component}</SafeAreaProvider>);
}

describe("Property discovery UI", () => {
  it("loads real results and applies listing-purpose filters", async () => {
    await renderScreen(<PropertiesScreen />);
    expect(await screen.findByText("Sunny apartment")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("For rent"));
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining("listingPurpose=RENT"), { authenticated: true }));
    await fireEvent.press(screen.getByLabelText("Clear property filters"));
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(expect.not.stringContaining("listingPurpose="), { authenticated: true }));
  });

  it("requests location only for explicit nearby search and retains manual filters after denial", async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false });
    await renderScreen(<PropertiesScreen />);
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("More filters"));
    await fireEvent.changeText(await screen.findByLabelText("City"), "Berlin");
    await fireEvent.press(screen.getByLabelText("Search near my current location"));
    await waitFor(() => expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1));
    expect(await mockLocation.requestForegroundPermissionsAsync.mock.results[0]?.value).toEqual({ granted: false });
    expect(await screen.findByText(/can still search by city/i)).toBeTruthy();
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText("City")).toHaveProp("value", "Berlin");
  });

  it("shows asynchronous loading and error states", async () => {
    mockClient.get.mockImplementation((path: string) => path.startsWith("/api/v1/properties/types") ? Promise.resolve({ items: [] }) : Promise.reject(new Error("offline")));
    await renderScreen(<PropertiesScreen />);
    expect(await screen.findByText("Failed to load properties.")).toBeTruthy();
    expect(screen.getByLabelText("Retry")).toBeTruthy();
  });
});

describe("Property details UI", () => {
  it("saves a property and opens the shared enquiry conversation", async () => {
    mockParams = { id: "property-1" };
    await renderScreen(<PropertyDetailScreen />);
    expect(await screen.findByText("Sunny apartment")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Save property"));
    await waitFor(() => expect(mockClient.put).toHaveBeenCalledWith("/api/v1/properties/property-1/save", {}, { authenticated: true }));
    await fireEvent.press(screen.getByLabelText("Contact owner"));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith("/messages/conversation-1"));
  });

  it("publishes a reviewed draft and offers terminal close", async () => {
    mockParams = { id: "property-1" };
    mockClient.get.mockImplementation((path: string) => path === "/api/v1/properties/property-1" ? Promise.resolve(cloneDetail({ canManage: true }, "DRAFT")) : Promise.reject(new Error(path)));
    await renderScreen(<PropertyDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Publish property"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/properties/property-1/publish", undefined, { authenticated: true }));
    expect(await screen.findByLabelText("Close property")).toBeTruthy();
  });

  it("submits a report through the shared moderation endpoint", async () => {
    mockParams = { id: "property-1" };
    const alert = jest.spyOn(Alert, "alert").mockImplementation(((_title: string, _message?: string, buttons?: { text?: string; onPress?: () => void }[]) => {
      buttons?.find((button) => button.text === "scam")?.onPress?.();
    }) as never);
    await renderScreen(<PropertyDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Report property"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/properties/property-1/report", { reason: "SCAM" }, { authenticated: true }));
    alert.mockRestore();
  });
});

describe("Property editor UI", () => {
  async function fillValidForm() {
    await fireEvent.changeText(await screen.findByLabelText("Title (required)"), "New home");
    await fireEvent.changeText(screen.getByLabelText("Description (required)"), "A complete description");
    await fireEvent.press(screen.getByLabelText("Apartment"));
    await fireEvent.changeText(screen.getByLabelText("Price (required)"), "1500");
    await fireEvent.changeText(screen.getByLabelText("Street address"), "1 Main Street");
    await fireEvent.changeText(screen.getByLabelText("City (required)"), "Frankfurt");
    await fireEvent.changeText(screen.getByLabelText("Exact latitude"), "50.1109");
    await fireEvent.changeText(screen.getByLabelText("Exact longitude"), "8.6821");
  }

  it("creates a draft with validated fields and enters the review flow", async () => {
    await renderScreen(<PropertyFormScreen />);
    await fillValidForm();
    await fireEvent.press(screen.getByLabelText("Review listing"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/properties", expect.objectContaining({ countryId: "country-1", title: "New home", priceAmount: 1500, address: expect.objectContaining({ latitude: 50.1109 }) }), { authenticated: true }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/properties/property-1"));
  });

  it("revalidates business capabilities before creating", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path === "/api/v1/business-accounts/business-1/workspace") return Promise.resolve({ status: "ACTIVE", capabilities: { manageListings: false } });
      if (path.startsWith("/api/v1/properties/types")) return Promise.resolve({ items: [type] });
      if (path === "/api/v1/properties/amenities") return Promise.resolve({ items: [] });
      if (path === "/api/v1/business-accounts") return Promise.resolve({ items: [{ id: "business-1", accountName: "Diaspora Homes", status: "ACTIVE", role: "LISTING_MANAGER" }] });
      if (path === "/api/v1/me/communities/available") return Promise.resolve({ items: [{ id: "community-1", name: "Frankfurt Community", destinationCountryId: "country-1" }] });
      return Promise.reject(new Error(path));
    });
    await renderScreen(<PropertyFormScreen />);
    await fillValidForm();
    await fireEvent.press(screen.getByLabelText("List as Diaspora Homes"));
    await fireEvent.press(screen.getByLabelText("Save draft"));
    expect(await screen.findByText(/no longer grants property listing management/i)).toBeTruthy();
    expect(mockClient.post).not.toHaveBeenCalledWith("/api/v1/properties", expect.anything(), expect.anything());
  });

  it("reorders and removes uploaded media", async () => {
    const managed = cloneDetail({ canManage: true }, "DRAFT");
    managed.media = [{ mediaId: "m1", sortOrder: 0, cover: true }, { mediaId: "m2", sortOrder: 1, cover: false }];
    mockClient.put.mockResolvedValue(managed);
    mockClient.delete.mockResolvedValue(managed);
    await renderScreen(<PropertyMediaManager detail={managed} onChange={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText("Move photo 1 later"));
    await waitFor(() => expect(mockClient.put).toHaveBeenCalledWith("/api/v1/properties/property-1/media", { mediaIds: ["m2", "m1"], coverMediaId: "m1" }, { authenticated: true }));
    await waitFor(() => expect(screen.getByLabelText("Remove photo 1")).toBeEnabled());
    await fireEvent.press(screen.getByLabelText("Remove photo 1"));
    await waitFor(() => expect(mockClient.delete).toHaveBeenCalledWith("/api/v1/properties/property-1/media/m1", { authenticated: true }));
  });
});

describe("Property management list UI", () => {
  it("filters owner listings by status", async () => {
    await renderScreen(<MyPropertiesScreen />);
    expect(await screen.findByText("Sunny apartment")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("draft properties"));
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith("/api/v1/me/properties?status=DRAFT&size=20", { authenticated: true }));
  });
});
