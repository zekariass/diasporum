import type { ApiClient } from "@/core/api/api-client";
import { uploadMedia } from "@/shared/services/media-upload";
import type {
  MediaUploadSelection,
  VehicleCatalogItem,
  VehicleCategory,
  VehicleDiscoveryFilters,
  VehicleFeature,
  VehiclePage,
  VehicleRequest,
  VehicleSavedSearch,
  VehicleStatus,
  VehicleView,
  SavedVehicleSearchFilters,
} from "../types/vehicle-types";

type QueryValue = string | number | undefined;

function encode(params: [string, QueryValue][]): string {
  const value = params
    .filter(([, item]) => item !== undefined && item !== "")
    .map(([key, item]) => `${key}=${encodeURIComponent(String(item))}`)
    .join("&");
  return value ? `?${value}` : "";
}

export function createVehicleApi(client: ApiClient) {
  return {
    categories: () =>
      client.get<{ items: VehicleCategory[] }>("/api/v1/vehicles/categories", {
        authenticated: true,
      }),
    makes: () =>
      client.get<{ items: VehicleCatalogItem[] }>("/api/v1/vehicles/makes", {
        authenticated: true,
      }),
    models: (makeId: string) =>
      client.get<{ items: VehicleCatalogItem[] }>(
        `/api/v1/vehicles/makes/${makeId}/models`,
        { authenticated: true },
      ),
    variants: (modelId: string) =>
      client.get<{ items: VehicleCatalogItem[] }>(
        `/api/v1/vehicles/models/${modelId}/variants`,
        { authenticated: true },
      ),
    features: () =>
      client.get<{ items: VehicleCatalogItem[] }>("/api/v1/vehicles/features", {
        authenticated: true,
      }),
    create: (request: VehicleRequest) =>
      client.post<VehicleView>("/api/v1/vehicles", request, {
        authenticated: true,
      }),
    detail: (vehicleId: string) =>
      client.get<VehicleView>(`/api/v1/vehicles/${vehicleId}`, {
        authenticated: true,
      }),
    update: (vehicleId: string, request: VehicleRequest) =>
      client.patch<VehicleView>(`/api/v1/vehicles/${vehicleId}`, request, {
        authenticated: true,
      }),
    remove: (vehicleId: string) =>
      client.delete(`/api/v1/vehicles/${vehicleId}`, { authenticated: true }),
    publish: (vehicleId: string) =>
      client.post<VehicleView>(
        `/api/v1/vehicles/${vehicleId}/publish`,
        undefined,
        {
          authenticated: true,
        },
      ),
    pause: (vehicleId: string) =>
      client.post<VehicleView>(
        `/api/v1/vehicles/${vehicleId}/pause`,
        undefined,
        {
          authenticated: true,
        },
      ),
    sold: (vehicleId: string) =>
      client.post<VehicleView>(
        `/api/v1/vehicles/${vehicleId}/sold`,
        undefined,
        {
          authenticated: true,
        },
      ),
    rented: (vehicleId: string) =>
      client.post<VehicleView>(
        `/api/v1/vehicles/${vehicleId}/rented`,
        undefined,
        {
          authenticated: true,
        },
      ),
    discover: (
      filters: VehicleDiscoveryFilters = {},
      cursor?: string,
      size = 20,
    ) => {
      const attributes = Object.entries(filters.attributes ?? {}).map(
        ([key, value]) => ["attribute", `${key}=${value}`] as [string, string],
      );
      return client.get<VehiclePage>(
        `/api/v1/vehicles${encode([
          ["keyword", filters.keyword],
          ["purpose", filters.purpose],
          ["categoryId", filters.categoryId],
          ["makeId", filters.makeId],
          ["modelId", filters.modelId],
          ["variantId", filters.variantId],
          ["yearMin", filters.yearMin],
          ["yearMax", filters.yearMax],
          ["mileageMin", filters.mileageMin],
          ["mileageMax", filters.mileageMax],
          ["mileageUnit", filters.mileageUnit],
          ["colour", filters.colour],
          ["pricePeriod", filters.pricePeriod],
          ["priceMin", filters.priceMin],
          ["priceMax", filters.priceMax],
          ["currency", filters.currency],
          ["fuelType", filters.fuelType],
          ["transmission", filters.transmission],
          ["bodyType", filters.bodyType],
          ["condition", filters.condition],
          ["engineSizeMin", filters.engineSizeMin],
          ["engineSizeMax", filters.engineSizeMax],
          ["countryId", filters.countryId],
          ["communityId", filters.communityId],
          ["city", filters.city],
          ["region", filters.region],
          ["originLatitude", filters.originLatitude],
          ["originLongitude", filters.originLongitude],
          ["radiusMeters", filters.radiusMeters],
          ...attributes,
          ["sort", filters.sort],
          ["driveType", filters.driveType],
          ["seats", filters.seats],
          ["doors", filters.doors],
          ["registrationYearMin", filters.registrationYearMin],
          ["registrationYearMax", filters.registrationYearMax],
          ["businessListingId", filters.businessListingId],
          ["cursor", cursor],
          ["size", Math.max(1, Math.min(size, 50))],
        ])}`,
        { authenticated: true },
      );
    },
    myVehicles: (
      options: {
        businessAccountId?: string;
        businessListingId?: string;
        status?: VehicleStatus;
      } = {},
      cursor?: string,
      size = 20,
    ) =>
      client.get<VehiclePage>(
        `/api/v1/me/vehicles${encode([
          ["businessAccountId", options.businessAccountId],
          ["businessListingId", options.businessListingId],
          ["status", options.status],
          ["cursor", cursor],
          ["size", Math.max(1, Math.min(size, 50))],
        ])}`,
        { authenticated: true },
      ),
    savedVehicles: (cursor?: string, size = 20) =>
      client.get<VehiclePage>(
        `/api/v1/me/vehicles/saved${encode([
          ["cursor", cursor],
          ["size", Math.max(1, Math.min(size, 50))],
        ])}`,
        { authenticated: true },
      ),
    savedSearches: () =>
      client.get<{ items: VehicleSavedSearch[] }>(
        "/api/v1/me/vehicle-searches",
        { authenticated: true },
      ),
    saveSearch: (name: string, filters: VehicleDiscoveryFilters) =>
      client.post<VehicleSavedSearch>(
        "/api/v1/me/vehicle-searches",
        { name, filters: toSavedFilters(filters) },
        { authenticated: true },
      ),
    deleteSavedSearch: (searchId: string) =>
      client.delete(`/api/v1/me/vehicle-searches/${searchId}`, {
        authenticated: true,
      }),
    save: (vehicleId: string) =>
      client.put(
        `/api/v1/vehicles/${vehicleId}/save`,
        {},
        { authenticated: true },
      ),
    unsave: (vehicleId: string) =>
      client.delete(`/api/v1/vehicles/${vehicleId}/save`, {
        authenticated: true,
      }),
    replaceMedia: (
      vehicleId: string,
      mediaIds: string[],
      coverMediaId?: string,
    ) =>
      client.put<VehicleView>(
        `/api/v1/vehicles/${vehicleId}/media`,
        { mediaIds, ...(coverMediaId ? { coverMediaId } : {}) },
        { authenticated: true },
      ),
    mediaDownloadUrl: (vehicleId: string, mediaId: string) =>
      client.get<{ downloadUrl: string }>(
        `/api/v1/vehicles/${vehicleId}/media/${mediaId}/download-url`,
        { authenticated: true },
      ),
    contact: (vehicleId: string, actingBusinessAccountId?: string) =>
      client.post<{ conversationId: string }>(
        `/api/v1/vehicles/${vehicleId}/contact`,
        actingBusinessAccountId ? { actingBusinessAccountId } : {},
        { authenticated: true },
      ),
    report: (vehicleId: string, reason: string, details?: string) =>
      client.post<{ id: string }>(
        `/api/v1/vehicles/${vehicleId}/report`,
        { reason, ...(details ? { details } : {}) },
        { authenticated: true },
      ),
  };
}

