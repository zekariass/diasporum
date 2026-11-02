import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import SpareBagScreen from "@/features/spare-bag/screens/spare-bag-screen";
import ListingEditorScreen from "@/features/spare-bag/screens/listing-editor-screen";
import ListingDetailScreen from "@/features/spare-bag/screens/listing-detail-screen";
import ContactRequestsScreen from "@/features/spare-bag/screens/contact-requests-screen";
import ListingCollectionScreen from "@/features/spare-bag/screens/listing-collection-screen";
import type { ContactRequest, Listing } from "@/features/spare-bag/types/spare-bag-types";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) };
const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
let mockParams: Record<string, string> = {};
let mockDiscoveryError = false;
let mockDiscoveryEmpty = false;

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({ apiClient: mockClient, session: { userId: "user-1" } }),
}));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(async () => "contact-key") }));

const ADD = {
  id: "add", countryId: "et", iataCode: "ADD", icaoCode: "HAAB",
  name: "Addis Ababa Bole International Airport", city: "Addis Ababa",
  countryName: "Ethiopia", countryIso2: "ET",
};
const LHR = { ...ADD, id: "lhr", countryId: "gb", iataCode: "LHR", city: "London", countryName: "United Kingdom", countryIso2: "GB" };

function makeListing(patch: Partial<Listing> = {}): Listing {
  return {
    id: "listing-1", ownerUserId: "owner-1", listingType: "SENDER_REQUEST",
    communityId: null, visibilityScope: "COUNTRY", originAirport: ADD,
    destinationAirport: LHR, title: "Documents to London",
    description: "Truthful documents only", travelDateStart: "2027-01-10",
    travelDateEnd: "2027-01-12", requestedWeightKg: 3,
    requestedParcelCount: 1, availableCapacityKg: null,
    availableParcelCount: null, maxSingleParcelKg: null, priceAmount: 12,
    priceUnit: "PER_KG", priceCurrency: "USD", collectionPlace: "Central station",
    handoverPlace: null, handoverNotes: null, status: "PUBLISHED",
    publishedAt: "2026-01-01T00:00:00Z", closesAt: null,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    categories: [], mediaIds: [], owner: { id: "owner-1", username: "owner", displayName: "Owner" },
    saved: false, canManage: false, collectionAddress: null, handoverAddress: null,
    ...patch,
  };
}

function makeContact(patch: Partial<ContactRequest> = {}): ContactRequest {
  return {
    id: "contact-1", senderListingId: "listing-1", passengerListingId: "listing-2",
    requestedByUserId: "sender", respondedByUserId: null, directConversationId: null,
    status: "PENDING", parcelWeightKg: 2, proposedPriceAmount: 20,
    proposedPriceUnit: "PER_KG", priceCurrency: "USD", message: "Can you help?",
    responseNote: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    respondedAt: null, expiresAt: null, senderListing: makeListing(),
    passengerListing: makeListing({ id: "listing-2", listingType: "PASSENGER_OFFER", availableCapacityKg: 8, requestedWeightKg: null }),
    otherOwner: { id: "sender", username: "sender", displayName: "Sender" }, incoming: true,
    ...patch,
  };
}

