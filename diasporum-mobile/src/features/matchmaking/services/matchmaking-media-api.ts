import * as ImagePicker from 'expo-image-picker';
import type { ApiClient } from '@/core/api/api-client';

export interface UploadedMatchmakingPhoto {
  assetId: string;
  localUri: string;
}

/**
 * Uses the existing media upload/finalization flow; no parallel media store.
 * Users only ever upload the original — the blurred rendition for
 * BLURRED photo visibility is generated server-side by Diasporum.
 */
export async function pickAndUploadMatchmakingPhoto(
  client: ApiClient,
): Promise<UploadedMatchmakingPhoto | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo library access is required to choose a profile photo.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85,
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;
  const mimeType = asset.mimeType ?? 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }

  const init = await client.post<{ assetId: string; uploadUrl: string }>(
    '/api/v1/media/uploads',
    { purpose: 'MATCHMAKING_PROFILE_PHOTO', mimeType, ...(asset.fileSize ? { declaredSizeBytes: asset.fileSize } : {}) },
    { authenticated: true },
  );
  try {
    const { File } = await import('expo-file-system');
    const { fetch } = await import('expo/fetch');
    const response = await fetch(init.uploadUrl, {
      method: 'PUT', headers: { 'Content-Type': mimeType },
      body: new File(asset.uri) as unknown as BodyInit,
    });
    if (!response.ok) throw new Error('The photo upload failed. Try again.');
    const completed = await client.post<{ status: string }>(
      `/api/v1/media/uploads/${init.assetId}/complete`,
      asset.fileSize ? { declaredSizeBytes: asset.fileSize } : {},
      { authenticated: true },
    );
    if (completed.status !== 'READY') throw new Error('The photo is not ready yet. Try again shortly.');
    return { assetId: init.assetId, localUri: asset.uri };
  } catch (error) {
    await client.delete(`/api/v1/media/uploads/${init.assetId}`, { authenticated: true }).catch(() => {});
    throw error;
  }
}
