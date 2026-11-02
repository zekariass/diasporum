import type { ApiClient } from "@/core/api/api-client";
import type {
  BranchRequest,
  Business,
  BusinessCategory,
  BusinessDetail,
  BusinessMedia,
  BusinessMediaRole,
  BusinessRequest,
  BusinessReview,
  DiscoveryFilters,
  OpeningHour,
  Page,
  SelectedImage,
} from "../types/directory-types";

const AUTH = { authenticated: true } as const;

function query(params: [string, string | undefined][]): string {
  const value = params
    .filter(([, item]) => item !== undefined && item !== "")
    .map(([key, item]) => `${key}=${encodeURIComponent(item as string)}`)
    .join("&");
  return value ? `?${value}` : "";
}

/** Uploads through the shared media module, then attaches the READY asset to a profile. */
export async function uploadBusinessImage(
  client: ApiClient,
  businessId: string,
  image: SelectedImage,
  role: BusinessMediaRole,
  sortOrder = 0,
): Promise<BusinessMedia> {
  const file = await (await fetch(image.uri)).blob();
  const init = await client.post<{ assetId: string; uploadUrl: string }>(
    "/api/v1/media/uploads",
    {
      purpose: "BUSINESS",
      mimeType: image.mimeType,
      declaredSizeBytes: file.size,
    },
    AUTH,
  );
  try {
    const uploaded = await fetch(init.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": image.mimeType },
    });
    if (!uploaded.ok) throw new Error("Image upload failed.");
    await client.post(
      `/api/v1/media/uploads/${init.assetId}/complete`,
      { declaredSizeBytes: file.size },
      AUTH,
    );
    return await createDirectoryApi(client).attachMedia(
      businessId,
      init.assetId,
      role,
      sortOrder,
    );
  } catch (error) {
    void client
      .delete(`/api/v1/media/${init.assetId}`, AUTH)
      .catch(() => undefined);
    throw error;
  }
}

