/**
 * M4 — useAttachments: manages pending attachment selection, upload,
 * retry and cancellation before a message is sent.
 * Uses expo-crypto for IDs (no uuid dependency needed).
 * Uses ImagePicker.MediaType (Expo 52+ replacement for MediaTypeOptions).
 */
import { useCallback, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { MediaApi } from '../services/media-api';
import type { PendingAttachment } from '../types/messaging-types';

const MAX_ATTACHMENTS = 4;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB — matches backend default

const DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
];

export type UseAttachmentsReturn = ReturnType<typeof useAttachments>;

export function useAttachments(mediaApi: MediaApi) {
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const pendingAssetIds = useRef<string[]>([]);

  const update = useCallback((localId: string, patch: Partial<PendingAttachment>) => {
    setPending((prev) =>
      prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a))
    );
  }, []);

  const upload = useCallback(async (attachment: PendingAttachment) => {
    try {
      update(attachment.localId, { status: 'uploading', progress: 0, error: null });

      const init = await mediaApi.initiateUpload({
        purpose: attachment.purpose,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        originalFilename: attachment.name,
      });

      pendingAssetIds.current.push(init.assetId);
      update(attachment.localId, { assetId: init.assetId });

      await mediaApi.uploadToPresignedUrl(
        init.uploadUrl,
        attachment.uri,
        attachment.mimeType,
        (progress) => update(attachment.localId, { progress })
      );

      await mediaApi.completeUpload(init.assetId);
      pendingAssetIds.current = pendingAssetIds.current.filter((id) => id !== init.assetId);
      update(attachment.localId, { status: 'done', progress: 1 });
    } catch (err: unknown) {
      update(attachment.localId, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }, [mediaApi, update]);

  const addImageFromGallery = useCallback(async () => {
    if (pending.length >= MAX_ATTACHMENTS) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      selectionLimit: MAX_ATTACHMENTS - pending.length,
      quality: 0.85,
    });
    if (result.canceled) return;
    const newItems: PendingAttachment[] = result.assets
      .filter((a) => !a.fileSize || a.fileSize <= MAX_FILE_BYTES)
      .slice(0, MAX_ATTACHMENTS - pending.length)
      .map((a) => ({
        localId: Crypto.randomUUID(),
        uri: a.uri,
        name: a.fileName ?? `image_${Date.now()}.jpg`,
        mimeType: a.mimeType ?? 'image/jpeg',
        sizeBytes: a.fileSize ?? 0,
        purpose: 'MESSAGE_IMAGE' as const,
        status: 'idle' as const,
        progress: 0,
        assetId: null,
        error: null,
      }));
    setPending((prev) => [...prev, ...newItems]);
    newItems.forEach((att) => upload(att));
  }, [pending.length, upload]);

  const addImageFromCamera = useCallback(async () => {
    if (pending.length >= MAX_ATTACHMENTS) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (result.canceled) return;
    const a = result.assets[0];
    const att: PendingAttachment = {
      localId: Crypto.randomUUID(),
      uri: a.uri,
      name: a.fileName ?? `photo_${Date.now()}.jpg`,
      mimeType: a.mimeType ?? 'image/jpeg',
      sizeBytes: a.fileSize ?? 0,
      purpose: 'MESSAGE_IMAGE',
      status: 'idle',
      progress: 0,
      assetId: null,
      error: null,
    };
    setPending((prev) => [...prev, att]);
    upload(att);
  }, [pending.length, upload]);

  const addDocument = useCallback(async () => {
    if (pending.length >= MAX_ATTACHMENTS) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: DOCUMENT_TYPES,
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const file = result.assets[0];
    if ((file.size ?? 0) > MAX_FILE_BYTES) return;
    const att: PendingAttachment = {
      localId: Crypto.randomUUID(),
      uri: file.uri,
      name: file.name,
      mimeType: file.mimeType ?? 'application/octet-stream',
      sizeBytes: file.size ?? 0,
      purpose: 'MESSAGE_DOCUMENT',
      status: 'idle',
      progress: 0,
      assetId: null,
      error: null,
    };
    setPending((prev) => [...prev, att]);
    upload(att);
  }, [pending.length, upload]);

  const removeAttachment = useCallback(async (localId: string) => {
    const att = pending.find((a) => a.localId === localId);
    if (att?.assetId) await mediaApi.cancelUpload(att.assetId);
    setPending((prev) => prev.filter((a) => a.localId !== localId));
  }, [pending, mediaApi]);

  const retryAttachment = useCallback((localId: string) => {
    const att = pending.find((a) => a.localId === localId);
    if (att) upload(att);
  }, [pending, upload]);

  const clearAll = useCallback(() => setPending([]), []);

  const cancelPending = useCallback(() => {
    for (const id of pendingAssetIds.current) mediaApi.cancelUpload(id);
    pendingAssetIds.current = [];
  }, [mediaApi]);

  const readyAssetIds = pending
    .filter((a) => a.status === 'done' && a.assetId)
    .map((a) => a.assetId as string);

  return {
    pending,
    readyAssetIds,
    allDone: pending.length > 0 && pending.every((a) => a.status === 'done' || a.status === 'failed'),
    hasFailures: pending.some((a) => a.status === 'failed'),
    isUploading: pending.some((a) => a.status === 'uploading'),
    addImageFromGallery,
    addImageFromCamera,
    addDocument,
    removeAttachment,
    retryAttachment,
    clearAll,
    cancelPending,
  };
}