export type VehicleApi = ReturnType<typeof createVehicleApi>;

/** Maps the UI filter shape to the persisted backend `VehicleSearch` JSON. */
export function toSavedFilters(
  filters: VehicleDiscoveryFilters,
): SavedVehicleSearchFilters {
  const { attributes, ...rest } = filters;
  const defined = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  ) as SavedVehicleSearchFilters;
  const entries = Object.entries(attributes ?? {}).filter(([, v]) =>
    v.trim(),
  );
  if (entries.length) {
    defined.attributeFilters = Object.fromEntries(entries);
  }
  return defined;
}

/** Restores a persisted saved search into the UI filter shape. */
export function fromSavedFilters(
  filters: SavedVehicleSearchFilters | null | undefined,
): VehicleDiscoveryFilters {
  const { attributeFilters, ...rest } = filters ?? {};
  return {
    ...(rest as VehicleDiscoveryFilters),
    attributes: attributeFilters ?? {},
  };
}

/**
 * Canonical key used to detect whether the current filter set is already
 * saved. Mirrors backend normalization (uppercased colour, sorted keys).
 */
export function savedSearchKey(filters: VehicleDiscoveryFilters): string {
  const saved = toSavedFilters(filters);
  if (saved.colour) saved.colour = saved.colour.toUpperCase();
  if (saved.attributeFilters) {
    saved.attributeFilters = Object.fromEntries(
      Object.entries(saved.attributeFilters).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
  }
  const sorted = Object.fromEntries(
    Object.entries(saved)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(sorted);
}

export function uploadVehicleMedia(
  client: ApiClient,
  selection: MediaUploadSelection,
): Promise<string> {
  return uploadMedia(client, selection, "VEHICLE");
}

export type VehicleCatalogFeature = VehicleFeature;
