import type { ApiClient } from "@/core/api/api-client";
import type {
  Airport,
  Category,
  ContactDirection,
  ContactPage,
  ContactRequest,
  ContactRequestInput,
  DiscoveryFilters,
  Listing,
  ListingPage,
  ListingRequest,
  ListingStatus,
} from "../types/spare-bag-types";

function query(params: [string, string | undefined][]): string {
  const value = params
    .filter(([, item]) => item !== undefined && item !== "")
    .map(([key, item]) => `${key}=${encodeURIComponent(item as string)}`)
    .join("&");
  return value ? `?${value}` : "";
}

const auth = { authenticated: true } as const;

export function createSpareBagApi(client: ApiClient) {
  return {
    airports: (search?: string, countryId?: string) =>
      client.get<{ items: Airport[] }>(
        `/api/v1/spare-bag/airports${query([
          ["search", search],
          ["countryId", countryId],
          ["size", "50"],
        ])}`,
        auth,
      ),
    categories: () =>
      client.get<{ items: Category[] }>("/api/v1/spare-bag/categories", auth),
    discover: (filters: DiscoveryFilters = {}, cursor?: string, size = 20) =>
      client.get<ListingPage>(
        `/api/v1/spare-bag/listings${query([
          ["listingType", filters.listingType],
          ["communityId", filters.communityId],
          ["originCountryId", filters.originCountryId],
          ["destinationCountryId", filters.destinationCountryId],
          ["originAirportId", filters.originAirportId],
          ["destinationAirportId", filters.destinationAirportId],
          ["dateFrom", filters.dateFrom],
          ["dateTo", filters.dateTo],
          ["maxPrice", filters.maxPrice],
          ["minimumCapacityKg", filters.minimumCapacityKg],
          ["priceCurrency", filters.priceCurrency],
          ["categoryKey", filters.categoryKey],
          ["cursor", cursor],
          ["size", String(size)],
        ])}`,
        auth,
      ),
    detail: (listingId: string) =>
      client.get<Listing>(`/api/v1/spare-bag/listings/${listingId}`, auth),
    create: (request: ListingRequest) =>
      client.post<Listing>("/api/v1/spare-bag/listings", request, auth),
    update: (listingId: string, request: ListingRequest) =>
      client.put<Listing>(`/api/v1/spare-bag/listings/${listingId}`, request, auth),
    publish: (listingId: string) =>
      client.post<Listing>(`/api/v1/spare-bag/listings/${listingId}/publish`, {}, auth),
    pause: (listingId: string) =>
      client.post<Listing>(`/api/v1/spare-bag/listings/${listingId}/pause`, {}, auth),
    close: (listingId: string) =>
      client.post<Listing>(`/api/v1/spare-bag/listings/${listingId}/close`, {}, auth),
    save: (listingId: string) =>
      client.put(`/api/v1/spare-bag/listings/${listingId}/save`, {}, auth),
    unsave: (listingId: string) =>
      client.delete(`/api/v1/spare-bag/listings/${listingId}/save`, auth),
    mine: (status?: ListingStatus, cursor?: string, size = 20) =>
      client.get<ListingPage>(
        `/api/v1/me/spare-bag/listings${query([
          ["status", status],
          ["cursor", cursor],
          ["size", String(size)],
        ])}`,
        auth,
      ),
    saved: (cursor?: string, size = 20) =>
      client.get<ListingPage>(
        `/api/v1/me/spare-bag/listings/saved${query([
          ["cursor", cursor],
          ["size", String(size)],
        ])}`,
        auth,
      ),
    mediaDownloadUrl: (listingId: string, mediaId: string) =>
      client.get<{ downloadUrl: string }>(
        `/api/v1/spare-bag/listings/${listingId}/media/${mediaId}/download-url`,
        auth,
      ),
    reportListing: (listingId: string, reason: string, details?: string) =>
      client.post<{ id: string }>(
        `/api/v1/spare-bag/listings/${listingId}/report`,
        { reason, ...(details ? { details } : {}) },
        auth,
      ),
    createContact: (request: ContactRequestInput) =>
      client.post<ContactRequest>("/api/v1/spare-bag/contact-requests", request, auth),
    contacts: (direction?: ContactDirection, cursor?: string, size = 20) =>
      client.get<ContactPage>(
        `/api/v1/spare-bag/contact-requests${query([
          ["direction", direction],
          ["cursor", cursor],
          ["size", String(size)],
        ])}`,
        auth,
      ),
    contactDetail: (contactId: string) =>
      client.get<ContactRequest>(`/api/v1/spare-bag/contact-requests/${contactId}`, auth),
    accept: (contactId: string, responseNote?: string) =>
      client.post<ContactRequest>(
        `/api/v1/spare-bag/contact-requests/${contactId}/accept`,
        { responseNote },
        auth,
      ),
    decline: (contactId: string, responseNote?: string) =>
      client.post<ContactRequest>(
        `/api/v1/spare-bag/contact-requests/${contactId}/decline`,
        { responseNote },
        auth,
      ),
    cancel: (contactId: string) =>
      client.post<ContactRequest>(
        `/api/v1/spare-bag/contact-requests/${contactId}/cancel`,
        {},
        auth,
      ),
    closeContact: (contactId: string) =>
      client.post<ContactRequest>(
        `/api/v1/spare-bag/contact-requests/${contactId}/close`,
        {},
        auth,
      ),
    conversation: (contactId: string) =>
      client.post<ContactRequest>(
        `/api/v1/spare-bag/contact-requests/${contactId}/conversation`,
        {},
        auth,
      ),
    reportContact: (contactId: string, reason: string, details?: string) =>
      client.post<{ id: string }>(
        `/api/v1/spare-bag/contact-requests/${contactId}/report`,
        { reason, ...(details ? { details } : {}) },
        auth,
      ),
  };
}

export type SpareBagApi = ReturnType<typeof createSpareBagApi>;
