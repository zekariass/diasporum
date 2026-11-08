import { useCallback, useState } from 'react';
import { useSession } from '@/core/session/session-provider';
import { pickAndUploadMatchmakingPhoto } from '../services/matchmaking-media-api';

/**
 * Pick→upload flow for the original Matchmaking profile photo. The blurred
 * rendition is generated server-side, so there is only ever one photo to
 * manage. Keeps the local preview URI so the form re-renders immediately and
 * can re-fetch the owner's original when resuming a draft.
 */
export function useMatchmakingPhotoUpload() {
  const { apiClient } = useSession();
  const [uploading, setUploading] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const upload = useCallback(async () => {
    if (uploading) return null;
    setUploading(true);
    try {
      const uploaded = await pickAndUploadMatchmakingPhoto(apiClient);
      if (uploaded) {
        setPhotoUri(uploaded.localUri);
      }
      return uploaded;
    } finally {
      setUploading(false);
    }
  }, [apiClient, uploading]);

  /** Owner-scoped download URL — lets a resumed draft show its saved photo. */
  const hydratePreview = useCallback(async (mediaId: string) => {
    const { downloadUrl } = await apiClient.post<{ downloadUrl: string }>(
      `/api/v1/media/${mediaId}/download-url`, {}, { authenticated: true });
    setPhotoUri(downloadUrl);
  }, [apiClient]);

  const clearPreview = useCallback(() => setPhotoUri(null), []);

  return { uploading, photoUri, upload, hydratePreview, clearPreview };
}
