import React from "react";
import { Linking, View } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import PropertiesScreen from "@/features/property/screens/properties-screen";
import PropertyDetailScreen from "@/features/property/screens/property-detail-screen";
import PropertyFormScreen from "@/features/property/screens/property-form-screen";
import MyPropertiesScreen from "@/features/property/screens/my-properties-screen";
import { PropertyMediaManager } from "@/features/property/components/property-media-manager";
import { PropertyCard } from "@/features/property/components/property-card";
import SavedPropertiesScreen from "@/features/property/screens/saved-properties-screen";
import type {
  PropertyDetail,
  PropertyItem,
} from "@/features/property/types/property-types";

jest.setTimeout(30_000);

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
let mockClient = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};
const mockSession = {
  me: { id: "user-1" },
  profile: { currentCountryId: "country-1" },
  activeCommunityId: "community-1",
  memberships: [
    {
      communityId: "community-1",
      userId: "user-1",
      role: "MEMBER",
      status: "ACTIVE",
      joinedAt: "2026-01-01",
    },
  ],
};
let mockParams: Record<string, string> = {};
const mockLocation = {
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn((_options?: unknown) =>
    Promise.resolve({ coords: { latitude: 0, longitude: 0 } }),
  ),
  Accuracy: { Balanced: 3 },
};

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: () =>
    mockLocation.requestForegroundPermissionsAsync(),
  getCurrentPositionAsync: (options?: unknown) =>
    mockLocation.getCurrentPositionAsync(options),
  Accuracy: { Balanced: 3 },
}));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
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
    id: "property-1",
    countryId: "country-1",
    communityId: "community-1",
    ownerUserId: "owner-1",
    businessAccountId: null,
    businessListingId: null,
    createdByUserId: "owner-1",
    propertyTypeId: "type-1",
    visibilityScope: "COMMUNITY",
    listingPurpose: "RENT",
    title: "Sunny apartment",
    description: "A bright home near transit.",
    additionalAttributes: null,
    priceAmount: 1200,
    currencyCode: "EUR",
    pricePeriod: "MONTH",
    bedrooms: 2,
    bathrooms: 1,
    receptionRooms: 1,
    floorArea: 70,
    floorAreaUnit: "SQM",
    furnishedStatus: "FURNISHED",
    rentalDeposit: 2400,
    billsIncluded: false,
    minimumTenancyMonths: 12,
    availabilityDate: "2026-08-01",
    tenure: null,
    conditionKey: "GOOD",
    status: "PUBLISHED",
    expiresAt: null,
    publishedAt: "2026-01-01",
    closedAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
  propertyType: type,
  location: {
    city: "Frankfurt",
    region: "Hesse",
    latitude: 50.11,
    longitude: 8.68,
  },
  coverMediaId: null,
  saved: false,
  canManage: false,
  viewCount: 0,
  enquiryCount: 0,
  saveCount: 0,
};
const detail: PropertyDetail = {
  item,
  media: [],
  amenities: [
    { id: "amenity-1", amenityKey: "BALCONY", displayName: "Balcony" },
  ],
  contact: {
    phone: "+491234",
    whatsapp: null,
    email: "owner@example.com",
    preferredMethod: "PHONE",
  },
  owner: { displayName: "Owner", businessAccountName: null },
  listedBy: null,
  privateAddress: null,
  communityIds: [],
};

