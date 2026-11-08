/**
 * CreateReelScreen — pick a video, preview, upload to R2 via signed URL, publish REEL post.
 * Route: /(app)/reels/create
 * Upload flow: initiate → PUT to signed URL → complete → createPost(postType:'REEL').
 */

import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { safeBack } from "@/core/navigation/safe-back";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import { fetch } from "expo/fetch";
import { useVideoPlayer, VideoView } from "expo-video";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { createFeedApi } from "../services/feed-api";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing, BorderRadius } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import type { CreatePostRequest, TagView } from "../types/feed-types";
import { MAX_TAGS, normalizeTag } from "../utils/hashtags";
import { confirmCommunityAction } from "@/core/session/community-actions";

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MiB backend limit

export default function CreateReelScreen() {
  const theme = useTheme();

  const { apiClient, session } = useSession();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState("video/mp4");
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<TagView[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingPublication = React.useRef<{
    fingerprint: string;
    request: CreatePostRequest;
  } | null>(null);

  const player = useVideoPlayer(videoUri ?? "", (p) => {
    p.loop = true;
    p.muted = true;
  });

  // Debounced hashtag suggestions while typing in the tag field.
  React.useEffect(() => {
    const t = setTimeout(() => {
      const q = normalizeTag(tagInput);
      if (!q) {
        setTagSuggestions([]);
        return;
      }
      feedApi
        .suggestTags(q)
        .then(setTagSuggestions)
        .catch(() => setTagSuggestions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [tagInput, feedApi]);

  // tags hold the author's display form (e.g. "DiasporaLife"); the normalized
  // key is derived per entry for dedupe/validation. The backend preserves the
  // submitted display casing in feed_tags.display_name and also merges #tags
  // parsed from the caption.
  const draftTagKey = normalizeTag(tagInput);
  const tagDuplicate =
    draftTagKey !== null && tags.some((t) => normalizeTag(t) === draftTagKey);
  const tagCanAdd =
    draftTagKey !== null && !tagDuplicate && tags.length < MAX_TAGS;

  function addTag(raw: string) {
    const key = normalizeTag(raw);
    if (!key) return;
    if (tags.some((t) => normalizeTag(t) === key)) {
      setTagInput("");
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setError(`You can add up to ${MAX_TAGS} hashtags.`);
      return;
    }
    const display = raw.trim().replace(/^#+/, "").trim();
    setTags((current) => [...current, display || key]);
    setTagInput("");
    setTagSuggestions([]);
    setError(null);
  }

  async function pickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Camera roll access is required to select a video.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsEditing: false,
      quality: 1,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_SIZE_BYTES) {
      setError(
        `Video is ${Math.round(asset.fileSize / 1024 / 1024)}MB — maximum 25MB.`,
      );
      return;
    }
    setVideoUri(asset.uri);
    setMimeType(asset.mimeType ?? "video/mp4");
    setFileSize(asset.fileSize ?? null);
    setDuration(asset.duration ?? null);
    setError(null);
  }

  async function handlePublish() {
    if (!videoUri || publishing || uploading) return;
    const communityId = session?.activeCommunityId;
    if (!communityId) {
      setError("No active community.");
      return;
    }
    const fingerprint = JSON.stringify({
      communityId,
      videoUri,
      mimeType,
      fileSize,
      duration,
      caption: caption.trim(),
      tags,
    });
    const retrying = pendingPublication.current?.fingerprint === fingerprint;
    if (!retrying) pendingPublication.current = null;
    setPublishing(true);
    setError(null);
    try {
      if (!retrying) {
        const confirmed = await confirmCommunityAction(
          apiClient,
          session?.access,
          {
            actionKey: "EXTENDED_REEL_PUBLISH",
            title: "Publish reel?",
            confirmLabel: "Publish",
          },
        );
        if (!confirmed) return;
      }

      let request: CreatePostRequest;
      const pending = retrying ? pendingPublication.current : null;
      if (pending) {
        request = pending.request;
      } else {
        const file = new File(videoUri);
        const size = fileSize != null ? Math.round(fileSize) : file.size;
        const durationMs = duration != null ? Math.round(duration) : undefined;

        // 1. Initiate
        const init = await apiClient.post<{
          assetId: string;
          uploadUrl: string;
        }>(
          "/api/v1/media/uploads",
          {
            purpose: "FEED_VIDEO",
            mimeType,
            declaredSizeBytes: size || undefined,
          },
          { authenticated: true },
        );

        try {
          // 2. Upload to signed R2 URL — expo/fetch streams the File natively;
          //    RN fetch's Response.blob() routes through base64 and fails on multi-MB videos
          setUploading(true);
          setUploadPct(30); // indeterminate — expo/fetch has no upload progress callback
          const uploadRes = await fetch(init.uploadUrl, {
            method: "PUT",
            body: file as unknown as BodyInit,
            headers: { "Content-Type": mimeType },
          });
          setUploadPct(100);
          if (!uploadRes.ok)
            throw new Error(`Upload failed (${uploadRes.status})`);

          // 3. Complete
          await apiClient.post(
            `/api/v1/media/uploads/${init.assetId}/complete`,
            { declaredSizeBytes: size || undefined, durationMs },
            { authenticated: true },
          );
        } catch (uploadErr) {
          apiClient.delete(`/api/v1/media/${init.assetId}`).catch(() => {}); // best-effort cleanup
          throw uploadErr;
        } finally {
          setUploading(false);
        }

        request = {
          communityId,
          postType: "REEL",
          body: caption.trim() || undefined,
          mediaIds: [init.assetId],
          tags: tags.length > 0 ? tags : undefined,
          idempotencyKey: Crypto.randomUUID(),
        };
        pendingPublication.current = { fingerprint, request };
      }

      // 4. Publish — ambiguous retries reuse the original asset and request key.
      try {
        await feedApi.createPost(request);
        pendingPublication.current = null;
        safeBack();
      } catch (postErr) {
        if (
          ApiError.isApiError(postErr) &&
          postErr.httpStatus !== undefined &&
          postErr.httpStatus >= 400 &&
          postErr.httpStatus < 500
        ) {
          request.mediaIds?.forEach((id) => {
            apiClient.delete(`/api/v1/media/${id}`).catch(() => {}); // best-effort cleanup
          });
          pendingPublication.current = null;
        }
        throw postErr;
      }
    } catch (e) {
      setError(
        ApiError.isApiError(e) ? e.userMessage : "Failed to publish reel.",
      );
    } finally {
      setPublishing(false);
      setUploading(false);
    }
  }

  const sizeLabel = fileSize
    ? `${Math.round((fileSize / 1024 / 1024) * 10) / 10}MB`
    : null;
  const durLabel = duration ? `${Math.round(duration / 1000)}s` : null;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.navBar, { borderBottomColor: theme.border }]}>
          <Pressable onPress={() => safeBack()} hitSlop={8}>
            <ThemedText style={{ color: theme.textSecondary }}>
              Cancel
            </ThemedText>
          </Pressable>
          <ThemedText style={styles.navTitle}>New reel</ThemedText>
          <View style={{ width: 50 }} />
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {!videoUri ? (
              <Pressable
                onPress={pickVideo}
                style={[
                  styles.pickerArea,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Select video"
              >
                <ThemedText style={styles.pickerIcon}>🎬</ThemedText>
                <ThemedText style={styles.pickerTitle}>
                  Choose a video
                </ThemedText>
                <ThemedText
                  style={styles.pickerBody}
                  themeColor="textSecondary"
                >
                  MP4 or MOV · Max 25MB
                </ThemedText>
              </Pressable>
            ) : (
              <>
                <View style={styles.previewBox}>
                  <VideoView
                    player={player}
                    style={styles.preview}
                    contentFit="contain"
                    nativeControls={false}
                  />
                  <Pressable
                    onPress={() => player.play()}
                    style={styles.playBtn}
                    accessibilityLabel="Play preview"
                  >
                    <ThemedText style={styles.playBtnText}>▶</ThemedText>
                  </Pressable>
                </View>
                <View style={styles.videoMeta}>
                  {sizeLabel && (
                    <ThemedText style={styles.metaText}>{sizeLabel}</ThemedText>
                  )}
                  {durLabel && (
                    <ThemedText style={styles.metaText}>{durLabel}</ThemedText>
                  )}
                  <Pressable onPress={pickVideo}>
                    <ThemedText
                      style={{
                        color: BrandColors.primary,
                        fontSize: 13,
                        fontWeight: "600",
                      }}
                    >
                      Change
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            )}

            {uploading && (
              <View
                style={[styles.progressBar, { backgroundColor: theme.border }]}
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${uploadPct}%`,
                      backgroundColor: BrandColors.primary,
                    },
                  ]}
                />
                <ThemedText style={styles.progressText}>
                  {uploadPct}%
                </ThemedText>
              </View>
            )}

            <ThemedText style={styles.label}>Caption</ThemedText>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="Write a caption…"
              placeholderTextColor={theme.textSecondary}
              value={caption}
              onChangeText={setCaption}
              multiline
              numberOfLines={3}
              maxLength={500}
            />

            {/* Hashtag entry + suggestions — same UX as the post composer */}
            <View style={styles.tagSection}>
              <ThemedText style={styles.label}>Hashtags</ThemedText>
              <View style={[styles.tagInputRow, { borderColor: theme.border }]}>
                <ThemedText style={styles.tagPrefix} themeColor="textSecondary">
                  #
                </ThemedText>
                <TextInput
                  style={[styles.tagInputField, { color: theme.text }]}
                  placeholder="Add a hashtag"
                  placeholderTextColor={theme.textSecondary}
                  value={tagInput}
                  onChangeText={(text) => setTagInput(text.replace(/^#+/, ""))}
                  onSubmitEditing={() => addTag(tagInput)}
                  returnKeyType="done"
                  autoCapitalize="none"
                  maxLength={60}
                  accessibilityLabel="Hashtag input"
                />
                <Pressable
                  onPress={() => addTag(tagInput)}
                  disabled={!tagCanAdd}
                  style={[styles.tagAddBtn, !tagCanAdd && { opacity: 0.4 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Add hashtag"
                  accessibilityState={{ disabled: !tagCanAdd }}
                >
                  <ThemedText
                    style={[styles.tagAddText, { color: BrandColors.white }]}
                  >
                    Add
                  </ThemedText>
                </Pressable>
              </View>
              {tagSuggestions.length > 0 && (
                <View
                  style={[
                    styles.suggestBox,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  {tagSuggestions.map((s) => (
                    <Pressable
                      key={s.tagKey}
                      onPress={() => addTag(s.displayName)}
                      style={styles.suggestItem}
                      accessibilityRole="button"
                      accessibilityLabel={`Use hashtag ${s.displayName}`}
                    >
                      <ThemedText style={styles.suggestText}>
                        #{s.displayName}
                      </ThemedText>
                      <ThemedText
                        style={styles.suggestCount}
                        themeColor="textSecondary"
                      >
                        {s.postCount} posts
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              )}
              {tags.length > 0 && (
                <View style={styles.tagChips}>
                  {tags.map((t) => (
                    <View
                      key={t}
                      style={[styles.tagChip, { borderColor: theme.border }]}
                    >
                      <ThemedText style={styles.tagChipText}>#{t}</ThemedText>
                      <Pressable
                        onPress={() =>
                          setTags((current) => current.filter((x) => x !== t))
                        }
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove hashtag ${t}`}
                      >
                        <ThemedText
                          style={styles.tagChipRemove}
                          themeColor="textSecondary"
                        >
                          ×
                        </ThemedText>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={
                uploading
                  ? `Uploading ${uploadPct}%`
                  : publishing
                    ? "Publishing…"
                    : "Share reel"
              }
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navTitle: { fontSize: 15, fontWeight: "600" },
  scroll: {
    padding: Spacing.four,
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  pickerArea: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.six,
    gap: Spacing.two,
  },
  pickerIcon: { fontSize: 48 },
  pickerTitle: { fontSize: 16, fontWeight: "600" },
  pickerBody: { fontSize: 13 },
  previewBox: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
    aspectRatio: 9 / 16,
    alignSelf: "center",
    width: "70%",
  },
  preview: { flex: 1 },
  playBtn: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtnText: { fontSize: 48, color: "rgba(255,255,255,0.8)" },
  videoMeta: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  metaText: { fontSize: 12, opacity: 0.6 },
  progressBar: {
    height: 20,
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "center",
  },
  progressFill: { height: "100%", borderRadius: 10 },
  progressText: {
    position: "absolute",
    alignSelf: "center",
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
  },
  label: { fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: "top",
  },
  tagSection: { gap: Spacing.two },
  tagChips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  tagInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.md,
    paddingLeft: Spacing.three,
    paddingRight: 4,
    gap: Spacing.one,
  },
  tagPrefix: { fontSize: 14, fontWeight: "600" },
  tagInputField: { flex: 1, fontSize: 14, paddingVertical: 8 },
  tagAddBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
    backgroundColor: BrandColors.primary,
  },
  tagAddText: { fontSize: 13, fontWeight: "600" },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagChipText: { fontSize: 13, color: BrandColors.primary },
  tagChipRemove: { fontSize: 14, fontWeight: "600" },
  suggestBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  suggestItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  suggestText: { fontSize: 14, fontWeight: "600", color: BrandColors.primary },
  suggestCount: { fontSize: 12 },
  error: { fontSize: 13, color: BrandColors.error, textAlign: "center" },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    paddingTop: Spacing.two,
  },
});