export function createDirectoryApi(client: ApiClient) {
  return {
    categories: (countryId?: string) =>
      client.get<{ items: BusinessCategory[] }>(
        `/api/v1/businesses/categories${query([["countryId", countryId]])}`,
        AUTH,
      ),

    discover: (filters: DiscoveryFilters = {}, cursor?: string, size = 20) =>
      client.get<Page<Business>>(
        `/api/v1/businesses${query([
          ["countryId", filters.countryId],
          ["communityId", filters.communityId],
          ["categoryId", filters.categoryId],
          ["city", filters.city],
          ["search", filters.search],
          ["verifiedOnly", filters.verifiedOnly ? "true" : undefined],
          ["latitude", filters.latitude?.toString()],
          ["longitude", filters.longitude?.toString()],
          ["radiusMeters", filters.radiusMeters?.toString()],
          ["sort", filters.sort],
          ["cursor", cursor],
          ["size", String(size)],
        ])}`,
        AUTH,
      ),

    detail: (businessId: string) =>
      client.get<BusinessDetail>(`/api/v1/businesses/${businessId}`, AUTH),

    managed: (businessAccountId?: string, cursor?: string, size = 20) =>
      client.get<Page<Business>>(
        `/api/v1/me/businesses${query([
          ["businessAccountId", businessAccountId],
          ["cursor", cursor],
          ["size", String(size)],
        ])}`,
        AUTH,
      ),

    create: (request: BusinessRequest) =>
      client.post<Business>("/api/v1/businesses", request, AUTH),

    update: (businessId: string, request: Partial<BusinessRequest>) =>
      client.patch<Business>(`/api/v1/businesses/${businessId}`, request, AUTH),

    publish: (businessId: string) =>
      client.post<Business>(
        `/api/v1/businesses/${businessId}/publish`,
        undefined,
        AUTH,
      ),

    unpublish: (businessId: string) =>
      client.post<Business>(
        `/api/v1/businesses/${businessId}/unpublish`,
        undefined,
        AUTH,
      ),

    remove: (businessId: string) =>
      client.delete<void>(`/api/v1/businesses/${businessId}`, AUTH),

    saved: (cursor?: string, size = 20) =>
      client.get<Page<Business>>(
        `/api/v1/me/businesses/saved${query([
          ["cursor", cursor],
          ["size", String(size)],
        ])}`,
        AUTH,
      ),

    save: (businessId: string) =>
      client.put<void>(`/api/v1/businesses/${businessId}/save`, {}, AUTH),

    unsave: (businessId: string) =>
      client.delete<void>(`/api/v1/businesses/${businessId}/save`, AUTH),

    branches: (businessId: string) =>
      client.get<{ items: import("../types/directory-types").BusinessBranch[] }>(
        `/api/v1/businesses/${businessId}/locations`,
        AUTH,
      ),

    createBranch: (businessId: string, request: BranchRequest) =>
      client.post<import("../types/directory-types").BusinessBranch>(
        `/api/v1/businesses/${businessId}/locations`,
        request,
        AUTH,
      ),

    updateBranch: (
      businessId: string,
      locationId: string,
      request: BranchRequest,
    ) =>
      client.patch<import("../types/directory-types").BusinessBranch>(
        `/api/v1/businesses/${businessId}/locations/${locationId}`,
        request,
        AUTH,
      ),

    deactivateBranch: (businessId: string, locationId: string) =>
      client.delete<void>(
        `/api/v1/businesses/${businessId}/locations/${locationId}`,
        AUTH,
      ),

    replaceHours: (
      businessId: string,
      locationId: string,
      hours: OpeningHour[],
    ) =>
      client.put<{ items: OpeningHour[] }>(
        `/api/v1/businesses/${businessId}/locations/${locationId}/hours`,
        { hours },
        AUTH,
      ),

    media: (businessId: string) =>
      client.get<{ items: BusinessMedia[] }>(
        `/api/v1/businesses/${businessId}/media`,
        AUTH,
      ),

    attachMedia: (
      businessId: string,
      mediaId: string,
      role: BusinessMediaRole,
      sortOrder: number,
    ) =>
      client.post<BusinessMedia>(
        `/api/v1/businesses/${businessId}/media`,
        { mediaId, role, sortOrder },
        AUTH,
      ),

    updateMedia: (
      businessId: string,
      mediaId: string,
      role?: BusinessMediaRole,
      sortOrder?: number,
    ) =>
      client.patch<BusinessMedia>(
        `/api/v1/businesses/${businessId}/media/${mediaId}`,
        { role, sortOrder },
        AUTH,
      ),

    detachMedia: (businessId: string, mediaId: string) =>
      client.delete<void>(
        `/api/v1/businesses/${businessId}/media/${mediaId}`,
        AUTH,
      ),

    mediaUrl: (businessId: string, mediaId: string) =>
      client.post<{ downloadUrl: string }>(
        `/api/v1/businesses/${businessId}/media/${mediaId}/download-url`,
        undefined,
        AUTH,
      ),

    reviews: (businessId: string, cursor?: string, size = 20) =>
      client.get<Page<BusinessReview>>(
        `/api/v1/businesses/${businessId}/reviews${query([
          ["cursor", cursor],
          ["size", String(size)],
        ])}`,
        AUTH,
      ),

    createReview: (businessId: string, rating: number, body?: string) =>
      client.post<BusinessReview>(
        `/api/v1/businesses/${businessId}/reviews`,
        { rating, body: body || null },
        AUTH,
      ),

    updateReview: (
      businessId: string,
      reviewId: string,
      rating: number,
      body?: string,
    ) =>
      client.patch<BusinessReview>(
        `/api/v1/businesses/${businessId}/reviews/${reviewId}`,
        { rating, body: body || null },
        AUTH,
      ),

    deleteReview: (businessId: string, reviewId: string) =>
      client.delete<void>(
        `/api/v1/businesses/${businessId}/reviews/${reviewId}`,
        AUTH,
      ),

    respondToReview: (
      businessId: string,
      reviewId: string,
      response?: string,
    ) =>
      client.put<BusinessReview>(
        `/api/v1/businesses/${businessId}/reviews/${reviewId}/response`,
        { response: response || null },
        AUTH,
      ),

    reportBusiness: (businessId: string, reason: string, details?: string) =>
      client.post<{ id: string }>(
        `/api/v1/businesses/${businessId}/report`,
        { reason, details: details || null },
        AUTH,
      ),

    reportReview: (
      businessId: string,
      reviewId: string,
      reason: string,
      details?: string,
    ) =>
      client.post<{ id: string }>(
        `/api/v1/businesses/${businessId}/reviews/${reviewId}/report`,
        { reason, details: details || null },
        AUTH,
      ),

    verification: (businessId: string) =>
      client.get<{ status: string }>(
        `/api/v1/businesses/${businessId}/verification`,
        AUTH,
      ),

    requestVerification: (businessId: string) =>
      client.post<{ status: string }>(
        `/api/v1/businesses/${businessId}/verification/request`,
        undefined,
        AUTH,
      ),

    contact: (businessId: string) =>
      client.post<{ conversationId: string }>(
        `/api/v1/businesses/${businessId}/contact`,
        undefined,
        AUTH,
      ),
  };
}

export type DirectoryApi = ReturnType<typeof createDirectoryApi>;