function cloneDetail(
  overrides: Partial<PropertyItem> = {},
  status?: PropertyItem["property"]["status"],
): PropertyDetail {
  return {
    ...detail,
    item: {
      ...item,
      ...overrides,
      property: {
        ...item.property,
        ...(overrides.property ?? {}),
        ...(status ? { status } : {}),
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClient = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  mockParams = {};
  mockClient.get.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/properties/types"))
      return Promise.resolve({ items: [type] });
    if (path === "/api/v1/properties/amenities")
      return Promise.resolve({ items: detail.amenities });
    if (path === "/api/v1/business-accounts")
      return Promise.resolve({
        items: [
          {
            id: "business-1",
            accountName: "Diaspora Homes",
            status: "ACTIVE",
            role: "LISTING_MANAGER",
            profileCount: 0,
            createdAt: "2026-01-01",
          },
        ],
      });
    if (path === "/api/v1/me/communities/available")
      return Promise.resolve({
        items: [
          {
            id: "community-1",
            name: "Frankfurt Community",
            slug: "frankfurt",
            originCountryId: "origin-1",
            destinationCountryId: "country-1",
            description: null,
            active: true,
          },
        ],
      });
    if (path === "/api/v1/business-accounts/business-1/workspace")
      return Promise.resolve({
        id: "business-1",
        accountName: "Diaspora Homes",
        status: "ACTIVE",
        role: "LISTING_MANAGER",
        profileCount: 0,
        createdAt: "2026-01-01",
        capabilities: {
          manageProfiles: false,
          manageListings: true,
          manageTeam: false,
          manageBilling: false,
          manageSettings: false,
        },
      });
    if (path === "/api/v1/properties/property-1")
      return Promise.resolve(cloneDetail());
    if (path.includes("/download-url"))
      return Promise.resolve({
        downloadUrl: "https://images.example/photo.jpg",
      });
    if (path.startsWith("/api/v1/me/properties"))
      return Promise.resolve({ items: [item], nextCursor: null });
    if (path.startsWith("/api/v1/properties?"))
      return Promise.resolve({
        items: [item],
        nextCursor: null,
        totalCount: 1,
      });
    if (path === "/api/v1/communities/community-1")
      return Promise.resolve({ name: "Frankfurt Community" });
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
  mockClient.post.mockImplementation((path: string) => {
    if (path.endsWith("/enquiry"))
      return Promise.resolve({ conversationId: "conversation-1" });
    if (path.endsWith("/publish"))
      return Promise.resolve(cloneDetail({ canManage: true }, "PUBLISHED"));
    if (path.endsWith("/report")) return Promise.resolve({ id: "report-1" });
    if (path === "/api/v1/properties")
      return Promise.resolve(cloneDetail({ canManage: true }, "DRAFT"));
    return Promise.resolve(cloneDetail());
  });
  mockClient.put.mockResolvedValue(undefined);
  mockClient.delete.mockResolvedValue(undefined);
});

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

describe("Property discovery UI", () => {
  const queries = () =>
    mockClient.get.mock.calls
      .map(([path]) => String(path))
      .filter((path) => path.startsWith("/api/v1/properties?"));
  const apply = async () =>
    fireEvent.press(
      screen.getByRole("button", {
        name: /^Show (results|\d+ propert(?:y|ies))$/,
      }),
    );

  it("loads API results, defaults to Buy, and switches the purpose", async () => {
    await renderScreen(<PropertiesScreen />);
    expect(await screen.findByText("Sunny apartment")).toBeTruthy();
    expect(queries().at(-1)).toContain("listingPurpose=SALE");
    expect(screen.getByText("1 property")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Rent"));
    await waitFor(() =>
      expect(queries().at(-1)).toContain("listingPurpose=RENT"),
    );
  });

  it("keeps draft filters separate and preserves applied selections on reopening", async () => {
    await renderScreen(<PropertiesScreen />);
    await fireEvent.press(screen.getByLabelText("Filters"));
    await fireEvent.changeText(screen.getByLabelText("City or area"), "Berlin");
    await fireEvent.press(
      screen.getByRole("button", { name: "Close Filter Properties" }),
    );
    await fireEvent.press(screen.getByLabelText("Filters"));
    expect(screen.getByLabelText("City or area")).toHaveProp("value", "");
    await fireEvent.changeText(
      screen.getByLabelText("City or area"),
      "Frankfurt",
    );
    await apply();
    await waitFor(() => expect(queries().at(-1)).toContain("city=Frankfurt"));
    expect(screen.queryByLabelText("City or area")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Filters (1)"));
    expect(screen.getByLabelText("City or area")).toHaveProp(
      "value",
      "Frankfurt",
    );
    await fireEvent.press(screen.getByLabelText("Clear all"));
    expect(screen.getByLabelText("City or area")).toHaveProp("value", "");
    await apply();
    await waitFor(() => expect(queries().at(-1)).not.toContain("city="));
  });

  it("retains manual filters after location permission is denied", async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
    });
    await renderScreen(<PropertiesScreen />);
    expect(
      mockLocation.requestForegroundPermissionsAsync,
    ).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Filters"));
    await fireEvent.changeText(screen.getByLabelText("City or area"), "Berlin");
    await fireEvent.press(
      screen.getByLabelText("Search near my current location"),
    );
    expect(await screen.findByText(/can still search by city/i)).toBeTruthy();
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText("City or area")).toHaveProp("value", "Berlin");
    await apply();
    await waitFor(() => expect(queries().at(-1)).toContain("city=Berlin"));
  });

  it("applies nearby coordinates only after Show results", async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
    });
    await renderScreen(<PropertiesScreen />);
    await fireEvent.press(screen.getByLabelText("Filters"));
    expect(screen.getByLabelText("Search radius in kilometres")).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText("Search near my current location"),
    );
    await screen.findByLabelText("Nearby search enabled");
    expect(
      queries()
        .filter((path) => path.includes("size=20"))
        .at(-1),
    ).not.toContain("radiusKm");
    await apply();
    await waitFor(() =>
      expect(queries().at(-1)).toContain("latitude=0&longitude=0&radiusKm=25"),
    );
  });

  it("adapts filters to enabled country property types and validates price ranges", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.includes("/types"))
        return Promise.resolve({
          items: [
            type,
            {
              id: "type-land",
              typeKey: "LAND",
              displayName: "Local land name",
            },
          ],
        });
      return Promise.resolve({
        items: [item],
        nextCursor: null,
        totalCount: 1,
      });
    });
    await renderScreen(<PropertiesScreen />);
    await fireEvent.press(screen.getByLabelText("Filters"));
    expect(screen.getByLabelText("Bedrooms: Any")).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText("Local land name"));
    expect(screen.queryByLabelText("Bedrooms: Any")).toBeNull();
    expect(screen.queryByLabelText("Bathrooms: Any")).toBeNull();
    expect(screen.queryByText("Furnishing")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Apartment"));
    expect(screen.getByLabelText("Bedrooms: Any")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Minimum price"), "1000");
    await fireEvent.changeText(screen.getByLabelText("Maximum price"), "500");
    expect(screen.getByRole("button", { name: /^Show / })).toBeDisabled();
  });

  it("uses backend sorting and navigates to saved properties", async () => {
    await renderScreen(<PropertiesScreen />);
    await fireEvent.press(screen.getByLabelText("Sort properties"));
    await fireEvent.press(screen.getByLabelText("Price: low to high"));
    await waitFor(() => expect(queries().at(-1)).toContain("sort=PRICE_ASC"));
    await fireEvent.press(screen.getByLabelText("Saved properties"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/properties/saved");
  });

  it("shows asynchronous error and retry states", async () => {
    mockClient.get.mockRejectedValue(new Error("offline"));
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
    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/properties/property-1/save",
        {},
        { authenticated: true },
      ),
    );
    await fireEvent.press(screen.getByLabelText("Message"));
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith("/messages/conversation-1"),
    );
  });

  it("publishes a reviewed draft and offers terminal close", async () => {
    mockParams = { id: "property-1" };
    mockClient.get.mockImplementation((path: string) =>
      path === "/api/v1/properties/property-1"
        ? Promise.resolve(cloneDetail({ canManage: true }, "DRAFT"))
        : Promise.reject(new Error(path)),
    );
    await renderScreen(<PropertyDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Publish property"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/properties/property-1/publish",
        undefined,
        { authenticated: true },
      ),
    );
    expect(await screen.findByLabelText("Close property")).toBeTruthy();
  });

  it("marks a published rental as rented and reopens an expired listing", async () => {
    mockParams = { id: "property-1" };
    mockClient.get.mockImplementation((path: string) =>
      path === "/api/v1/properties/property-1"
        ? Promise.resolve(cloneDetail({ canManage: true }, "PUBLISHED"))
        : Promise.reject(new Error(path)),
    );
    await renderScreen(<PropertyDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Mark as rented"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/properties/property-1/rented",
        undefined,
        { authenticated: true },
      ),
    );

    mockClient.get.mockImplementation((path: string) =>
      path === "/api/v1/properties/property-1"
        ? Promise.resolve(cloneDetail({ canManage: true }, "EXPIRED"))
        : Promise.reject(new Error(path)),
    );
    await renderScreen(<PropertyDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Reopen property"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/properties/property-1/reopen",
        undefined,
        { authenticated: true },
      ),
    );
  });

  it("resolves individual advertiser photos through the block-checked avatar endpoint", async () => {
    mockParams = { id: "property-1" };
    mockClient.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/avatar/download-url")
          ? { downloadUrl: "https://images.example/avatar.jpg" }
          : {
              ...detail,
              owner: { ...detail.owner, avatarMediaId: "avatar-1" },
            },
      ),
    );
    await renderScreen(<PropertyDetailScreen />);
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        "/api/v1/social/profiles/owner-1/avatar/download-url",
        { authenticated: true },
      ),
    );
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  it("uses authorized business logos and the existing public profile route", async () => {
    mockParams = { id: "property-1" };
    mockClient.get.mockResolvedValue({
      ...detail,
      listedBy: {
        businessId: "agency-1",
        name: "Local agency",
        categoryName: "Estate agency",
        verificationStatus: "VERIFIED",
        logoMediaId: "logo-1",
      },
    });
    mockClient.post.mockResolvedValue({
      downloadUrl: "https://images.example/logo.jpg",
    });
    await renderScreen(<PropertyDetailScreen />);
    expect(await screen.findByLabelText("Local agency logo")).toHaveProp(
      "source",
      { uri: "https://images.example/logo.jpg" },
    );
    expect(mockClient.post).toHaveBeenCalledWith(
      "/api/v1/businesses/agency-1/media/logo-1/download-url",
      undefined,
      { authenticated: true },
    );
    await fireEvent.press(screen.getByLabelText("View Local agency"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/businesses/agency-1");
  });

  it("submits a report through the shared moderation endpoint", async () => {
    mockParams = { id: "property-1" };
    await renderScreen(<PropertyDetailScreen />);
    await fireEvent.press(
      await screen.findByLabelText("More property options"),
    );
    await fireEvent.press(screen.getByLabelText("Report Listing"));
    await fireEvent.press(screen.getByLabelText("scam"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/properties/property-1/report",
        { reason: "SCAM" },
        { authenticated: true },
      ),
    );
    expect(await screen.findByText(/Report submitted/)).toBeTruthy();
  });
});