let listing = makeListing();
let contact = makeContact();

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockDiscoveryError = false;
  mockDiscoveryEmpty = false;
  listing = makeListing();
  contact = makeContact();
  mockClient.get.mockImplementation((url: string) => {
    if (url.startsWith("/api/v1/spare-bag/airports")) return Promise.resolve({ items: [ADD, LHR] });
    if (url === "/api/v1/spare-bag/categories") return Promise.resolve({ items: [{ key: "DOCUMENTS", displayName: "Documents", sortOrder: 1 }] });
    if (url.startsWith("/api/v1/spare-bag/listings?")) {
      if (mockDiscoveryError) return Promise.reject(new Error("offline"));
      return Promise.resolve({ items: mockDiscoveryEmpty ? [] : [listing], nextCursor: null });
    }
    if (url === "/api/v1/spare-bag/listings/listing-1") return Promise.resolve(listing);
    if (url.includes("/media/")) return Promise.resolve({ downloadUrl: "https://download.invalid/listing.jpg" });
    if (url.startsWith("/api/v1/me/spare-bag/listings/saved")) return Promise.resolve({ items: [listing], nextCursor: null });
    if (url.startsWith("/api/v1/me/spare-bag/listings")) return Promise.resolve({ items: [makeListing({ id: "own", listingType: "PASSENGER_OFFER", availableCapacityKg: 8, requestedWeightKg: null })], nextCursor: null });
    if (url.startsWith("/api/v1/spare-bag/contact-requests?")) return Promise.resolve({ items: [contact], nextCursor: null });
    return Promise.resolve({ items: [], nextCursor: null });
  });
  mockClient.post.mockImplementation((url: string, body: Record<string, unknown>) => {
    if (url.endsWith("/publish")) {
      listing = { ...listing, status: "PUBLISHED" };
      return Promise.resolve(listing);
    }
    if (url === "/api/v1/spare-bag/listings") return Promise.resolve(makeListing({ id: "created", ...(body as Partial<Listing>) }));
    if (url.endsWith("/accept")) {
      contact = { ...contact, status: "ACCEPTED", directConversationId: "conversation-1" };
      return Promise.resolve(contact);
    }
    if (url.endsWith("/conversation")) return Promise.resolve({ ...contact, directConversationId: "conversation-1" });
    if (url === "/api/v1/spare-bag/contact-requests") return Promise.resolve(contact);
    return Promise.resolve({});
  });
  mockClient.put.mockImplementation((_url: string, body: Record<string, unknown>) => Promise.resolve({ ...listing, ...body }));
  mockClient.delete.mockResolvedValue({});
});

function renderScreen(component: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>{component}</SafeAreaProvider>);
}

describe("Spare Bag discovery and collections", () => {
  it("loads discovery and applies server-side type and date filters", async () => {
    await renderScreen(<SpareBagScreen />);
    expect(await screen.findByText("Documents to London")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Filters"));
    await fireEvent.press(screen.getByLabelText("Senders"));
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining("listingType=SENDER_REQUEST"), { authenticated: true }));
    await fireEvent.changeText(screen.getByLabelText("Travel from"), "2027-01-01");
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining("dateFrom=2027-01-01"), { authenticated: true }));
  });

  it("shows an empty discovery state", async () => {
    mockDiscoveryEmpty = true;
    await renderScreen(<SpareBagScreen />);
    expect(await screen.findByText("Nothing here yet")).toBeTruthy();
  });

  it("shows a recoverable discovery error", async () => {
    mockDiscoveryError = true;
    await renderScreen(<SpareBagScreen />);
    expect(await screen.findByText("Could not load Spare Bag listings.")).toBeTruthy();
    expect(screen.getByLabelText("Try again")).toBeTruthy();
  });

  it("loads owner and saved collections through their real endpoints", async () => {
    const view = await renderScreen(<ListingCollectionScreen mode="mine" />);
    expect(await screen.findByText("Documents to London")).toBeTruthy();
    expect(mockClient.get).toHaveBeenCalledWith("/api/v1/me/spare-bag/listings?size=20", { authenticated: true });
    await view.unmount();
    await renderScreen(<ListingCollectionScreen mode="saved" />);
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith("/api/v1/me/spare-bag/listings/saved?size=20", { authenticated: true }));
  });
});

