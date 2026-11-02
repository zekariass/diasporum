import { File } from "expo-file-system";
import { fetch } from "expo/fetch";
import type { ApiClient } from "@/core/api/api-client";

export interface SpareBagImageSelection {
  uri: string;
  mimeType: string;
  size: number;
}

/** Uploads an image using the existing authenticated Media API and presigned R2 URL. */
export async function uploadSpareBagImage(
  client: ApiClient,
  selection: SpareBagImageSelection,
): Promise<string> {
  const file = new File(selection.uri);
  const size = selection.size || file.size;
  const initialized = await client.post<{ assetId: string; uploadUrl: string }>(
    "/api/v1/media/uploads",
    {
      purpose: "SPARE_BAG_LISTING",
      mimeType: selection.mimeType,
      declaredSizeBytes: size,
    },
    { authenticated: true },
  );
  try {
    const response = await fetch(initialized.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": selection.mimeType },
      body: file as unknown as BodyInit,
    });
    if (!response.ok) throw new Error("Image upload failed.");
    await client.post(
      `/api/v1/media/uploads/${initialized.assetId}/complete`,
      { declaredSizeBytes: size },
      { authenticated: true },
    );
    return initialized.assetId;
  } catch (error) {
    void client.delete(`/api/v1/media/${initialized.assetId}`, { authenticated: true })
      .catch(() => undefined);
    throw error;
  }
}
