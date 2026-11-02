import type { ApiClient } from "@/core/api/api-client";
import type { PropertyImageSelection } from "../types/property-types";

/** Uploads through the shared Media/R2 lifecycle; only READY assets are attached. */
export async function uploadPropertyImage(
  client: ApiClient,
  selection: PropertyImageSelection,
): Promise<string> {
  const response = await fetch(selection.uri);
  if (!response.ok) throw new Error("Could not read the selected image.");
  const file = await response.blob();
  const size = file.size || selection.size;
  if (!size) throw new Error("The selected image is empty.");
  const init = await client.post<{ assetId: string; uploadUrl: string }>(
    "/api/v1/media/uploads",
    {
      purpose: "PROPERTY",
      mimeType: selection.mimeType,
      declaredSizeBytes: size,
    },
    { authenticated: true },
  );
  try {
    const uploaded = await fetch(init.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": selection.mimeType },
    });
    if (!uploaded.ok) throw new Error("Image upload failed.");
    await client.post(
      `/api/v1/media/uploads/${init.assetId}/complete`,
      { declaredSizeBytes: size },
      { authenticated: true },
    );
    return init.assetId;
  } catch (error) {
    void client
      .delete(`/api/v1/media/${init.assetId}`, { authenticated: true })
      .catch(() => {});
    throw error;
  }
}
