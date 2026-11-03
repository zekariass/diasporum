import { createServiceMarketplaceApi } from "@/features/services/services/service-marketplace-api";

const client = {
  get: jest.fn(() => Promise.resolve({})),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({})),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
};
const api = createServiceMarketplaceApi(client as never);
const auth = { authenticated: true };

beforeEach(() => jest.clearAllMocks());

describe("serviceMarketplaceApi", () => {
  it("encodes provider discovery filters and cursor", async () => {
    await api.discoverProviders({
      categoryId: "category 1", originLatitude: 52.52, originLongitude: 13.405,
      radiusKm: 25, q: "nurse & midwife", sort: "DISTANCE",
    }, "cursor/1", 10);
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/service/providers?categoryId=category%201&originLatitude=52.52&originLongitude=13.405&radiusKm=25&q=nurse%20%26%20midwife&sort=DISTANCE&cursor=cursor%2F1&size=10",
      auth,
    );
  });

  it("encodes request filters and owned status pagination", async () => {
    await api.discoverRequests({
      serviceProviderId: "provider-1", countryId: "country-1", city: "Addis Ababa",
      currencyCode: "EUR", maxDistanceKm: 100, sort: "PRICE_ASC",
    }, "next cursor", 15);
    await api.myRequests("OPEN", "mine/1", 5);
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/service/requests?serviceProviderId=provider-1&countryId=country-1&city=Addis%20Ababa&currencyCode=EUR&maxDistanceKm=100&sort=PRICE_ASC&cursor=next%20cursor&size=15",
      auth,
    );
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/service/requests/mine?status=OPEN&cursor=mine%2F1&size=5", auth,
    );
  });

  it("uses canonical provider and request lifecycle endpoints", async () => {
    await api.closeProvider("provider-1");
    await api.pause("request-1");
    await api.resume("request-1");
    await api.close("request-1");
    await api.cancel("request-1");
    expect(client.post).toHaveBeenCalledWith("/api/v1/service/providers/provider-1/close", {}, auth);
    for (const action of ["pause", "resume", "close", "cancel"]) {
      expect(client.post).toHaveBeenCalledWith(`/api/v1/service/requests/request-1/${action}`, {}, auth);
    }
  });

  it("submits responses without quote fields and supports all decisions", async () => {
    await api.respond("request-1", "provider-1", "INTEREST", "I can help");
    await api.updateResponse("response-1", "provider-1", "CONTACT", "Updated");
    await api.acceptResponse("response-1");
    await api.declineResponse("response-1");
    await api.withdrawResponse("response-1");
    expect(client.post).toHaveBeenCalledWith("/api/v1/service/requests/request-1/responses", {
      serviceProviderId: "provider-1", responseType: "INTEREST", message: "I can help",
    }, auth);
    expect(client.put).toHaveBeenCalledWith("/api/v1/service/responses/response-1", {
      serviceProviderId: "provider-1", responseType: "CONTACT", message: "Updated",
    }, auth);
    for (const action of ["accept", "decline", "withdraw"]) {
      expect(client.post).toHaveBeenCalledWith(`/api/v1/service/responses/response-1/${action}`, {}, auth);
    }
  });

  it("filters provider responses and reloads request lead state", async () => {
    await api.myResponses("provider-1", "cursor-1");
    await api.requestLead("request-1", "provider-1");
    await api.accessLead("request-1", "provider-1", true, true);
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/service/responses/me?serviceProviderId=provider-1&cursor=cursor-1&size=20", auth,
    );
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/service/requests/request-1/lead-access?serviceProviderId=provider-1", auth,
    );
    expect(client.post).toHaveBeenCalledWith("/api/v1/service/requests/request-1/lead-access", {
      serviceProviderId: "provider-1", enableChat: true, unlockContactDetails: true,
    }, auth);
  });

  it("submits interaction reviews and canonical service reports", async () => {
    await api.createReview("request-1", "provider-1", 5, " Clear communication ");
    await api.report("SERVICE_PROVIDER", "provider-1", "OTHER", "Requires review");
    expect(client.post).toHaveBeenCalledWith("/api/v1/service/requests/request-1/reviews", {
      serviceProviderId: "provider-1", rating: 5, reviewText: " Clear communication ",
    }, auth);
    expect(client.post).toHaveBeenCalledWith("/api/v1/service/reports", {
      targetType: "SERVICE_PROVIDER", targetId: "provider-1",
      reasonCode: "OTHER", description: "Requires review",
    }, auth);
  });

  it("loads matching providers and authorized media URLs", async () => {
    await api.matchingProviders("request-1", 100, "DISTANCE", "cursor-1");
    await api.mediaDownloadUrl("request-1", "media-1");
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/service/requests/request-1/matching-providers?maxDistanceKm=100&sort=DISTANCE&cursor=cursor-1&size=20",
      auth,
    );
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/service/requests/request-1/media/media-1/download-url", auth,
    );
  });
});