describe("Spare Bag creation and detail", () => {
  async function fillCommonFields(type: "SENDER_REQUEST" | "PASSENGER_OFFER") {
    await renderScreen(<ListingEditorScreen listingType={type} />);
    await fireEvent.changeText(await screen.findByLabelText("Title"), "Route listing");
    await fireEvent.changeText(screen.getByLabelText("Description"), "Documents only, declared truthfully");
    await fireEvent.changeText(screen.getByLabelText("Travel start"), "2027-01-10");
    await fireEvent.changeText(screen.getByLabelText("Weight in kilograms"), "4");
    await fireEvent.changeText(screen.getByLabelText("Price"), "12");
    await fireEvent.changeText(screen.getByLabelText("Collection place"), "Central station");
    await fireEvent.press(screen.getAllByLabelText("ADD — Addis Ababa")[0]);
    await fireEvent.press(screen.getAllByLabelText("LHR — London")[1]);
  }

  it("submits a sender request as a draft for review", async () => {
    await fillCommonFields("SENDER_REQUEST");
    await fireEvent.press(screen.getByLabelText("Save draft for review"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/spare-bag/listings", expect.objectContaining({ listingType: "SENDER_REQUEST", requestedWeightKg: 4 }), { authenticated: true }));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/spare-bag/created");
  });

  it("submits a passenger offer with available capacity", async () => {
    await fillCommonFields("PASSENGER_OFFER");
    await fireEvent.press(screen.getByLabelText("Save draft for review"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/spare-bag/listings", expect.objectContaining({ listingType: "PASSENGER_OFFER", availableCapacityKg: 4 }), { authenticated: true }));
  });

  it("edits a listing without dropping its private-address reference", async () => {
    mockParams = { id: "listing-1" };
    listing = makeListing({ status: "DRAFT", canManage: true, collectionAddress: { id: "address", addressLine1: "1 Private Road", addressLine2: null, city: "Addis Ababa", region: null, postalCode: null, formattedAddress: null } });
    await renderScreen(<ListingEditorScreen />);
    await fireEvent.changeText(await screen.findByDisplayValue("Documents to London"), "Updated documents");
    await fireEvent.press(screen.getByLabelText("Save changes"));
    await waitFor(() => expect(mockClient.put).toHaveBeenCalledWith("/api/v1/spare-bag/listings/listing-1", expect.objectContaining({ title: "Updated documents", collectionAddressId: "address" }), { authenticated: true }));
  });

  it("publishes an owner draft after review", async () => {
    mockParams = { id: "listing-1" };
    listing = makeListing({ status: "DRAFT", canManage: true });
    await renderScreen(<ListingDetailScreen />);
    await fireEvent.press(await screen.findByLabelText("Review and publish"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/spare-bag/listings/listing-1/publish", {}, { authenticated: true }));
  });

  it("saves a listing and loads its authorized media URL", async () => {
    mockParams = { id: "listing-1" };
    listing = makeListing({ mediaIds: ["media-1"] });
    await renderScreen(<ListingDetailScreen />);
    expect(await screen.findByLabelText("Listing image")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Save listing"));
    await waitFor(() => expect(mockClient.put).toHaveBeenCalledWith("/api/v1/spare-bag/listings/listing-1/save", {}, { authenticated: true }));
  });

  it("only renders an exact address returned by the backend", async () => {
    mockParams = { id: "listing-1" };
    listing = makeListing({ collectionAddress: { id: "address", addressLine1: "1 Private Road", addressLine2: null, city: "Addis Ababa", region: null, postalCode: null, formattedAddress: null } });
    await renderScreen(<ListingDetailScreen />);
    expect(await screen.findByText("1 Private Road, Addis Ababa")).toBeTruthy();
  });

  it("creates a compatible contact request with an idempotency key", async () => {
    mockParams = { id: "listing-1" };
    await renderScreen(<ListingDetailScreen />);
    await fireEvent.changeText(await screen.findByLabelText("Contact message"), "Documents only");
    await fireEvent.press(screen.getByLabelText("Send contact request"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/spare-bag/contact-requests", expect.objectContaining({ ownListingId: "own", targetListingId: "listing-1", idempotencyKey: "contact-key", message: "Documents only" }), { authenticated: true }));
  });
});

describe("Spare Bag contacts", () => {
  it("accepts an incoming request and opens the existing messaging UI", async () => {
    await renderScreen(<ContactRequestsScreen />);
    await fireEvent.press(await screen.findByLabelText("Accept"));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith("/api/v1/spare-bag/contact-requests/contact-1/accept", { responseNote: undefined }, { authenticated: true }));
    await fireEvent.press(await screen.findByLabelText("Open conversation"));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith("/(app)/messages/conversation-1"));
  });
});
