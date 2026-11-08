import type { ApiClient } from "@/core/api/api-client";

export interface MediaUploadSelection {
  uri: string;
  mimeType: string;
  fileName?: string;
  /** Declared audio duration — validated server-side for FEED_AUDIO. */
  durationMs?: number;
}

/** Uploads one selected file through Media's initiate, direct PUT, and READY lifecycle. */
export async function uploadMedia(
  client: ApiClient,
  selection: MediaUploadSelection,
  purpose: string,
): Promise<string> {
  const fileResponse = await fetch(selection.uri);
  if (!fileResponse.ok) throw new Error("Could not read the selected file.");
  const file = await fileResponse.blob();
  const init = await client.post<{ assetId: string; uploadUrl: string }>(
    "/api/v1/media/uploads",
    {
      purpose,
      mimeType: selection.mimeType,
      declaredSizeBytes: file.size,
      durationMs: selection.durationMs,
    },
    { authenticated: true },
  );
  try {
    const upload = await fetch(init.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": selection.mimeType },
    });
    if (!upload.ok) throw new Error("File upload failed.");
    await client.post(
      `/api/v1/media/uploads/${init.assetId}/complete`,
      { declaredSizeBytes: file.size, durationMs: selection.durationMs },
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
