import { File } from "expo-file-system";
import { fetch } from "expo/fetch";
import type { ApiClient } from "@/core/api/api-client";

export interface ServiceImageSelection {
  uri: string;
  mimeType: string;
  size: number;
}

/** Uses the shared Media API; temporary assets are cleaned up on upload failure. */
export async function uploadServiceRequestImage(
  client: ApiClient,
  selection: ServiceImageSelection,
): Promise<string> {
  const file = new File(selection.uri);
  const size = selection.size || file.size;
  const initialized = await client.post<{ assetId: string; uploadUrl: string }>(
    "/api/v1/media/uploads",
    { purpose: "SERVICE_REQUEST", mimeType: selection.mimeType, declaredSizeBytes: size },
    { authenticated: true },
  );
  try {
    const response = await fetch(initialized.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": selection.mimeType },
      body: file as unknown as BodyInit,
    });
    if (!response.ok) throw new Error("Image upload failed.");
    await client.post(`/api/v1/media/uploads/${initialized.assetId}/complete`,
      { declaredSizeBytes: size }, { authenticated: true });
    return initialized.assetId;
  } catch (error) {
    void client.delete(`/api/v1/media/${initialized.assetId}`, { authenticated: true })
      .catch(() => undefined);
    throw error;
  }
}
