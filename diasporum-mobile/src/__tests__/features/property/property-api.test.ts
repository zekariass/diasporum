import { createPropertyApi } from "@/features/property/services/property-api";
import { uploadPropertyImage } from "@/features/property/services/property-media";

const client = {
  get: jest.fn(() => Promise.resolve({})),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({})),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
};
const api = createPropertyApi(client as never);

beforeEach(() => jest.clearAllMocks());

describe("propertyApi", () => {
  it("builds structured discovery and cursor queries", async () => {
    await api.discover({ countryId: "country 1", listingPurpose: "RENT", propertyTypeId: "type-1", minPrice: 500, maxPrice: 1500, minBedrooms: 2, bathrooms: 1, furnishedStatus: "FURNISHED", city: "Frankfurt", search: "balcony", latitude: 50.1, longitude: 8.6, radiusKm: 25 }, "cursor/1", 10);
    expect(client.get).toHaveBeenCalledWith("/api/v1/properties?countryId=country%201&propertyTypeId=type-1&listingPurpose=RENT&minPrice=500&maxPrice=1500&minBedrooms=2&bathrooms=1&furnishedStatus=FURNISHED&city=Frankfurt&search=balcony&latitude=50.1&longitude=8.6&radiusKm=25&cursor=cursor%2F1&size=10", { authenticated: true });
  });

  it("loads catalogs and detail through authenticated endpoints", async () => {
    await api.types("country-1");
    await api.amenities();
    await api.detail("property-1");
    expect(client.get).toHaveBeenNthCalledWith(1, "/api/v1/properties/types?countryId=country-1", { authenticated: true });
    expect(client.get).toHaveBeenNthCalledWith(2, "/api/v1/properties/amenities", { authenticated: true });
    expect(client.get).toHaveBeenNthCalledWith(3, "/api/v1/properties/property-1", { authenticated: true });
  });

  it("creates and fully updates drafts without client-supplied ownership identity", async () => {
    const command = { countryId: "country-1", propertyTypeId: "type-1", listingPurpose: "SALE" as const, title: "Home", description: "Description", priceAmount: 100000, currencyCode: "EUR" };
    await api.create(command);
    await api.update("property-1", command);
    expect(client.post).toHaveBeenCalledWith("/api/v1/properties", command, { authenticated: true });
    expect(client.put).toHaveBeenCalledWith("/api/v1/properties/property-1", command, { authenticated: true });
  });

  it("uses the lifecycle endpoints", async () => {
    await api.publish("p1");
    await api.pause("p1");
    await api.reopen("p1");
    await api.close("p1");
    for (const action of ["publish", "pause", "reopen", "close"]) {
      expect(client.post).toHaveBeenCalledWith(`/api/v1/properties/p1/${action}`, undefined, { authenticated: true });
    }
  });

  it("filters owner listings and paginates saved listings", async () => {
    await api.mine("DRAFT", "business-1", "cur", 5);
    await api.saved("next", 15);
    expect(client.get).toHaveBeenNthCalledWith(1, "/api/v1/me/properties?status=DRAFT&businessAccountId=business-1&cursor=cur&size=5", { authenticated: true });
    expect(client.get).toHaveBeenNthCalledWith(2, "/api/v1/me/properties/saved?cursor=next&size=15", { authenticated: true });
  });

  it("saves and unsaves idempotently", async () => {
    await api.save("p1");
    await api.unsave("p1");
    expect(client.put).toHaveBeenCalledWith("/api/v1/properties/p1/save", {}, { authenticated: true });
    expect(client.delete).toHaveBeenCalledWith("/api/v1/properties/p1/save", { authenticated: true });
  });

  it("attaches, orders, removes, and resolves media", async () => {
    await api.attachMedia("p1", "m1");
    await api.reorderMedia("p1", ["m2", "m1"], "m2");
    await api.removeMedia("p1", "m1");
    await api.mediaUrl("p1", "m2");
    expect(client.post).toHaveBeenCalledWith("/api/v1/properties/p1/media/m1", undefined, { authenticated: true });
    expect(client.put).toHaveBeenCalledWith("/api/v1/properties/p1/media", { mediaIds: ["m2", "m1"], coverMediaId: "m2" }, { authenticated: true });
    expect(client.delete).toHaveBeenCalledWith("/api/v1/properties/p1/media/m1", { authenticated: true });
    expect(client.get).toHaveBeenCalledWith("/api/v1/properties/p1/media/m2/download-url", { authenticated: true });
  });

  it("starts enquiries and submits shared reports", async () => {
    await api.enquiry("p1");
    await api.report("p1", "SCAM", "  Suspicious terms  ");
    expect(client.post).toHaveBeenNthCalledWith(1, "/api/v1/properties/p1/enquiry", undefined, { authenticated: true });
    expect(client.post).toHaveBeenNthCalledWith(2, "/api/v1/properties/p1/report", { reason: "SCAM", details: "Suspicious terms" }, { authenticated: true });
  });
});

describe("uploadPropertyImage", () => {
  it("uses PROPERTY purpose and completes the shared R2 lifecycle", async () => {
    const blob = { size: 123 };
    const fetchMock = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(blob) } as never)
      .mockResolvedValueOnce({ ok: true } as never);
    client.post.mockResolvedValueOnce({ assetId: "media-1", uploadUrl: "https://upload.example" } as never).mockResolvedValueOnce({} as never);
    const id = await uploadPropertyImage(client as never, { uri: "file://photo.jpg", mimeType: "image/jpeg", size: 123 });
    expect(id).toBe("media-1");
    expect(client.post).toHaveBeenNthCalledWith(1, "/api/v1/media/uploads", { purpose: "PROPERTY", mimeType: "image/jpeg", declaredSizeBytes: 123 }, { authenticated: true });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://upload.example", expect.objectContaining({ method: "PUT", body: blob }));
    expect(client.post).toHaveBeenNthCalledWith(2, "/api/v1/media/uploads/media-1/complete", { declaredSizeBytes: 123 }, { authenticated: true });
    fetchMock.mockRestore();
  });

  it("cleans up a pending asset when storage upload fails", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve({ size: 10 }) } as never)
      .mockResolvedValueOnce({ ok: false } as never);
    client.post.mockResolvedValueOnce({ assetId: "media-1", uploadUrl: "https://upload.example" } as never);
    await expect(uploadPropertyImage(client as never, { uri: "file://photo.png", mimeType: "image/png", size: 10 })).rejects.toThrow("Image upload failed.");
    expect(client.delete).toHaveBeenCalledWith("/api/v1/media/media-1", { authenticated: true });
    fetchMock.mockRestore();
  });
});
