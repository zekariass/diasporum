import {
  createVehicleApi,
  uploadVehicleMedia,
} from "@/features/vehicles/services/vehicle-api";
import {
  formatVehicleLocation,
  formatVehicleMileage,
  formatVehiclePrice,
  formatVehiclePublished,
} from "@/features/vehicles/utils/vehicle-format";
import type { VehicleListing } from "@/features/vehicles/types/vehicle-types";

const client = {
  get: jest.fn((path: string) => Promise.resolve({})),
  post: jest.fn((path: string, body?: unknown) => Promise.resolve({})),
  put: jest.fn((path: string, body?: unknown) => Promise.resolve({})),
  patch: jest.fn((path: string, body?: unknown) => Promise.resolve({})),
  delete: jest.fn((path: string) => Promise.resolve({})),
};
const api = createVehicleApi(client as never);

beforeEach(() => jest.clearAllMocks());

describe("vehicleApi", () => {
  it("encodes discovery filters, repeated attributes, cursor, and bounded size", async () => {
    await api.discover(
      {
        keyword: "Golf & Polo",
        purpose: "SALE",
        categoryId: "category 1",
        makeId: "make-1",
        modelId: "model-1",
        yearMin: 2018,
        yearMax: 2024,
        mileageMin: 100,
        mileageMax: 90000,
        mileageUnit: "MILES",
        colour: "Blue & silver",
        pricePeriod: "DAY",
        priceMin: 1000,
        priceMax: 20000,
        currency: "EUR",
        fuelType: "HYBRID",
        transmission: "AUTOMATIC",
        bodyType: "SUV",
        condition: "GOOD",
        engineSizeMin: 1000,
        engineSizeMax: 2000,
        countryId: "country-1",
        communityId: "community-1",
        city: "Addis Ababa",
        region: "Addis Ababa",
        originLatitude: 9.01,
        originLongitude: 38.75,
        radiusMeters: 25000,
        attributes: { drivetrain: "FOUR_WD", doors: "5" },
        sort: "DISTANCE",
        driveType: "AWD",
        seats: 5,
        doors: 5,
        registrationYearMin: 2020,
        registrationYearMax: 2024,
      },
      "cursor/1",
      100,
    );

    const path = client.get.mock.calls[0][0] as string;
    expect(path).toContain("/api/v1/vehicles?keyword=Golf%20%26%20Polo");
    expect(path).toContain("purpose=SALE&categoryId=category%201");
    expect(path).toContain(
      "mileageMax=90000&mileageUnit=MILES&colour=Blue%20%26%20silver&pricePeriod=DAY",
    );
    expect(path).toContain("city=Addis%20Ababa&region=Addis%20Ababa");
    expect(path).toContain(
      "originLatitude=9.01&originLongitude=38.75&radiusMeters=25000",
    );
    expect(path).toContain(
      "attribute=drivetrain%3DFOUR_WD&attribute=doors%3D5",
    );
    expect(path).toContain(
      "sort=DISTANCE&driveType=AWD&seats=5&doors=5&registrationYearMin=2020&registrationYearMax=2024&cursor=cursor%2F1&size=50",
    );
    expect(client.get).toHaveBeenCalledWith(path, { authenticated: true });
  });

  it("omits empty filters and uses the default page size", async () => {
    await api.discover();
    expect(client.get).toHaveBeenCalledWith("/api/v1/vehicles?size=20", {
      authenticated: true,
    });
  });

  it("loads all catalogue relationships", async () => {
    await api.categories();
    await api.makes();
    await api.models("make-1");
    await api.variants("model-1");
    await api.features();
    expect(client.get).toHaveBeenCalledWith("/api/v1/vehicles/categories", {
      authenticated: true,
    });
    expect(client.get).toHaveBeenCalledWith("/api/v1/vehicles/makes", {
      authenticated: true,
    });
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/vehicles/makes/make-1/models",
      { authenticated: true },
    );
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/vehicles/models/model-1/variants",
      { authenticated: true },
    );
    expect(client.get).toHaveBeenCalledWith("/api/v1/vehicles/features", {
      authenticated: true,
    });
  });

  it("supports create, detail, update, removal, and every lifecycle operation", async () => {
    await api.create({ title: "Vehicle", listingPurpose: "SALE" });
    await api.detail("vehicle-1");
    await api.update("vehicle-1", { title: "Updated" });
    await api.publish("vehicle-1");
    await api.pause("vehicle-1");
    await api.sold("vehicle-1");
    await api.rented("vehicle-1");
    await api.remove("vehicle-1");
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/vehicles",
      { title: "Vehicle", listingPurpose: "SALE" },
      { authenticated: true },
    );
    expect(client.get).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1", {
      authenticated: true,
    });
    expect(client.patch).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1",
      { title: "Updated" },
      { authenticated: true },
    );
    for (const action of ["publish", "pause", "sold", "rented"]) {
      expect(client.post).toHaveBeenCalledWith(
        `/api/v1/vehicles/vehicle-1/${action}`,
        undefined,
        { authenticated: true },
      );
    }
    expect(client.delete).toHaveBeenCalledWith("/api/v1/vehicles/vehicle-1", {
      authenticated: true,
    });
  });

  it("lists owned and saved vehicles with filters and idempotent saves", async () => {
    await api.myVehicles(
      { businessAccountId: "business-1", status: "PAUSED" },
      "mine",
      10,
    );
    await api.savedVehicles("saved", 5);
    await api.save("vehicle-1");
    await api.unsave("vehicle-1");
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/me/vehicles?businessAccountId=business-1&status=PAUSED&cursor=mine&size=10",
      { authenticated: true },
    );
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/me/vehicles/saved?cursor=saved&size=5",
      { authenticated: true },
    );
    expect(client.put).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/save",
      {},
      { authenticated: true },
    );
    expect(client.delete).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/save",
      { authenticated: true },
    );
  });

  it("replaces ordered media and authorizes individual download URLs", async () => {
    await api.replaceMedia("vehicle-1", ["media-2", "media-1"], "media-2");
    await api.mediaDownloadUrl("vehicle-1", "media-1");
    expect(client.put).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/media",
      {
        mediaIds: ["media-2", "media-1"],
        coverMediaId: "media-2",
      },
      { authenticated: true },
    );
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/media/media-1/download-url",
      { authenticated: true },
    );
  });

  it("uses server-resolved seller contact and reports listings", async () => {
    await api.contact("vehicle-1");
    await api.contact("vehicle-1", "buyer-business-1");
    await api.report("vehicle-1", "SCAM", "Requested a deposit");
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/contact",
      {},
      { authenticated: true },
    );
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/contact",
      { actingBusinessAccountId: "buyer-business-1" },
      { authenticated: true },
    );
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/vehicles/vehicle-1/report",
      {
        reason: "SCAM",
        details: "Requested a deposit",
      },
      { authenticated: true },
    );
  });
});

