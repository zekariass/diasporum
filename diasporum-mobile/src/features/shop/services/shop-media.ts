/**
 * Shop media upload helper — shared initiate → PUT → complete lifecycle through
 * the Diasporum media module. `purpose` must match what the attaching endpoint
 * validates: "PRODUCT" (product photos, review media), "SHOP" (logo/cover/
 * gallery), "OTHER" (return-request attachments).
 */
import type { ApiClient } from "@/core/api/api-client";

export async function uploadShopImage(
  apiClient: ApiClient,
  uri: string,
  mimeType: string,
  purpose: "PRODUCT" | "SHOP" | "OTHER",
): Promise<string> {
  const file = await (await fetch(uri)).blob();
  const init = await apiClient.post<{ assetId: string; uploadUrl: string }>(
    "/api/v1/media/uploads",
    { purpose, mimeType, declaredSizeBytes: file.size },
    { authenticated: true },
  );
  const put = await fetch(init.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": mimeType },
  });
  if (!put.ok) throw new Error("Photo upload failed.");
  await apiClient.post(`/api/v1/media/uploads/${init.assetId}/complete`,
    { declaredSizeBytes: file.size }, { authenticated: true });
  return init.assetId;
}
