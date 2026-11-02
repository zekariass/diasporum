/**
 * M4 â€” Media upload API for direct-message attachments.
 * Uses the existing /api/v1/media/* endpoints from the media module.
 */
import type { ApiClient } from '@/core/api/api-client';

export interface InitiateUploadRequest {
  purpose: 'MESSAGE_IMAGE' | 'MESSAGE_DOCUMENT';
  mimeType: string;
  sizeBytes: number;
  originalFilename?: string;
}

export interface InitiateUploadResponse {
  assetId: string;
  uploadUrl: string;
}

export interface CompleteUploadResponse {
  assetId: string;
  status: string;
}

export function createMediaApi(client: ApiClient) {
  return {
    /**
     * Step 1: Request an upload session and presigned PUT URL.
     * Returns assetId + uploadUrl for direct R2 upload from the client.
     */
    initiateUpload: (req: InitiateUploadRequest) =>
      client.post<InitiateUploadResponse>('/api/v1/media/uploads', req, {
        authenticated: true,
      }),

    /**
     * Step 2: After uploading directly to the presigned URL, notify the
     * backend to verify and mark the asset READY.
     */
    completeUpload: (assetId: string) =>
      client.post<CompleteUploadResponse>(`/api/v1/media/uploads/${assetId}/complete`, {}, {
        authenticated: true,
      }),

    /**
     * Cancel a pending upload. Call on component unmount if the upload was
     * initiated but the user dismissed the composer.
     */
    cancelUpload: (assetId: string) =>
      client.delete(`/api/v1/media/uploads/${assetId}`, { authenticated: true })
        .catch(() => { /* best-effort cleanup */ }),

    /**
     * Upload file bytes directly to the presigned R2 URL.
     * Uses expo/fetch + expo-file-system File (Expo 58 supported API).
     * The File object is passed as body — sends raw binary bytes for a
     * presigned PUT, not multipart form-data.
     * NOTE: expo/fetch does not support upload progress callbacks.
     * The onProgress param is accepted for API stability but the progress
     * event is emitted only once at completion (0 -> 1).
     */
    uploadToPresignedUrl: async (
      uploadUrl: string,
      uri: string,
      mimeType: string,
      onProgress?: (progress: number) => void
    ): Promise<void> => {
      const { File } = await import('expo-file-system');
      const { fetch } = await import('expo/fetch');
      const file = new File(uri);
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: file as unknown as BodyInit,
      });
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }
      onProgress?.(1);
    },
  };
}

export type MediaApi = ReturnType<typeof createMediaApi>;