describe("vehicle display formatting", () => {
  const listing = {
    priceAmount: 10950,
    currencyCode: "GBP",
    listingPurpose: "SALE",
    pricePeriod: "TOTAL",
    mileage: 82000,
    mileageUnit: "MILES",
  } as VehicleListing;
  it("formats currency and preserves rental periods", () => {
    expect(formatVehiclePrice(listing)).toContain("£");
    expect(
      formatVehiclePrice({
        ...listing,
        listingPurpose: "RENT",
        pricePeriod: "DAY",
      }),
    ).toContain(" / day");
    expect(
      formatVehiclePrice({
        ...listing,
        listingPurpose: "RENT",
        pricePeriod: "TOTAL",
      }),
    ).not.toContain(" / total");
    expect(formatVehiclePrice({ ...listing, priceAmount: null })).toBe(
      "Price not provided",
    );
  });
  it("does not invent mileage units or expose formatted street addresses", () => {
    expect(formatVehicleMileage(listing)).toBe("82,000 mi");
    expect(formatVehicleMileage({ ...listing, mileageUnit: "KM" })).toBe(
      "82,000 km",
    );
    expect(formatVehicleMileage({ ...listing, mileageUnit: null })).toBeNull();
    expect(formatVehicleMileage({ ...listing, mileage: null })).toBeNull();
    expect(
      formatVehicleLocation({
        countryId: "GB",
        city: "Leeds",
        region: "West Yorkshire",
        formattedAddress: "Private street 12",
      }),
    ).toBe("Leeds, West Yorkshire");
    expect(
      formatVehicleLocation({
        countryId: "GB",
        city: null,
        region: null,
        formattedAddress: "Private street 12",
      }),
    ).toBe("General area not provided");
  });
  it("only displays valid publication dates", () => {
    expect(formatVehiclePublished(null)).toBeNull();
    expect(formatVehiclePublished("invalid")).toBeNull();
    expect(formatVehiclePublished(new Date().toISOString())).toBe(
      "Advertised today",
    );
    expect(
      formatVehiclePublished(new Date(Date.now() - 86400000).toISOString()),
    ).toBe("Advertised 1 day ago");
  });
});

describe("vehicle media upload", () => {
  const selection = {
    uri: "file:///vehicle.jpg",
    mimeType: "image/jpeg",
    fileName: "vehicle.jpg",
  };

  it("uses VEHICLE purpose, direct PUT, and completion verification", async () => {
    const file = { size: 1234 };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, blob: async () => file })
      .mockResolvedValueOnce({ ok: true });
    globalThis.fetch = fetchMock as never;
    client.post.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/media/uploads"
          ? {
              assetId: "media-1",
              uploadUrl: "https://upload.example.com/signed",
            }
          : {},
      ),
    );

    await expect(uploadVehicleMedia(client as never, selection)).resolves.toBe(
      "media-1",
    );
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/media/uploads",
      {
        purpose: "VEHICLE",
        mimeType: "image/jpeg",
        declaredSizeBytes: 1234,
      },
      { authenticated: true },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://upload.example.com/signed",
      expect.objectContaining({
        method: "PUT",
        body: file,
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/media/uploads/media-1/complete",
      {
        declaredSizeBytes: 1234,
      },
      { authenticated: true },
    );
  });

  it.each(["upload", "complete"])(
    "cleans up the initiated asset when %s fails",
    async (stage) => {
      globalThis.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, blob: async () => ({ size: 100 }) })
        .mockResolvedValueOnce({ ok: stage !== "upload" }) as never;
      client.post.mockImplementation((path: string) => {
        if (path === "/api/v1/media/uploads")
          return Promise.resolve({
            assetId: "media-1",
            uploadUrl: "https://upload.example.com/signed",
          });
        if (path.endsWith("/complete") && stage === "complete")
          return Promise.reject(new Error("not ready"));
        return Promise.resolve({});
      });

      await expect(
        uploadVehicleMedia(client as never, selection),
      ).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(client.delete).toHaveBeenCalledWith("/api/v1/media/media-1", {
        authenticated: true,
      });
    },
  );
});
