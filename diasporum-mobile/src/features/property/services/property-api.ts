import type { ApiClient } from "@/core/api/api-client";
import type {
  Amenity,
  PropertyCommand,
  PropertyDetail,
  PropertyDiscoveryFilters,
  PropertyPage,
  PropertyStatus,
  PropertyType,
} from "../types/property-types";

type QueryValue = string | number | undefined;

function buildQuery(params: [string, QueryValue][]): string {
  const query = params
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `${key}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
  return query ? `?${query}` : "";
}

export function createPropertyApi(client: ApiClient) {
  const auth = { authenticated: true } as const;
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
      client.get<PropertyPage>(
        `/api/v1/properties${buildQuery([
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
          ["cursor", cursor],
          ["size", size],
        ])}`,
        auth,
      ),
    detail: (propertyId: string) =>
      client.get<PropertyDetail>(`/api/v1/properties/${propertyId}`, auth),
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
    mine: (
      status?: PropertyStatus,
      businessAccountId?: string,
      cursor?: string,
      size = 20,
    ) =>
      client.get<PropertyPage>(
        `/api/v1/me/properties${buildQuery([
          ["status", status],
          ["businessAccountId", businessAccountId],
          ["cursor", cursor],
          ["size", size],
        ])}`,
        auth,
      ),
    saved: (cursor?: string, size = 20) =>
      client.get<PropertyPage>(
        `/api/v1/me/properties/saved${buildQuery([
          ["cursor", cursor],
          ["size", size],
        ])}`,
        auth,
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
