import * as ImagePicker from 'expo-image-picker';
import type { ApiClient } from '@/core/api/api-client';

export interface UploadedMatchmakingPhoto {
  assetId: string;
  localUri: string;
}

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Multi-select variant for the gallery. Picks up to `limit` images and
 * uploads them sequentially through the shared media pipeline; a single bad
 * asset does not discard the rest of the selection, but when every selected
 * asset fails the last error is thrown so the failure is visible.
 */
export async function pickAndUploadMatchmakingPhotos(
  client: ApiClient,
  limit: number,
): Promise<UploadedMatchmakingPhoto[]> {
  if (limit <= 0) return [];
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo library access is required to choose profile photos.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: true,
    selectionLimit: limit, quality: 0.85,
  });
  if (result.canceled || !result.assets?.length) return [];
  const uploaded: UploadedMatchmakingPhoto[] = [];
  let lastError: unknown = null;
  for (const asset of result.assets.slice(0, limit)) {
    try {
      const item = await uploadMatchmakingAsset(client, asset);
      if (item) uploaded.push(item);
    } catch (error) {
      // One bad asset must not discard the rest of the selection.
      lastError = error;
    }
  }
  if (!uploaded.length && lastError) throw lastError;
  return uploaded;
}

/** Uploads through the shared Media/R2 lifecycle; only READY assets are attached. */
async function uploadMatchmakingAsset(
  client: ApiClient,
  asset: ImagePicker.ImagePickerAsset,
): Promise<UploadedMatchmakingPhoto | null> {
  const mimeType = asset.mimeType ?? 'image/jpeg';
  if (!ACCEPTED_MIME_TYPES.includes(mimeType)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }

  const response = await fetch(asset.uri);
  if (!response.ok) throw new Error('Could not read the selected photo.');
  const file = await response.blob();
  const size = file.size || asset.fileSize;
  if (!size) throw new Error('The selected photo is empty.');

  const init = await client.post<{ assetId: string; uploadUrl: string }>(
    '/api/v1/media/uploads',
    { purpose: 'MATCHMAKING_PROFILE_PHOTO', mimeType, declaredSizeBytes: size },
    { authenticated: true },
  );
  try {
    const uploaded = await fetch(init.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: file,
    });
    if (!uploaded.ok) throw new Error('The photo upload failed. Try again.');
    const completed = await client.post<{ status: string }>(
      `/api/v1/media/uploads/${init.assetId}/complete`,
      { declaredSizeBytes: size },
      { authenticated: true },
    );
    if (completed.status !== 'READY') throw new Error('The photo is not ready yet. Try again shortly.');
    return { assetId: init.assetId, localUri: asset.uri };
  } catch (error) {
    await client.delete(`/api/v1/media/uploads/${init.assetId}`, { authenticated: true }).catch(() => {});
    throw error;
  }
}
