/**
 * CreatePostScreen — X/Threads-style composer.
 * Route: /(app)/posts/create
 * Supports GENERAL, POLL, COMMUNITY_HELP (REQUEST/OFFER).
 * ANNOUNCEMENT shown only for MODERATOR/ADMIN roles.
 */

import React, { useState } from "react";
import {
  ActivityIndicator,
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
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";

import { safeBack } from "@/core/navigation/safe-back";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { createFeedApi } from "../services/feed-api";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing, BorderRadius } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import type { HelpKind } from "../types/feed-types";

type ComposerMode = "general" | "poll" | "help" | "announcement";
type AttachmentKind = "image" | "video" | "document";

interface ComposerAttachment {
  id: string;
  kind: AttachmentKind;
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"];
const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
];
const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

function mimeTypeFor(name: string | null | undefined, fallback: string) {
  const extension = name?.split(".").pop()?.toLowerCase();
  return extension ? (EXTENSION_MIME_TYPES[extension] ?? fallback) : fallback;
}

function formatFileSize(size?: number) {
  if (size === undefined) return null;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function CreatePostScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ mode?: string }>();

  const { apiClient, session } = useSession();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);

  const [mode, setMode] = useState<ComposerMode>(
    params.mode === "help" ? "help" : "general",
  );
  const [body, setBody] = useState("");
  const [helpKind, setHelpKind] = useState<HelpKind>("REQUEST");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const communityId = session?.activeCommunityId ?? "";
  const supportsAttachments = mode === "general" || mode === "announcement";
  const canAnnounce = session?.memberships.some(
    (m) =>
      m.communityId === communityId &&
      (m.role === "MODERATOR" || m.role === "ADMIN"),
  );

  function addPollOption() {
    if (pollOptions.length < 10) setPollOptions((p) => [...p, ""]);
  }
  function removePollOption(i: number) {
    if (pollOptions.length > 2)
      setPollOptions((p) => p.filter((_, x) => x !== i));
  }

  function addAttachments(incoming: ComposerAttachment[]) {
    const allowedTypes = (kind: AttachmentKind) =>
      kind === "image"
        ? IMAGE_MIME_TYPES
        : kind === "video"
          ? VIDEO_MIME_TYPES
          : DOCUMENT_MIME_TYPES;
    const invalid = incoming.find(
      (a) => !allowedTypes(a.kind).includes(a.mimeType),
    );
    if (invalid) {
      setError(`${invalid.name} has an unsupported file type.`);
      return;
    }
    const oversized = incoming.find(
      (a) => a.size !== undefined && a.size > MAX_ATTACHMENT_BYTES,
    );
    if (oversized) {
      setError(`${oversized.name} exceeds the 25 MB limit.`);
      return;
    }
    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining === 0) {
      setError(`You can add up to ${MAX_ATTACHMENTS} attachments.`);
      return;
    }
    setAttachments((current) => [...current, ...incoming.slice(0, remaining)]);
    setError(
      incoming.length > remaining
        ? `Only the first ${remaining} attachment${remaining === 1 ? " was" : "s were"} added.`
        : null,
    );
  }

  async function pickMedia(kind: "image" | "video") {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError("Media library access is required to select an attachment.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === "image" ? ["images"] : ["videos"],
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        allowsMultipleSelection: true,
        selectionLimit: MAX_ATTACHMENTS - attachments.length,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;
      const now = Date.now();
      addAttachments(
        result.assets.map((asset, index) => {
          const name = asset.fileName ?? `${kind}-${now + index}`;
          return {
            id: `${now}-${index}-${asset.uri}`,
            kind,
            uri: asset.uri,
            name,
            mimeType: (
              asset.mimeType ??
              mimeTypeFor(name, kind === "image" ? "image/jpeg" : "video/mp4")
            ).toLowerCase(),
            size: asset.fileSize,
          };
        }),
      );
    } catch {
      setError("Unable to open the media picker. Please try again.");
    }
  }

  async function pickDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: DOCUMENT_MIME_TYPES,
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const now = Date.now();
      addAttachments(
        result.assets.map((asset, index) => ({
          id: `${now}-${index}-${asset.uri}`,
          kind: "document",
          uri: asset.uri,
          name: asset.name,
          mimeType: (
            asset.mimeType ?? mimeTypeFor(asset.name, "application/pdf")
          ).toLowerCase(),
          size: asset.size,
        })),
      );
    } catch {
      setError("Unable to open the document picker. Please try again.");
    }
  }

  async function uploadAttachment(
    attachment: ComposerAttachment,
  ): Promise<string> {
    const fileResponse = await fetch(attachment.uri);
    const file = await fileResponse.blob();
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${attachment.name} exceeds the 25 MB limit.`);
    }
    const purpose =
      attachment.kind === "image"
        ? "FEED_IMAGE"
        : attachment.kind === "video"
          ? "FEED_VIDEO"
          : "DOCUMENT";
    const init = await apiClient.post<{ assetId: string; uploadUrl: string }>(
      "/api/v1/media/uploads",
      { purpose, mimeType: attachment.mimeType, declaredSizeBytes: file.size },
      { authenticated: true },
    );
    try {
      const uploadResponse = await fetch(init.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": attachment.mimeType },
      });
      if (!uploadResponse.ok) throw new Error("Attachment upload failed.");
      await apiClient.post(
        `/api/v1/media/uploads/${init.assetId}/complete`,
        { declaredSizeBytes: file.size },
        { authenticated: true },
      );
      return init.assetId;
    } catch (uploadError) {
      apiClient
        .delete(`/api/v1/media/${init.assetId}`, { authenticated: true })
        .catch(() => {});
      throw uploadError;
    }
  }

  function validate(): string | null {
    if (!communityId) return "No active community.";
    if (mode === "poll") {
      if (!body.trim()) return "Enter a poll question.";
      if (pollOptions.some((o) => !o.trim()))
        return "All poll options must be filled.";
    } else if (!body.trim()) return "Write something first.";
    return null;
  }

  async function handleSubmit() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    setError(null);
    const mediaIds: string[] = [];
    try {
      if (mode === "poll") {
        await feedApi.createPoll({
          communityId,
          question: body.trim(),
          options: pollOptions.map((o) => o.trim()),
        });
      } else if (mode === "help") {
        await feedApi.createHelpPost({
          communityId,
          helpKind,
          body: body.trim(),
          title: body.trim().slice(0, 120),
        });
      } else {
        try {
          for (const [index, attachment] of attachments.entries()) {
            setUploadProgress(
              `Uploading ${index + 1} of ${attachments.length}…`,
            );
            mediaIds.push(await uploadAttachment(attachment));
          }
        } catch (uploadError) {
          mediaIds.forEach((id) => {
            apiClient
              .delete(`/api/v1/media/${id}`, { authenticated: true })
              .catch(() => {});
          });
          throw uploadError;
        }
        setUploadProgress(null);
        try {
          await feedApi.createPost({
            communityId,
            postType: mode === "announcement" ? "ANNOUNCEMENT" : "GENERAL",
            body: body.trim(),
            mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
          });
        } catch (postError) {
          // A 4xx means the post was not created. On a timeout it may exist,
          // so retain the assets rather than breaking a successfully created post.
          if (
            ApiError.isApiError(postError) &&
            postError.httpStatus !== undefined &&
            postError.httpStatus >= 400 &&
            postError.httpStatus < 500
          ) {
            mediaIds.forEach((id) => {
              apiClient
                .delete(`/api/v1/media/${id}`, { authenticated: true })
                .catch(() => {});
            });
          }
          throw postError;
        }
      }
      safeBack();
    } catch (e) {
      setError(
        ApiError.isApiError(e)
          ? e.userMessage
          : e instanceof Error && e.message.includes("25 MB")
            ? e.message
            : attachments.length > 0
              ? "Failed to upload attachments or publish the post."
              : "Failed to post.",
      );
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }

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
          <ThemedText style={styles.navTitle}>New post</ThemedText>
          <Pressable
            onPress={handleSubmit}
            disabled={submitting || !body.trim()}
            style={[
              styles.postBtn,
              {
                backgroundColor:
                  submitting || !body.trim()
                    ? theme.border
                    : BrandColors.primary,
              },
            ]}
          >
            <ThemedText style={styles.postBtnText}>Post</ThemedText>
          </Pressable>
        </View>

        {/* Mode tabs */}
        <View style={[styles.modeTabs, { borderBottomColor: theme.border }]}>
          {(["general", "poll", "help"] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={styles.modeTab}
            >
              <ThemedText
                style={[
                  styles.modeTabText,
                  mode === m && {
                    color: BrandColors.primary,
                    fontWeight: "700",
                  },
                ]}
              >
                {m === "general" ? "Post" : m === "poll" ? "Poll" : "Help"}
              </ThemedText>
              {mode === m && (
                <View
                  style={[
                    styles.modeTabLine,
                    { backgroundColor: BrandColors.primary },
                  ]}
                />
              )}
            </Pressable>
          ))}
          {canAnnounce && (
            <Pressable
              onPress={() => setMode("announcement")}
              style={styles.modeTab}
              accessibilityLabel="Create announcement"
            >
              <ThemedText
                style={[
                  styles.modeTabText,
                  mode === "announcement" && {
                    color: BrandColors.primary,
                    fontWeight: "700",
                  },
                ]}
              >
                📢
              </ThemedText>
              {mode === "announcement" && (
                <View
                  style={[
                    styles.modeTabLine,
                    { backgroundColor: BrandColors.primary },
                  ]}
                />
              )}
            </Pressable>
          )}
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {/* Author row */}
            <View style={styles.authorRow}>
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: BrandColors.primarySurface },
                ]}
              >
                <ThemedText
                  style={[styles.avatarText, { color: BrandColors.primary }]}
                >
                  {(session?.profile?.displayName ?? "?")[0].toUpperCase()}
                </ThemedText>
              </View>
              <ThemedText style={styles.authorName}>
                {session?.profile?.displayName ?? "You"}
              </ThemedText>
            </View>

            {/* Help kind toggle */}
            {mode === "help" && (
              <View style={styles.helpKindRow}>
                {(["REQUEST", "OFFER"] as const).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => setHelpKind(k)}
                    style={[
                      styles.helpKindBtn,
                      {
                        borderColor:
                          helpKind === k ? BrandColors.primary : theme.border,
                        backgroundColor:
                          helpKind === k
                            ? BrandColors.primarySurface
                            : "transparent",
                      },
                    ]}
                  >
                    <ThemedText
                      style={{
                        color:
                          helpKind === k
                            ? BrandColors.primary
                            : theme.textSecondary,
                        fontSize: 13,
                        fontWeight: "600",
                      }}
                    >
                      {k === "REQUEST" ? "Requesting help" : "Offering help"}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Text input */}
            <TextInput
              style={[styles.textInput, { color: theme.text }]}
              placeholder={
                mode === "poll"
                  ? "What's the question?"
                  : "What's happening in your community?"
              }
              placeholderTextColor={theme.textSecondary}
              value={body}
              onChangeText={setBody}
              multiline
              autoFocus
              maxLength={4000}
            />

            {/* Attachment previews */}
            {supportsAttachments && attachments.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.attachmentList}
              >
                {attachments.map((attachment) => {
                  const sizeLabel = formatFileSize(attachment.size);
                  return (
                    <View
                      key={attachment.id}
                      style={[
                        styles.attachmentCard,
                        { backgroundColor: theme.backgroundElement },
                      ]}
                    >
                      {attachment.kind === "image" ? (
                        <Image
                          source={{ uri: attachment.uri }}
                          style={styles.attachmentPreview}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={styles.attachmentPreview}>
                          <Ionicons
                            name={
                              attachment.kind === "video"
                                ? "videocam-outline"
                                : "document-text-outline"
                            }
                            size={36}
                            color={BrandColors.primary}
                          />
                        </View>
                      )}
                      <ThemedText
                        style={styles.attachmentName}
                        numberOfLines={1}
                      >
                        {attachment.name}
                      </ThemedText>
                      {sizeLabel && (
                        <ThemedText
                          style={styles.attachmentSize}
                          themeColor="textSecondary"
                        >
                          {sizeLabel}
                        </ThemedText>
                      )}
                      <Pressable
                        onPress={() =>
                          setAttachments((current) =>
                            current.filter((a) => a.id !== attachment.id),
                          )
                        }
                        disabled={submitting}
                        hitSlop={8}
                        style={[
                          styles.removeAttachment,
                          { backgroundColor: theme.background },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${attachment.name}`}
                      >
                        <Ionicons name="close" size={16} color={theme.text} />
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            {/* Poll options */}
            {mode === "poll" && (
              <View style={styles.pollOptions}>
                {pollOptions.map((opt, i) => (
                  <View
                    key={i}
                    style={[
                      styles.pollOptionRow,
                      { backgroundColor: theme.backgroundElement },
                    ]}
                  >
                    <TextInput
                      style={[styles.pollOptionInput, { color: theme.text }]}
                      placeholder={`Option ${i + 1}`}
                      placeholderTextColor={theme.textSecondary}
                      value={opt}
                      onChangeText={(v) =>
                        setPollOptions((p) =>
                          p.map((o, x) => (x === i ? v : o)),
                        )
                      }
                      maxLength={120}
                    />
                    {pollOptions.length > 2 && (
                      <Pressable
                        onPress={() => removePollOption(i)}
                        hitSlop={8}
                      >
                        <ThemedText
                          style={{ color: BrandColors.error, fontSize: 18 }}
                        >
                          ✕
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>
                ))}
                {pollOptions.length < 10 && (
                  <Pressable
                    onPress={addPollOption}
                    style={styles.addOptionBtn}
                  >
                    <ThemedText
                      style={{
                        color: BrandColors.primary,
                        fontSize: 14,
                        fontWeight: "600",
                      }}
                    >
                      + Add option
                    </ThemedText>
                  </Pressable>
                )}
              </View>
            )}

            {supportsAttachments && (
              <View
                style={[
                  styles.attachmentToolbar,
                  { borderTopColor: theme.border },
                ]}
              >
                <Pressable
                  onPress={() => pickMedia("image")}
                  disabled={submitting || attachments.length >= MAX_ATTACHMENTS}
                  style={styles.attachmentAction}
                  accessibilityRole="button"
                  accessibilityLabel="Add images"
                >
                  <Ionicons
                    name="image-outline"
                    size={23}
                    color={BrandColors.primary}
                  />
                  <ThemedText style={styles.attachmentActionText}>
                    Image
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => pickMedia("video")}
                  disabled={submitting || attachments.length >= MAX_ATTACHMENTS}
                  style={styles.attachmentAction}
                  accessibilityRole="button"
                  accessibilityLabel="Add videos"
                >
                  <Ionicons
                    name="videocam-outline"
                    size={24}
                    color={BrandColors.primary}
                  />
                  <ThemedText style={styles.attachmentActionText}>
                    Video
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={pickDocument}
                  disabled={submitting || attachments.length >= MAX_ATTACHMENTS}
                  style={styles.attachmentAction}
                  accessibilityRole="button"
                  accessibilityLabel="Add documents"
                >
                  <Ionicons
                    name="document-text-outline"
                    size={22}
                    color={BrandColors.primary}
                  />
                  <ThemedText style={styles.attachmentActionText}>
                    Document
                  </ThemedText>
                </Pressable>
              </View>
            )}

            {uploadProgress && (
              <View style={styles.uploadStatus}>
                <ActivityIndicator size="small" color={BrandColors.primary} />
                <ThemedText
                  style={styles.uploadStatusText}
                  themeColor="textSecondary"
                >
                  {uploadProgress}
                </ThemedText>
              </View>
            )}
            {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          </ScrollView>
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
  postBtn: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 6 },
  postBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  modeTabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modeTab: { flex: 1, alignItems: "center", paddingVertical: Spacing.two },
  modeTabText: { fontSize: 13, fontWeight: "500" },
  modeTabLine: { height: 2, width: 32, borderRadius: 1, marginTop: 2 },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  authorRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 17, fontWeight: "700" },
  authorName: { fontSize: 14, fontWeight: "600" },
  helpKindRow: { flexDirection: "row", gap: Spacing.two },
  helpKindBtn: {
    borderWidth: 1.5,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  textInput: {
    fontSize: 16,
    lineHeight: 24,
    minHeight: 120,
    textAlignVertical: "top",
  },
  pollOptions: { gap: Spacing.two },
  pollOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 4,
  },
  pollOptionInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  addOptionBtn: { alignSelf: "flex-start", paddingVertical: 4 },
  attachmentList: { gap: Spacing.two, paddingVertical: Spacing.one },
  attachmentCard: {
    width: 132,
    borderRadius: BorderRadius.md,
    padding: Spacing.two,
  },
  attachmentPreview: {
    width: "100%",
    height: 104,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentName: { fontSize: 12, fontWeight: "500", marginTop: Spacing.one },
  attachmentSize: { fontSize: 11, marginTop: 2 },
  removeAttachment: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentToolbar: {
    flexDirection: "row",
    gap: Spacing.four,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
  attachmentAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingVertical: Spacing.one,
  },
  attachmentActionText: { fontSize: 12, fontWeight: "500" },
  uploadStatus: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  uploadStatusText: { fontSize: 13 },
  error: { fontSize: 13, color: BrandColors.error, textAlign: "center" },
});
