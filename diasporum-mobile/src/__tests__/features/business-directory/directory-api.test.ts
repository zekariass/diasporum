import {
  createDirectoryApi,
  uploadBusinessImage,
} from "@/features/business-directory/services/directory-api";

const client = {
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
};
const api = createDirectoryApi(client as never);
const AUTH = { authenticated: true };

beforeEach(() => {
  jest.clearAllMocks();
  client.get.mockResolvedValue({ items: [] });
  client.post.mockResolvedValue({});
  client.patch.mockResolvedValue({});
  client.put.mockResolvedValue({});
  client.delete.mockResolvedValue(undefined);
});

describe("Business Directory API", () => {
  it("serializes discovery filters, cursor, and page size", async () => {
    await api.discover(
      {
        countryId: "country-1",
        communityId: "community-1",
        categoryId: "category-1",
        city: "Addis Ababa",
        search: "coffee & tea",
        verifiedOnly: true,
        latitude: 9.03,
        longitude: 38.74,
        radiusMeters: 5000,
        sort: "distance",
      },
      "cursor-1",
      50,
    );

    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/businesses?countryId=country-1&communityId=community-1&categoryId=category-1&city=Addis%20Ababa&search=coffee%20%26%20tea&verifiedOnly=true&latitude=9.03&longitude=38.74&radiusMeters=5000&sort=distance&cursor=cursor-1&size=50",
      AUTH,
    );
  });

  it("keeps managed, saved, and account-filtered collections distinct", async () => {
    await api.managed("account-1", "managed-cursor");
    await api.saved("saved-cursor");

    expect(client.get).toHaveBeenNthCalledWith(
      1,
      "/api/v1/me/businesses?businessAccountId=account-1&cursor=managed-cursor&size=20",
      AUTH,
    );
    expect(client.get).toHaveBeenNthCalledWith(
      2,
      "/api/v1/me/businesses/saved?cursor=saved-cursor&size=20",
      AUTH,
    );
  });

  it("uses the expected lifecycle and verification endpoints", async () => {
    await api.publish("business-1");
    await api.unpublish("business-1");
    await api.requestVerification("business-1");

    expect(client.post).toHaveBeenNthCalledWith(
      1,
      "/api/v1/businesses/business-1/publish",
      undefined,
      AUTH,
    );
    expect(client.post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/businesses/business-1/unpublish",
      undefined,
      AUTH,
    );
    expect(client.post).toHaveBeenNthCalledWith(
      3,
      "/api/v1/businesses/business-1/verification/request",
      undefined,
      AUTH,
    );
  });

  it("sends branch hours as a complete weekday replacement", async () => {
    const hours = [
      { dayOfWeek: 1, openTime: "09:00", closeTime: "17:00", closed: false },
      { dayOfWeek: 7, openTime: null, closeTime: null, closed: true },
    ];
    await api.replaceHours("business-1", "branch-1", hours);

    expect(client.put).toHaveBeenCalledWith(
      "/api/v1/businesses/business-1/locations/branch-1/hours",
      { hours },
      AUTH,
    );
  });

  it("authorizes images through the parent business rather than generic media", async () => {
    client.post.mockResolvedValue({ downloadUrl: "https://signed.example/image" });
    const result = await api.mediaUrl("business-1", "media-1");

    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/businesses/business-1/media/media-1/download-url",
      undefined,
      AUTH,
    );
    expect(result.downloadUrl).toContain("signed.example");
  });

  it("delegates contact to the BUSINESS_PROFILE conversation endpoint", async () => {
    client.post.mockResolvedValue({ conversationId: "conversation-1" });
    await api.contact("business-1");

    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/businesses/business-1/contact",
      undefined,
      AUTH,
    );
  });

  it("uploads and completes BUSINESS media before attaching its role", async () => {
    const file = new Blob(["image"], { type: "image/jpeg" });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ blob: async () => file })
      .mockResolvedValueOnce({ ok: true });
    globalThis.fetch = fetchMock as typeof fetch;
    client.post
      .mockResolvedValueOnce({ assetId: "asset-1", uploadUrl: "https://upload.example" })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ mediaId: "asset-1", role: "LOGO", sortOrder: 0 });

    await uploadBusinessImage(
      client as never,
      "business-1",
      { uri: "file:///logo.jpg", mimeType: "image/jpeg" },
      "LOGO",
    );

    expect(client.post).toHaveBeenNthCalledWith(
      1,
      "/api/v1/media/uploads",
      {
        purpose: "BUSINESS",
        mimeType: "image/jpeg",
        declaredSizeBytes: file.size,
      },
      AUTH,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://upload.example",
      expect.objectContaining({ method: "PUT", body: file }),
    );
    expect(client.post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/media/uploads/asset-1/complete",
      { declaredSizeBytes: file.size },
      AUTH,
    );
    expect(client.post).toHaveBeenNthCalledWith(
      3,
      "/api/v1/businesses/business-1/media",
      { mediaId: "asset-1", role: "LOGO", sortOrder: 0 },
      AUTH,
    );
  });

  it("uses shared report payloads for businesses and reviews", async () => {
    await api.reportBusiness("business-1", "SCAM", "Details");
    await api.reportReview("business-1", "review-1", "SPAM");

    expect(client.post).toHaveBeenNthCalledWith(
      1,
      "/api/v1/businesses/business-1/report",
      { reason: "SCAM", details: "Details" },
      AUTH,
    );
    expect(client.post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/businesses/business-1/reviews/review-1/report",
      { reason: "SPAM", details: null },
      AUTH,
    );
  });
});
