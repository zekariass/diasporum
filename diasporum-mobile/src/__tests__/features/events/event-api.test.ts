/**
 * Events API service tests — verifies authenticated endpoints, query
 * strings and payloads against EventController. Mock ApiClient, no network.
 */

import { createEventApi } from "@/features/events/services/event-api";

const client = {
  get: jest.fn(() => Promise.resolve({})),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({})),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
};

const api = createEventApi(client as never);

beforeEach(() => jest.clearAllMocks());

describe("eventApi", () => {
  it("loads categories through the authenticated endpoint", async () => {
    await api.categories();

    expect(client.get).toHaveBeenCalledWith("/api/v1/events/categories", {
      authenticated: true,
    });
  });

  it("creates an event with the full request body", async () => {
    await api.createEvent({
      communityId: "community-1",
      categoryId: "category-1",
      title: "Coffee night",
      description: "An evening together",
      eventMode: "IN_PERSON",
      startsAt: "2026-11-20T17:30:00Z",
      timezone: "Europe/Berlin",
      locationName: "Community hall",
      capacity: 30,
    });

    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/events",
      expect.objectContaining({ communityId: "community-1", capacity: 30 }),
      { authenticated: true },
    );
  });

  it("loads the event detail by id", async () => {
    await api.eventDetail("event-1");

    expect(client.get).toHaveBeenCalledWith("/api/v1/events/event-1", {
      authenticated: true,
    });
  });

  it("patches only the changed fields", async () => {
    await api.updateEvent("event-1", { title: "Renamed", capacity: 5 });

    expect(client.patch).toHaveBeenCalledWith(
      "/api/v1/events/event-1",
      { title: "Renamed", capacity: 5 },
      { authenticated: true },
    );
  });

  it("publishes and cancels with a reason", async () => {
    await api.publishEvent("event-1");
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/events/event-1/publish",
      undefined,
      { authenticated: true },
    );

    await api.cancelEvent("event-1", "Venue lost");
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/events/event-1/cancel",
      { reason: "Venue lost" },
      { authenticated: true },
    );
  });

  it("resolves the authorized cover download url", async () => {
    await api.coverDownloadUrl("event-1");

    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/events/event-1/cover/download-url",
      { authenticated: true },
    );
  });

  it("builds the discovery query from filters and cursor", async () => {
    await api.discover(
      { scope: "COUNTRY", mode: "IN_PERSON", categoryId: "category-1", search: "coffee" },
      "abc123",
      10,
    );

    expect(client.get).toHaveBeenCalledWith(
      `/api/v1/events?scope=COUNTRY&categoryId=category-1&mode=IN_PERSON&search=coffee&cursor=${encodeURIComponent("abc123")}&size=10`,
      { authenticated: true },
    );
  });

  it("omits empty filters from the discovery query", async () => {
    await api.discover({}, undefined, 20);

    expect(client.get).toHaveBeenCalledWith("/api/v1/events?size=20", {
      authenticated: true,
    });
  });

  it("lists a community's events", async () => {
    await api.communityEvents("community-1", "cur", 5);

    expect(client.get).toHaveBeenCalledWith(
      `/api/v1/communities/community-1/events?cursor=${encodeURIComponent("cur")}&size=5`,
      { authenticated: true },
    );
  });

  it("sets and removes an RSVP", async () => {
    await api.setRsvp("event-1", "GOING");
    expect(client.put).toHaveBeenCalledWith(
      "/api/v1/events/event-1/rsvp",
      { status: "GOING" },
      { authenticated: true },
    );

    await api.removeRsvp("event-1");
    expect(client.delete).toHaveBeenCalledWith("/api/v1/events/event-1/rsvp", {
      authenticated: true,
    });
  });

  it("loads participants with status and paging", async () => {
    await api.participants("event-1", "GOING", 1, 10);

    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/events/event-1/participants?status=GOING&page=1&size=10",
      { authenticated: true },
    );
  });

  it("saves, unsaves and lists saved events", async () => {
    await api.saveEvent("event-1");
    expect(client.put).toHaveBeenCalledWith(
      "/api/v1/events/event-1/save",
      {},
      { authenticated: true },
    );

    await api.unsaveEvent("event-1");
    expect(client.delete).toHaveBeenCalledWith("/api/v1/events/event-1/save", {
      authenticated: true,
    });

    await api.savedEvents(2, 5);
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/me/events/saved?page=2&size=5",
      { authenticated: true },
    );
  });

  it("lists my events by role", async () => {
    await api.myEvents("participating", 0, 20);

    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/me/events?role=participating&page=0&size=20",
      { authenticated: true },
    );
  });

  it("reports an event with reason and details", async () => {
    await api.reportEvent("event-1", "SPAM", "Looks like spam");

    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/events/event-1/report",
      { reason: "SPAM", details: "Looks like spam" },
      { authenticated: true },
    );
  });
});
