import type { ApiClient } from "@/core/api/api-client";
import { propertySaveStore } from "../utils/property-save-store";
import type {
  Amenity,
  PropertyCommand,
  PropertyDetail,
  PropertyDiscoveryFilters,
  PropertyPage,
  PropertyStatus,
  PropertyType,
} from "../types/property-types";

type QueryValue = string | number | boolean | undefined;

function buildQuery(params: [string, QueryValue][]): string {
  const query = params
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
  return query ? `?${query}` : "";
}

export function createPropertyApi(client: ApiClient) {
  const auth = { authenticated: true } as const;
  const store = propertySaveStore(client);
  const read = async <T extends PropertyPage | PropertyDetail>(
    path: string,
  ): Promise<T> => {
    const version = store.version();
    const result = await client.get<T>(path, auth);
    const items = "items" in result ? result.items : [result.item];
    items.forEach((item) =>
      store.reconcile(item.property.id, item.saved, version),
    );
    return result;
  };
  return {
    types: (countryId: string) =>
      client.get<{ items: PropertyType[] }>(
        `/api/v1/properties/types${buildQuery([["countryId", countryId]])}`,
        auth,
      ),
    amenities: () =>
      client.get<{ items: Amenity[] }>("/api/v1/properties/amenities", auth),
    discover: (
      filters: PropertyDiscoveryFilters = {},
      cursor?: string,
      size = 20,
    ) =>
      read<PropertyPage>(
        `/api/v1/properties${buildQuery([
          ["sort", filters.sort],
          ["currencyCode", filters.currencyCode],
          ["pricePeriod", filters.pricePeriod],
          ["minFloorArea", filters.minFloorArea],
          ["maxFloorArea", filters.maxFloorArea],
          ["floorAreaUnit", filters.floorAreaUnit],
          ["availableBy", filters.availableBy],
          ["maxDeposit", filters.maxDeposit],
          ["billsIncluded", filters.billsIncluded],
          ["maxTenancyMonths", filters.maxTenancyMonths],
          ["tenure", filters.tenure],
          ["conditionKey", filters.conditionKey],
          ["maxBathrooms", filters.maxBathrooms],
          ["countryId", filters.countryId],
          ["communityId", filters.communityId],
          ["propertyTypeId", filters.propertyTypeId],
          ["listingPurpose", filters.listingPurpose],
          ["minPrice", filters.minPrice],
          ["maxPrice", filters.maxPrice],
          ["minBedrooms", filters.minBedrooms],
          ["maxBedrooms", filters.maxBedrooms],
          ["bathrooms", filters.bathrooms],
          ["furnishedStatus", filters.furnishedStatus],
          ["city", filters.city],
          ["search", filters.search],
          ["latitude", filters.latitude],
          ["longitude", filters.longitude],
          ["radiusKm", filters.radiusKm],
          ["businessListingId", filters.businessListingId],
          ["cursor", cursor],
          ["size", size],
        ])}`,
      ),
    detail: (propertyId: string) =>
      read<PropertyDetail>(`/api/v1/properties/${propertyId}`),
    create: (command: PropertyCommand) =>
      client.post<PropertyDetail>("/api/v1/properties", command, auth),
    update: (propertyId: string, command: PropertyCommand) =>
      client.put<PropertyDetail>(
        `/api/v1/properties/${propertyId}`,
        command,
        auth,
      ),
    publish: (propertyId: string) =>
      client.post<PropertyDetail>(
        `/api/v1/properties/${propertyId}/publish`,
        undefined,
        auth,
      ),
    pause: (propertyId: string) =>
      client.post<PropertyDetail>(
        `/api/v1/properties/${propertyId}/pause`,
        undefined,
        auth,
      ),
    reopen: (propertyId: string) =>
      client.post<PropertyDetail>(
        `/api/v1/properties/${propertyId}/reopen`,
        undefined,
        auth,
      ),
    close: (propertyId: string) =>
      client.post<PropertyDetail>(
        `/api/v1/properties/${propertyId}/close`,
        undefined,
        auth,
      ),
    sold: (propertyId: string) =>
      client.post<PropertyDetail>(
        `/api/v1/properties/${propertyId}/sold`,
        undefined,
        auth,
      ),
    rented: (propertyId: string) =>
      client.post<PropertyDetail>(
        `/api/v1/properties/${propertyId}/rented`,
        undefined,
        auth,
      ),
    mine: (
      status?: PropertyStatus,
      businessAccountId?: string,
      cursor?: string,
      size = 20,
      businessListingId?: string,
    ) =>
      read<PropertyPage>(
        `/api/v1/me/properties${buildQuery([
          ["status", status],
          ["businessAccountId", businessAccountId],
          ["businessListingId", businessListingId],
          ["cursor", cursor],
          ["size", size],
        ])}`,
      ),
    saved: (cursor?: string, size = 20) =>
      read<PropertyPage>(
        `/api/v1/me/properties/saved${buildQuery([
          ["cursor", cursor],
          ["size", size],
        ])}`,
      ),
    save: (propertyId: string) =>
      client.put<void>(`/api/v1/properties/${propertyId}/save`, {}, auth),
    unsave: (propertyId: string) =>
      client.delete<void>(`/api/v1/properties/${propertyId}/save`, auth),
    attachMedia: (propertyId: string, mediaId: string) =>
      client.post<PropertyDetail>(
        `/api/v1/properties/${propertyId}/media/${mediaId}`,
        undefined,
        auth,
      ),
    reorderMedia: (
      propertyId: string,
      mediaIds: string[],
      coverMediaId?: string,
    ) =>
      client.put<PropertyDetail>(
        `/api/v1/properties/${propertyId}/media`,
        { mediaIds, coverMediaId },
        auth,
      ),
    removeMedia: (propertyId: string, mediaId: string) =>
      client.delete<PropertyDetail>(
        `/api/v1/properties/${propertyId}/media/${mediaId}`,
        auth,
      ),
    mediaUrl: (propertyId: string, mediaId: string) =>
      client.get<{ downloadUrl: string }>(
        `/api/v1/properties/${propertyId}/media/${mediaId}/download-url`,
        auth,
      ),
    enquiry: (propertyId: string) =>
      client.post<{ conversationId: string }>(
        `/api/v1/properties/${propertyId}/enquiry`,
        undefined,
        auth,
      ),
    report: (propertyId: string, reason: string, details?: string) =>
      client.post<{ id: string }>(
        `/api/v1/properties/${propertyId}/report`,
        { reason, ...(details?.trim() ? { details: details.trim() } : {}) },
        auth,
      ),
  };
}

export type PropertyApi = ReturnType<typeof createPropertyApi>;