describe("Property gallery", () => {
  it("opens ordered property images in the shared full-screen viewer", async () => {
    mockParams = { id: "property-1" };
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith("/download-url"))
        return Promise.resolve({
          downloadUrl: `https://images.example/${path.includes("media/m1/") ? "first" : "second"}.jpg`,
        });
      return Promise.resolve({
        ...detail,
        media: [
          { mediaId: "m2", sortOrder: 1, cover: false },
          { mediaId: "m1", sortOrder: 0, cover: true },
        ],
      });
    });
    await renderScreen(<PropertyDetailScreen />);
    await fireEvent.press(
      await screen.findByLabelText("Open property photo 1 full screen"),
    );
    await waitFor(() => {
      const photos = screen.getAllByLabelText("Photo full screen");
      expect(photos).toHaveLength(2);
      expect(photos[0]).toHaveProp("source", {
        uri: "https://images.example/first.jpg",
      });
      expect(photos[1]).toHaveProp("source", {
        uri: "https://images.example/second.jpg",
      });
    });
    await fireEvent.press(screen.getByLabelText("Close photo viewer"));
    expect(screen.queryAllByLabelText("Photo full screen")).toHaveLength(0);
  });
});

describe("Property save and contact safety", () => {
  it("synchronizes cards and details, blocks duplicate saves and rolls back failures", async () => {
    let rejectSave!: (error: Error) => void;
    mockClient.put.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    mockParams = { id: "property-1" };
    const navigate = jest.fn();
    await renderScreen(
      <View>
        <PropertyCard item={item} onPress={navigate} />
        <PropertyDetailScreen />
      </View>,
    );
    await screen.findByLabelText("Message");
    await fireEvent.press(screen.getAllByLabelText("Save property")[0]);
    await fireEvent.press(
      screen.getAllByLabelText("Remove from saved properties")[0],
    );
    expect(mockClient.put).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(
      screen.getAllByLabelText("Remove from saved properties"),
    ).toHaveLength(2);
    await act(async () => rejectSave(new Error("offline")));
    await waitFor(() =>
      expect(screen.getAllByLabelText("Save property")).toHaveLength(2),
    );
    expect(
      screen.getAllByText(/Could not update saved properties/),
    ).toHaveLength(2);
  });

  it("removes an unsaved item from the saved collection", async () => {
    mockClient.get.mockResolvedValue({
      items: [{ ...item, saved: true }],
      nextCursor: null,
    });
    await renderScreen(<SavedPropertiesScreen />);
    await screen.findByText("Sunny apartment");
    mockClient.get.mockResolvedValue({ items: [], nextCursor: null });
    await fireEvent.press(
      screen.getByLabelText("Remove from saved properties"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Sunny apartment")).toBeNull(),
    );
    expect(mockClient.delete).toHaveBeenCalledWith(
      "/api/v1/properties/property-1/save",
      { authenticated: true },
    );
  });

  it("offers only projected contacts and opens the enabled phone method", async () => {
    mockParams = { id: "property-1" };
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await renderScreen(<PropertyDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Contact"));
    expect(screen.queryByLabelText("WhatsApp")).toBeNull();
    await fireEvent.press(screen.getAllByLabelText("Phone").at(-1)!);
    expect(open).toHaveBeenCalledWith("tel:+491234");
    open.mockRestore();
  });

  it("disables external contact when all methods are hidden but retains messaging", async () => {
    mockParams = { id: "property-1" };
    mockClient.get.mockResolvedValue({
      ...detail,
      contact: {
        phone: null,
        email: null,
        whatsapp: null,
        preferredMethod: null,
      },
    });
    await renderScreen(<PropertyDetailScreen />);
    expect(await screen.findByLabelText("Contact")).toBeDisabled();
    expect(screen.getByLabelText("Message")).toBeEnabled();
  });

  it.each(["SOLD", "RENTED", "EXPIRED", "PAUSED", "REMOVED"] as const)(
    "does not enable public actions on %s",
    async (status) => {
      mockParams = { id: "property-1" };
      mockClient.get.mockResolvedValue(cloneDetail({}, status));
      await renderScreen(<PropertyDetailScreen />);
      await screen.findByText("Sunny apartment");
      expect(screen.queryByLabelText("Message")).toBeNull();
      expect(screen.queryByLabelText("Contact")).toBeNull();
    },
  );

  it("rejects unsafe route parameters without calling the API", async () => {
    mockParams = { id: "../private" };
    await renderScreen(<PropertyDetailScreen />);
    expect(screen.getByText("Invalid property link.")).toBeTruthy();
    expect(mockClient.get).not.toHaveBeenCalled();
  });
});

describe("Property editor UI", () => {
  async function advance() {
    await fireEvent.press(screen.getByLabelText("Continue"));
  }
  async function fillBasics() {
    await fireEvent.press(
      await screen.findByLabelText("Property type (required)"),
    );
    await fireEvent.press(await screen.findByLabelText("Apartment"));
    await fireEvent.changeText(
      screen.getByLabelText("Title (required)"),
      "New home",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Description (required)"),
      "A complete description",
    );
  }
  async function fillPrice() {
    await fireEvent.changeText(
      await screen.findByLabelText("Price (required)"),
      "1500",
    );
  }
  async function fillLocation() {
    await fireEvent.changeText(
      await screen.findByLabelText("Street address"),
      "1 Main Street",
    );
    await fireEvent.changeText(
      screen.getByLabelText("City (required)"),
      "Frankfurt",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Exact latitude (optional)"),
      "50.1109",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Exact longitude (optional)"),
      "8.6821",
    );
  }
  async function fillValidForm() {
    await fillBasics();
    await advance();
    await fillPrice();
    await advance();
    await fillLocation();
    await advance();
    await advance(); // Amenities & contact has no required fields.
  }

  it("blocks step navigation until required basics are complete", async () => {
    await renderScreen(<PropertyFormScreen />);
    await fireEvent.press(await screen.findByLabelText("Continue"));
    expect(await screen.findByText("Choose a property type.")).toBeTruthy();
    expect(screen.getByText("Step 1 of 5")).toBeTruthy();
  });

  it("creates a draft with validated fields and enters the review flow", async () => {
    await renderScreen(<PropertyFormScreen />);
    await fillValidForm();
    await fireEvent.press(screen.getByLabelText("Review listing"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/properties",
        expect.objectContaining({
          countryId: "country-1",
          title: "New home",
          priceAmount: 1500,
          address: expect.objectContaining({ latitude: 50.1109 }),
        }),
        { authenticated: true },
      ),
    );
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith(
        "/(app)/properties/property-1",
      ),
    );
  });

  it("selects the currency from the shared dropdown", async () => {
    await renderScreen(<PropertyFormScreen />);
    await fillBasics();
    await advance();
    await fireEvent.press(await screen.findByLabelText("Currency"));
    await fireEvent.changeText(
      await screen.findByLabelText("Search currencies"),
      "us dollar",
    );
    await fireEvent.press(await screen.findByLabelText(/USD — US Dollar/));
    await fillPrice();
    await advance();
    await fillLocation();
    await advance();
    await advance();
    await fireEvent.press(screen.getByLabelText("Review listing"));
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/properties",
        expect.objectContaining({ currencyCode: "USD" }),
        { authenticated: true },
      ),
    );
  });

  it("revalidates business capabilities before creating", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path === "/api/v1/business-accounts/business-1/workspace")
        return Promise.resolve({
          status: "ACTIVE",
          capabilities: { manageListings: false },
        });
      if (path.startsWith("/api/v1/properties/types"))
        return Promise.resolve({ items: [type] });
      if (path === "/api/v1/properties/amenities")
        return Promise.resolve({ items: [] });
      if (path === "/api/v1/business-accounts")
        return Promise.resolve({
          items: [
            {
              id: "business-1",
              accountName: "Diaspora Homes",
              status: "ACTIVE",
              role: "LISTING_MANAGER",
            },
          ],
        });
      if (path === "/api/v1/me/communities/available")
        return Promise.resolve({
          items: [
            {
              id: "community-1",
              name: "Frankfurt Community",
              destinationCountryId: "country-1",
            },
          ],
        });
      return Promise.reject(new Error(path));
    });
    await renderScreen(<PropertyFormScreen />);
    await fillBasics();
    await advance();
    await fillPrice();
    await advance();
    await fireEvent.press(
      await screen.findByLabelText("List as Diaspora Homes"),
    );
    await fillLocation();
    await advance();
    await advance();
    await fireEvent.press(screen.getByLabelText("Save draft"));
    expect(
      await screen.findByText(/no longer grants property listing management/i),
    ).toBeTruthy();
    expect(mockClient.post).not.toHaveBeenCalledWith(
      "/api/v1/properties",
      expect.anything(),
      expect.anything(),
    );
  });

  it("reorders and removes uploaded media", async () => {
    const managed = cloneDetail({ canManage: true }, "DRAFT");
    managed.media = [
      { mediaId: "m1", sortOrder: 0, cover: true },
      { mediaId: "m2", sortOrder: 1, cover: false },
    ];
    mockClient.put.mockResolvedValue(managed);
    mockClient.delete.mockResolvedValue(managed);
    await renderScreen(
      <PropertyMediaManager detail={managed} onChange={jest.fn()} />,
    );
    await fireEvent.press(screen.getByLabelText("Move photo 1 later"));
    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/properties/property-1/media",
        { mediaIds: ["m2", "m1"], coverMediaId: "m1" },
        { authenticated: true },
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Remove photo 1")).toBeEnabled(),
    );
    await fireEvent.press(screen.getByLabelText("Remove photo 1"));
    await waitFor(() =>
      expect(mockClient.delete).toHaveBeenCalledWith(
        "/api/v1/properties/property-1/media/m1",
        { authenticated: true },
      ),
    );
  });
});

describe("Property management list UI", () => {
  it("filters owner listings by status", async () => {
    await renderScreen(<MyPropertiesScreen />);
    expect(await screen.findByText("Sunny apartment")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Draft properties"));
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        "/api/v1/me/properties?status=DRAFT&size=20",
        { authenticated: true },
      ),
    );
  });
});
