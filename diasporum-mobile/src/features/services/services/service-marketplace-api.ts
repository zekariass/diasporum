import type { ApiClient } from "@/core/api/api-client";
import type {
  LeadAccess,
  Page,
  ProviderDiscoveryFilters,
  ProviderInput,
  ProviderResponse,
  RequestDiscoveryFilters,
  ResponseType,
  ServiceCategory,
  ServiceProvider,
  ServiceReport,
  ServiceRequest,
  ServiceRequestInput,
  ServiceReview,
} from "../types/service-marketplace-types";

const auth = { authenticated: true } as const;
const BASE = "/api/v1/service";

type QueryValue = string | number | undefined;
function query(params: [string, QueryValue][]): string {
  const value = params
    .filter(([, item]) => item !== undefined && item !== "")
    .map(([key, item]) => `${key}=${encodeURIComponent(String(item))}`)
    .join("&");
  return value ? `?${value}` : "";
}

export function createServiceMarketplaceApi(client: ApiClient) {
  return {
    categories: (languageCode?: string, parentId?: string) =>
      client.get<ServiceCategory[]>(`${BASE}/categories${query([
        ["languageCode", languageCode], ["parentId", parentId],
      ])}`),

    discoverProviders: (filters: ProviderDiscoveryFilters = {}, cursor?: string, size = 20) =>
      client.get<Page<ServiceProvider>>(`${BASE}/providers${query([
        ["categoryId", filters.categoryId], ["originLatitude", filters.originLatitude],
        ["originLongitude", filters.originLongitude], ["radiusKm", filters.radiusKm],
        ["q", filters.q], ["sort", filters.sort], ["cursor", cursor], ["size", size],
      ])}`, auth),
    myProviders: (status?: string, cursor?: string, size = 20) =>
      client.get<Page<ServiceProvider>>(`${BASE}/providers/mine${query([
        ["status", status], ["cursor", cursor], ["size", size],
      ])}`, auth),
    provider: (providerId: string) => client.get<ServiceProvider>(`${BASE}/providers/${providerId}`, auth),
    createProvider: (input: ProviderInput) => client.post<ServiceProvider>(`${BASE}/providers`, input, auth),
    updateProvider: (providerId: string, input: ProviderInput) =>
      client.put<ServiceProvider>(`${BASE}/providers/${providerId}`, input, auth),
    deleteProvider: (providerId: string) => client.delete(`${BASE}/providers/${providerId}`, auth),
    pauseProvider: (providerId: string) =>
      client.post<ServiceProvider>(`${BASE}/providers/${providerId}/pause`, {}, auth),
    resumeProvider: (providerId: string) =>
      client.post<ServiceProvider>(`${BASE}/providers/${providerId}/resume`, {}, auth),
    closeProvider: (providerId: string) =>
      client.post<ServiceProvider>(`${BASE}/providers/${providerId}/close`, {}, auth),
    matchingProviders: (requestId: string, maxDistanceKm?: number, sort = "NEWEST", cursor?: string) =>
      client.get<Page<ServiceProvider>>(`${BASE}/requests/${requestId}/matching-providers${query([
        ["maxDistanceKm", maxDistanceKm], ["sort", sort], ["cursor", cursor], ["size", 20],
      ])}`, auth),

    discoverRequests: (filters: RequestDiscoveryFilters = {}, cursor?: string, size = 20) =>
      client.get<Page<ServiceRequest>>(`${BASE}/requests${query([
        ["serviceProviderId", filters.serviceProviderId], ["categoryId", filters.categoryId],
        ["countryId", filters.countryId], ["city", filters.city],
        ["budgetMin", filters.budgetMin], ["budgetMax", filters.budgetMax],
        ["currencyCode", filters.currencyCode], ["preferredDateFrom", filters.preferredDateFrom],
        ["preferredDateTo", filters.preferredDateTo], ["maxDistanceKm", filters.maxDistanceKm],
        ["sort", filters.sort], ["cursor", cursor], ["size", size],
      ])}`, auth),
    myRequests: (status?: string, cursor?: string, size = 20) =>
      client.get<Page<ServiceRequest>>(`${BASE}/requests/mine${query([
        ["status", status], ["cursor", cursor], ["size", size],
      ])}`, auth),
    request: (requestId: string) => client.get<ServiceRequest>(`${BASE}/requests/${requestId}`, auth),
    createRequest: (input: ServiceRequestInput) => client.post<ServiceRequest>(`${BASE}/requests`, input, auth),
    updateRequest: (requestId: string, input: ServiceRequestInput) =>
      client.put<ServiceRequest>(`${BASE}/requests/${requestId}`, input, auth),
    deleteRequest: (requestId: string) => client.delete(`${BASE}/requests/${requestId}`, auth),
    publish: (requestId: string) => client.post<ServiceRequest>(`${BASE}/requests/${requestId}/publish`, {}, auth),
    pause: (requestId: string) => client.post<ServiceRequest>(`${BASE}/requests/${requestId}/pause`, {}, auth),
    resume: (requestId: string) => client.post<ServiceRequest>(`${BASE}/requests/${requestId}/resume`, {}, auth),
    close: (requestId: string) => client.post<ServiceRequest>(`${BASE}/requests/${requestId}/close`, {}, auth),
    cancel: (requestId: string) => client.post<ServiceRequest>(`${BASE}/requests/${requestId}/cancel`, {}, auth),
    mediaDownloadUrl: (requestId: string, mediaId: string) =>
      client.get<{ downloadUrl: string }>(`${BASE}/requests/${requestId}/media/${mediaId}/download-url`, auth),

    respond: (requestId: string, serviceProviderId: string, responseType: ResponseType, message: string) =>
      client.post<ProviderResponse>(`${BASE}/requests/${requestId}/responses`, {
        serviceProviderId, responseType, message,
      }, auth),
    requestResponses: (requestId: string, cursor?: string) =>
      client.get<Page<ProviderResponse>>(`${BASE}/requests/${requestId}/responses${query([
        ["cursor", cursor], ["size", 50],
      ])}`, auth),
    myResponses: (serviceProviderId?: string, cursor?: string) =>
      client.get<Page<ProviderResponse>>(`${BASE}/responses/me${query([
        ["serviceProviderId", serviceProviderId], ["cursor", cursor], ["size", 20],
      ])}`, auth),
    updateResponse: (responseId: string, serviceProviderId: string, responseType: ResponseType, message: string) =>
      client.put<ProviderResponse>(`${BASE}/responses/${responseId}`, {
        serviceProviderId, responseType, message,
      }, auth),
    withdrawResponse: (responseId: string) =>
      client.post<ProviderResponse>(`${BASE}/responses/${responseId}/withdraw`, {}, auth),
    acceptResponse: (responseId: string) =>
      client.post<ProviderResponse>(`${BASE}/responses/${responseId}/accept`, {}, auth),
    declineResponse: (responseId: string) =>
      client.post<ProviderResponse>(`${BASE}/responses/${responseId}/decline`, {}, auth),
    accessLead: (requestId: string, serviceProviderId: string, enableChat: boolean, unlockContactDetails: boolean) =>
      client.post<LeadAccess>(`${BASE}/requests/${requestId}/lead-access`, {
        serviceProviderId, enableChat, unlockContactDetails,
      }, auth),
    leadAccess: (leadAccessId: string) => client.get<LeadAccess>(`${BASE}/lead-access/${leadAccessId}`, auth),
    requestLead: (requestId: string, serviceProviderId: string) =>
      client.get<LeadAccess>(`${BASE}/requests/${requestId}/lead-access${query([
        ["serviceProviderId", serviceProviderId],
      ])}`, auth),

    createReview: (requestId: string, serviceProviderId: string, rating: number, reviewText?: string) =>
      client.post<ServiceReview>(`${BASE}/requests/${requestId}/reviews`, {
        serviceProviderId, rating, ...(reviewText ? { reviewText } : {}),
      }, auth),
    requestReviews: (requestId: string, cursor?: string) =>
      client.get<Page<ServiceReview>>(`${BASE}/requests/${requestId}/reviews${query([["cursor", cursor], ["size", 20]])}`, auth),
    providerReviews: (providerId: string, cursor?: string) =>
      client.get<Page<ServiceReview>>(`${BASE}/providers/${providerId}/reviews${query([["cursor", cursor], ["size", 20]])}`, auth),
    myReviews: (cursor?: string) =>
      client.get<Page<ServiceReview>>(`${BASE}/reviews/me${query([["cursor", cursor], ["size", 20]])}`, auth),
    updateReview: (reviewId: string, serviceProviderId: string, rating: number, reviewText?: string) =>
      client.put<ServiceReview>(`${BASE}/reviews/${reviewId}`, {
        serviceProviderId, rating, ...(reviewText ? { reviewText } : {}),
      }, auth),
    respondToReview: (reviewId: string, response: string) =>
      client.patch<ServiceReview>(`${BASE}/reviews/${reviewId}/provider-response`, { response }, auth),

    report: (targetType: "SERVICE_REQUEST" | "SERVICE_PROVIDER" | "SERVICE_REVIEW", targetId: string,
      reasonCode: string, description: string) =>
      client.post<ServiceReport>(`${BASE}/reports`, { targetType, targetId, reasonCode, description }, auth),
  };
}

export type ServiceMarketplaceApi = ReturnType<typeof createServiceMarketplaceApi>;
