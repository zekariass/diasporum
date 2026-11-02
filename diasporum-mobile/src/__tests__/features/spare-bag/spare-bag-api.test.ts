import type { ApiClient } from "@/core/api/api-client";
import { createSpareBagApi } from "@/features/spare-bag/services/spare-bag-api";
import { uploadSpareBagImage } from "@/features/spare-bag/services/spare-bag-media";

const mockUploadFetch = jest.fn();
jest.mock("expo/fetch", () => ({ fetch: (...args: unknown[]) => mockUploadFetch(...args) }));
jest.mock("expo-file-system", () => ({
  File: class MockFile {
    size = 123;
  },
}));

const client = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
} as unknown as ApiClient;
const mocks = client as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

describe("Spare Bag API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocks.get.mockResolvedValue({ items: [], nextCursor: null });
    mocks.post.mockResolvedValue({});
    mocks.put.mockResolvedValue({});
    mocks.delete.mockResolvedValue(undefined);
  });

  it("constructs encoded discovery filters and cursor queries", async () => {
    await createSpareBagApi(client).discover({
      listingType: "PASSENGER_OFFER",
      originAirportId: "origin id",
      destinationAirportId: "destination",
      dateFrom: "2027-01-01",
      maxPrice: "25.50",
      minimumCapacityKg: "4",
      priceCurrency: "USD",
      categoryKey: "DOCUMENTS",
    }, "cursor/value", 10);
    expect(mocks.get).toHaveBeenCalledWith(
      "/api/v1/spare-bag/listings?listingType=PASSENGER_OFFER&originAirportId=origin%20id&destinationAirportId=destination&dateFrom=2027-01-01&maxPrice=25.50&minimumCapacityKg=4&priceCurrency=USD&categoryKey=DOCUMENTS&cursor=cursor%2Fvalue&size=10",
      { authenticated: true },
    );
  });

  it("uses real owner lifecycle, saved, media, and reporting endpoints", async () => {
    const api = createSpareBagApi(client);
    await api.publish("listing-1");
    await api.pause("listing-1");
    await api.close("listing-1");
    await api.save("listing-1");
    await api.unsave("listing-1");
    await api.mediaDownloadUrl("listing-1", "media-1");
    await api.reportListing("listing-1", "OTHER", "Details");
    expect(mocks.post).toHaveBeenCalledWith("/api/v1/spare-bag/listings/listing-1/publish", {}, { authenticated: true });
    expect(mocks.post).toHaveBeenCalledWith("/api/v1/spare-bag/listings/listing-1/pause", {}, { authenticated: true });
    expect(mocks.post).toHaveBeenCalledWith("/api/v1/spare-bag/listings/listing-1/close", {}, { authenticated: true });
    expect(mocks.put).toHaveBeenCalledWith("/api/v1/spare-bag/listings/listing-1/save", {}, { authenticated: true });
    expect(mocks.delete).toHaveBeenCalledWith("/api/v1/spare-bag/listings/listing-1/save", { authenticated: true });
    expect(mocks.get).toHaveBeenCalledWith("/api/v1/spare-bag/listings/listing-1/media/media-1/download-url", { authenticated: true });
  });

  it("keeps contact direction, idempotency, and messaging on backend contracts", async () => {
    const api = createSpareBagApi(client);
    await api.contacts("OUTGOING", "next", 15);
    await api.createContact({
      ownListingId: "own",
      targetListingId: "target",
      idempotencyKey: "unique-key",
      message: "Documents only",
    });
    await api.accept("contact-1", "Accepted");
    await api.conversation("contact-1");
    expect(mocks.get).toHaveBeenCalledWith("/api/v1/spare-bag/contact-requests?direction=OUTGOING&cursor=next&size=15", { authenticated: true });
    expect(mocks.post).toHaveBeenCalledWith("/api/v1/spare-bag/contact-requests", expect.objectContaining({ idempotencyKey: "unique-key" }), { authenticated: true });
    expect(mocks.post).toHaveBeenCalledWith("/api/v1/spare-bag/contact-requests/contact-1/accept", { responseNote: "Accepted" }, { authenticated: true });
    expect(mocks.post).toHaveBeenCalledWith("/api/v1/spare-bag/contact-requests/contact-1/conversation", {}, { authenticated: true });
  });

  it("uploads listing images with the Spare Bag media purpose", async () => {
    mocks.post
      .mockResolvedValueOnce({ assetId: "asset-1", uploadUrl: "https://upload.invalid" })
      .mockResolvedValueOnce({ assetId: "asset-1", status: "READY" });
    mockUploadFetch.mockResolvedValue({ ok: true });
    const id = await uploadSpareBagImage(client, { uri: "file://image.jpg", mimeType: "image/jpeg", size: 123 });
    expect(id).toBe("asset-1");
    expect(mocks.post).toHaveBeenNthCalledWith(1, "/api/v1/media/uploads", {
      purpose: "SPARE_BAG_LISTING",
      mimeType: "image/jpeg",
      declaredSizeBytes: 123,
    }, { authenticated: true });
    expect(mockUploadFetch).toHaveBeenCalledWith("https://upload.invalid", expect.objectContaining({ method: "PUT" }));
    expect(mocks.post).toHaveBeenNthCalledWith(2, "/api/v1/media/uploads/asset-1/complete", { declaredSizeBytes: 123 }, { authenticated: true });
  });
});
