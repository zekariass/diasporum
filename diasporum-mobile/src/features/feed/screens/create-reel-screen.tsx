/**
 * CreateReelScreen — pick a video, preview, upload to R2 via signed URL, publish REEL post.
 * Route: /(app)/reels/create
 * Upload flow: initiate → PUT to signed URL → complete → createPost(postType:'REEL').
 */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { safeBack } from '@/core/navigation/safe-back';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/shared/components/primary-button';
import { useSession } from '@/core/session/session-provider';
import { createFeedApi } from '../services/feed-api';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/core/api/api-error';

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MiB backend limit

export default function CreateReelScreen() {
  const theme = useTheme();

  const { apiClient, session } = useSession();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState('video/mp4');
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const player = useVideoPlayer(videoUri ?? '', p => { p.loop = true; p.muted = true; });

  async function pickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setError('Camera roll access is required to select a video.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_SIZE_BYTES) {
      setError(`Video is ${Math.round(asset.fileSize / 1024 / 1024)}MB — maximum 25MB.`);
      return;
    }
    setVideoUri(asset.uri);
    setMimeType(asset.mimeType ?? 'video/mp4');
    setFileSize(asset.fileSize ?? null);
    setDuration(asset.duration ?? null);
    setError(null);
  }

  async function handlePublish() {
    if (!videoUri || publishing || uploading) return;
    const communityId = session?.activeCommunityId;
    if (!communityId) { setError('No active community.'); return; }
    setPublishing(true);
    setError(null);
    try {
      // 1. Initiate
      const init = await apiClient.post<{ assetId: string; uploadUrl: string }>(
        '/api/v1/media/uploads',
        { purpose: 'FEED_VIDEO', mimeType },
        { authenticated: true });
      
      // 2. Upload to signed R2 URL — read file as blob, PUT directly
      setUploading(true);
      setUploadPct(30); // indeterminate — fetch has no progress callback
      const fileRes = await fetch(videoUri);
      const blob = await fileRes.blob();
      const uploadRes = await fetch(init.uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': mimeType },
      });
      setUploading(false);
      setUploadPct(100);
      if (!uploadRes.ok) throw new Error('Upload failed');

      // 3. Complete
      await apiClient.post(`/api/v1/media/uploads/${init.assetId}/complete`, {}, { authenticated: true });

      // 4. Publish — on definite failure (4xx), clean up the orphaned asset
      try {
        await feedApi.createPost({
          communityId, postType: 'REEL',
          body: caption.trim() || undefined,
          mediaIds: [init.assetId],
        });
        safeBack();
      } catch (postErr) {
        // Only delete on definite API failure (4xx) — a network timeout may mean
        // the post WAS created; deleting the asset would break it
        if (ApiError.isApiError(postErr) && postErr.httpStatus !== undefined && postErr.httpStatus >= 400 && postErr.httpStatus < 500) {
          apiClient.delete(`/api/v1/media/${init.assetId}`).catch(() => {}); // best-effort cleanup
        }
        throw postErr;
      }
    } catch (e) {
      setError(ApiError.isApiError(e) ? e.userMessage : 'Failed to publish reel.');
    } finally {
      setPublishing(false);
      setUploading(false);
    }
  }

  const sizeLabel = fileSize ? `${Math.round(fileSize / 1024 / 1024 * 10) / 10}MB` : null;
  const durLabel = duration ? `${Math.round(duration)}s` : null;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.navBar, { borderBottomColor: theme.border }]}>
          <Pressable onPress={() => safeBack()} hitSlop={8}>
            <ThemedText style={{ color: theme.textSecondary }}>Cancel</ThemedText>
          </Pressable>
          <ThemedText style={styles.navTitle}>New reel</ThemedText>
          <View style={{ width: 50 }} />
        </View>

        <KeyboardAvoidingView style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled">

            {!videoUri ? (
              <Pressable onPress={pickVideo}
                style={[styles.pickerArea, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                accessibilityRole="button" accessibilityLabel="Select video">
                <ThemedText style={styles.pickerIcon}>🎬</ThemedText>
                <ThemedText style={styles.pickerTitle}>Choose a video</ThemedText>
                <ThemedText style={styles.pickerBody} themeColor="textSecondary">
                  MP4 or MOV · Max 25MB
                </ThemedText>
              </Pressable>
            ) : (
              <>
                <View style={styles.previewBox}>
                  <VideoView player={player} style={styles.preview}
                    contentFit="contain" nativeControls={false} />
                  <Pressable onPress={() => player.play()} style={styles.playBtn}
                    accessibilityLabel="Play preview">
                    <ThemedText style={styles.playBtnText}>▶</ThemedText>
                  </Pressable>
                </View>
                <View style={styles.videoMeta}>
                  {sizeLabel && <ThemedText style={styles.metaText}>{sizeLabel}</ThemedText>}
                  {durLabel && <ThemedText style={styles.metaText}>{durLabel}</ThemedText>}
                  <Pressable onPress={pickVideo}>
                    <ThemedText style={{ color: BrandColors.primary, fontSize: 13, fontWeight: '600' }}>
                      Change
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            )}

            {uploading && (
              <View style={[styles.progressBar, { backgroundColor: theme.border }]}>
                <View style={[styles.progressFill, { width: `${uploadPct}%`, backgroundColor: BrandColors.primary }]} />
                <ThemedText style={styles.progressText}>{uploadPct}%</ThemedText>
              </View>
            )}

            <ThemedText style={styles.label}>Caption</ThemedText>
            <TextInput
              style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
              placeholder="Write a caption…"
              placeholderTextColor={theme.textSecondary}
              value={caption}
              onChangeText={setCaption}
              multiline
              numberOfLines={3}
              maxLength={500}
            />

            {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={uploading ? `Uploading ${uploadPct}%` : publishing ? 'Publishing…' : 'Share reel'}
              onPress={handlePublish}
              loading={uploading || publishing}
              disabled={!videoUri || uploading || publishing}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navTitle: { fontSize: 15, fontWeight: '600' },
  scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.five },
  pickerArea: {
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.six, gap: Spacing.two,
  },
  pickerIcon: { fontSize: 48 },
  pickerTitle: { fontSize: 16, fontWeight: '600' },
  pickerBody: { fontSize: 13 },
  previewBox: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#000',
    aspectRatio: 9 / 16, alignSelf: 'center', width: '70%' },
  preview: { flex: 1 },
  playBtn: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  playBtnText: { fontSize: 48, color: 'rgba(255,255,255,0.8)' },
  videoMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  metaText: { fontSize: 12, opacity: 0.6 },
  progressBar: { height: 20, borderRadius: 10, overflow: 'hidden', justifyContent: 'center' },
  progressFill: { height: '100%', borderRadius: 10 },
  progressText: { position: 'absolute', alignSelf: 'center', fontSize: 11, fontWeight: '700', color: '#fff' },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two, fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  error: { fontSize: 13, color: BrandColors.error, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.five, paddingTop: Spacing.two },
});
