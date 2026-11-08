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
import * as Crypto from "expo-crypto";

import { safeBack } from "@/core/navigation/safe-back";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { createFeedApi } from "../services/feed-api";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing, BorderRadius } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import type {
  CategoryView,
  CreateHelpPostRequest,
  CreatePostRequest,
  HelpKind,
  TagView,
} from "../types/feed-types";
import {
  createPollRequest,
  emptyPollFormValue,
  PollForm,
  validatePollForm,
} from "../components/poll-form";
import {
  VoiceRecorder,
  type RecordedVoice,
} from "../components/voice-recorder";
import { MAX_TAGS, normalizeTag } from "../utils/hashtags";
import { confirmCommunityAction } from "@/core/session/community-actions";

type ComposerMode = "general" | "poll" | "help" | "announcement";
type AttachmentKind = "image" | "video" | "document" | "audio";

interface ComposerAttachment {
  id: string;
  kind: AttachmentKind;
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  durationMs?: number;
}

interface PendingPublication {
  fingerprint: string;
  request: CreatePostRequest | CreateHelpPostRequest;
}

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_MS = 300_000;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"];
const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
];
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
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
};

function mimeTypeFor(name: string | null | undefined, fallback: string) {
  const extension = name?.split(".").pop()?.toLowerCase();
  return extension ? (EXTENSION_MIME_TYPES[extension] ?? fallback) : fallback;
}

function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
    params.mode === "help"
      ? "help"
      : params.mode === "poll"
        ? "poll"
        : "general",
  );
  const [body, setBody] = useState("");
  const [helpKind, setHelpKind] = useState<HelpKind>("REQUEST");
  const [helpTitle, setHelpTitle] = useState("");
  const [helpExpiryDays, setHelpExpiryDays] = useState<number | null>(null);
  const [poll, setPoll] = useState(emptyPollFormValue);
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<TagView[]>([]);
  const [recording, setRecording] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingPublication = React.useRef<PendingPublication | null>(null);

  const communityId = session?.activeCommunityId ?? "";
  const supportsAttachments = mode !== "poll";
  const canAnnounce = session?.memberships.some(
    (m) =>
      m.communityId === communityId &&
      (m.role === "MODERATOR" || m.role === "ADMIN"),
  );

  // Categories are required for every post — module differs per mode.
  const categoryModule = mode === "help" ? "COMMUNITY_HELP" : "FEED";
  React.useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    async function loadCategories() {
      setCategories([]);
      setCategoriesLoading(true);
      try {
        const community = await feedApi.communityDetail(communityId);
        if (!community.destinationCountryId) {
          throw new Error("Missing destination country");
        }
        const response = await feedApi.feedCategories(
          community.destinationCountryId,
          categoryModule,
        );
        if (!cancelled)
          setCategories(response.items.filter((category) => category.active));
      } catch {
        if (!cancelled) setError("Failed to load post categories.");
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    }
    void loadCategories();
    return () => {
      cancelled = true;
    };
  }, [communityId, feedApi, categoryModule]);

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

  // tags hold the author's display form (e.g. "StudentLife"); the normalized
  // key is derived per entry for dedupe/validation. The backend preserves the
  // submitted display casing in feed_tags.display_name.
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

  function addAttachments(incoming: ComposerAttachment[]) {
    const allowedTypes = (kind: AttachmentKind) =>
      kind === "image"
        ? IMAGE_MIME_TYPES
        : kind === "video"
          ? VIDEO_MIME_TYPES
          : kind === "audio"
            ? AUDIO_MIME_TYPES
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

  async function pickAudio() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: AUDIO_MIME_TYPES,
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const now = Date.now();
      addAttachments(
        result.assets.map((asset, index) => ({
          id: `${now}-${index}-${asset.uri}`,
          kind: "audio" as const,
          uri: asset.uri,
          name: asset.name,
          mimeType: (
            asset.mimeType ?? mimeTypeFor(asset.name, "audio/mpeg")
          ).toLowerCase(),
          size: asset.size,
        })),
      );
    } catch {
      setError("Unable to open the file picker. Please try again.");
    }
  }

  function attachRecording(file: RecordedVoice) {
    setRecording(false);
    if (file.durationMs > MAX_AUDIO_MS) {
      setError("Voice messages are limited to 5 minutes.");
      return;
    }
    addAttachments([
      {
        id: `voice-${Date.now()}`,
        kind: "audio",
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        durationMs: file.durationMs,
      },
    ]);
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
          : attachment.kind === "audio"
            ? "FEED_AUDIO"
            : "DOCUMENT";
    const init = await apiClient.post<{ assetId: string; uploadUrl: string }>(
      "/api/v1/media/uploads",
      {
        purpose,
        mimeType: attachment.mimeType,
        declaredSizeBytes: file.size,
        durationMs: attachment.durationMs,
      },
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
        { declaredSizeBytes: file.size, durationMs: attachment.durationMs },
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
      return validatePollForm(poll);
    }
    if (!categoryId) return "Choose a category for your post.";
    if (mode === "help" && !helpTitle.trim()) return "Give your post a title.";
    if (mode !== "help" && !body.trim() && attachments.length === 0)
      return "Write something first.";
    if (mode === "help" && !body.trim()) return "Write something first.";
    return null;
  }

  const canPost =
    !submitting &&
    (mode === "poll"
      ? !!poll.question.trim()
      : mode === "help"
        ? !!helpTitle.trim() && !!body.trim()
        : !!body.trim());

  function publicationFingerprint() {
    return JSON.stringify({
      communityId,
      mode,
      categoryId,
      body: body.trim(),
      helpKind,
      helpTitle: helpTitle.trim(),
      helpExpiryDays,
      tags,
      attachments: attachments.map((a) => [
        a.id,
        a.uri,
        a.name,
        a.mimeType,
        a.size,
        a.durationMs,
      ]),
    });
  }

  async function handleSubmit() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    setError(null);
    const fingerprint = publicationFingerprint();
    const retrying = pendingPublication.current?.fingerprint === fingerprint;
    if (!retrying) pendingPublication.current = null;
    try {
      const actionKey =
        mode === "help" && helpKind === "REQUEST"
          ? ("EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH" as const)
          : mode === "general"
            ? ("EXTENDED_FEED_POST_PUBLISH" as const)
            : null;
      if (actionKey && !retrying) {
        const confirmed = await confirmCommunityAction(
          apiClient,
          session?.access,
          {
            actionKey,
            title: mode === "help" ? "Publish help request?" : "Publish post?",
            confirmLabel: "Publish",
          },
        );
        if (!confirmed) return;
      }
      if (mode === "poll") {
        await feedApi.createPoll(createPollRequest(poll, communityId));
      } else {
        let request: CreatePostRequest | CreateHelpPostRequest;
        const pending = retrying ? pendingPublication.current : null;
        if (pending) {
          request = pending.request;
        } else {
          const mediaIds: string[] = [];
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
          request =
            mode === "help"
              ? {
                  communityId,
                  categoryId: categoryId ?? undefined,
                  helpKind,
                  title: helpTitle.trim(),
                  body: body.trim(),
                  expiresAt:
                    helpExpiryDays === null
                      ? undefined
                      : new Date(
                          Date.now() + helpExpiryDays * 86_400_000,
                        ).toISOString(),
                  mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
                  tags: tags.length > 0 ? tags : undefined,
                  idempotencyKey: Crypto.randomUUID(),
                }
              : {
                  communityId,
                  postType:
                    mode === "announcement" ? "ANNOUNCEMENT" : "GENERAL",
                  body: body.trim(),
                  categoryId: categoryId ?? undefined,
                  mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
                  tags: tags.length > 0 ? tags : undefined,
                  idempotencyKey: Crypto.randomUUID(),
                };
          pendingPublication.current = { fingerprint, request };
        }
        setUploadProgress(null);
        try {
          if ("helpKind" in request) {
            await feedApi.createHelpPost(request);
          } else {
            await feedApi.createPost(request);
          }
          pendingPublication.current = null;
        } catch (postError) {
          // Retain the exact request after an ambiguous failure. A definite 4xx
          // starts a fresh attempt and can safely clean up the uploaded assets.
          if (
            ApiError.isApiError(postError) &&
            postError.httpStatus !== undefined &&
            postError.httpStatus >= 400 &&
            postError.httpStatus < 500
          ) {
            request.mediaIds?.forEach((id) => {
              apiClient
                .delete(`/api/v1/media/${id}`, { authenticated: true })
                .catch(() => {});
            });
            pendingPublication.current = null;
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
          <Pressable
            onPress={() => safeBack()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={[
              styles.cancelBtn,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              },
            ]}
          >
            <Ionicons name="close" size={15} color={theme.text} />
            <ThemedText style={styles.cancelBtnText}>Cancel</ThemedText>
          </Pressable>
          <View style={styles.navTitleWrap}>
            <ThemedText style={styles.navTitle}>
              {mode === "poll"
                ? "Create a Poll"
                : mode === "help"
                  ? "Community help"
                  : "New post"}
            </ThemedText>
            {mode === "poll" && (
              <ThemedText style={styles.navSubtitle} themeColor="textSecondary">
                Ask your community and hear what they think.
              </ThemedText>
            )}
            {mode === "help" && (
              <ThemedText style={styles.navSubtitle} themeColor="textSecondary">
                Ask for help or offer a hand.
              </ThemedText>
            )}
          </View>
          {mode === "poll" || mode === "help" ? (
            <View style={styles.postBtnSpacer} />
          ) : (
            <Pressable
              onPress={handleSubmit}
              accessibilityRole="button"
              accessibilityLabel="Publish post"
              disabled={!canPost}
              accessibilityState={{ disabled: !canPost, busy: submitting }}
              style={[
                styles.postBtn,
                {
                  backgroundColor: canPost ? BrandColors.primary : theme.border,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={BrandColors.white} />
              ) : (
                <ThemedText style={styles.postBtnText}>Post</ThemedText>
              )}
            </Pressable>
          )}
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
                {(["REQUEST", "OFFER"] as const).map((k) => {
                  const selected = helpKind === k;
                  return (
                    <Pressable
                      key={k}
                      onPress={() => setHelpKind(k)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        k === "REQUEST" ? "Request help" : "Offer help"
                      }
                      accessibilityState={{ selected }}
                      style={[
                        styles.helpKindBtn,
                        styles.flex,
                        {
                          borderColor: selected
                            ? BrandColors.primary
                            : theme.border,
                          backgroundColor: selected
                            ? BrandColors.primarySurface
                            : "transparent",
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          k === "REQUEST"
                            ? "help-circle-outline"
                            : "hand-left-outline"
                        }
                        size={16}
                        color={
                          selected ? BrandColors.primary : theme.textSecondary
                        }
                      />
                      <ThemedText
                        style={{
                          color: selected
                            ? BrandColors.primary
                            : theme.textSecondary,
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        {k === "REQUEST" ? "Request help" : "Offer help"}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Help title */}
            {mode === "help" && (
              <View style={styles.helpFieldWrap}>
                <ThemedText
                  style={styles.categoryLabel}
                  themeColor="textSecondary"
                >
                  Title{" "}
                  <ThemedText style={{ color: BrandColors.error }}>
                    *
                  </ThemedText>
                </ThemedText>
                <View
                  style={[styles.helpTitleRow, { borderColor: theme.border }]}
                >
                  <TextInput
                    style={[styles.helpTitleInput, { color: theme.text }]}
                    placeholder={
                      helpKind === "REQUEST"
                        ? "What do you need? e.g. Ride to the airport Saturday"
                        : "What are you offering? e.g. Spare winter coat"
                    }
                    placeholderTextColor={theme.textMuted}
                    value={helpTitle}
                    onChangeText={setHelpTitle}
                    maxLength={200}
                    autoFocus
                    returnKeyType="next"
                    accessibilityLabel="Help post title"
                  />
                </View>
              </View>
            )}

            {/* Poll form / text input */}
            {mode === "poll" ? (
              <PollForm
                value={poll}
                onChange={setPoll}
                categories={categories}
                loadingCategories={categoriesLoading}
                showCategory
                disabled={submitting}
              />
            ) : (
              <View>
                {mode === "help" && (
                  <ThemedText
                    style={[
                      styles.categoryLabel,
                      { marginBottom: Spacing.two },
                    ]}
                    themeColor="textSecondary"
                  >
                    Details{" "}
                    <ThemedText style={{ color: BrandColors.error }}>
                      *
                    </ThemedText>
                  </ThemedText>
                )}
                <TextInput
                  style={[
                    styles.textInput,
                    { color: theme.text },
                    mode === "help" && styles.helpBodyInput,
                  ]}
                  placeholder={
                    mode === "help"
                      ? helpKind === "REQUEST"
                        ? "Describe what you need — when, where, and anything people should know."
                        : "Describe what you can offer and how people can reach you."
                      : "What's happening in your community?"
                  }
                  placeholderTextColor={theme.textMuted}
                  value={body}
                  onChangeText={setBody}
                  multiline
                  autoFocus={mode !== "help"}
                  maxLength={4000}
                  accessibilityLabel={
                    mode === "help" ? "Help post details" : "Post text"
                  }
                />
                {body.length >= 3500 && (
                  <ThemedText
                    style={[
                      styles.charCount,
                      body.length >= 3950 && { color: BrandColors.error },
                    ]}
                    themeColor="textSecondary"
                  >
                    {body.length}/4000
                  </ThemedText>
                )}
              </View>
            )}

            {/* Voice / audio attachments — compact rows */}
            {supportsAttachments &&
              attachments
                .filter((a) => a.kind === "audio")
                .map((attachment) => {
                  const meta = [
                    attachment.durationMs
                      ? formatDuration(attachment.durationMs)
                      : null,
                    formatFileSize(attachment.size),
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <View
                      key={attachment.id}
                      style={[
                        styles.audioRow,
                        { backgroundColor: theme.backgroundElement },
                      ]}
                    >
                      <View
                        style={[
                          styles.audioIcon,
                          { backgroundColor: BrandColors.primarySurface },
                        ]}
                      >
                        <Ionicons
                          name="mic"
                          size={18}
                          color={BrandColors.primary}
                        />
                      </View>
                      <View style={styles.flex}>
                        <ThemedText
                          style={styles.attachmentName}
                          numberOfLines={1}
                        >
                          {attachment.name}
                        </ThemedText>
                        {meta ? (
                          <ThemedText
                            style={styles.attachmentSize}
                            themeColor="textSecondary"
                          >
                            {meta}
                          </ThemedText>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() =>
                          setAttachments((current) =>
                            current.filter((a) => a.id !== attachment.id),
                          )
                        }
                        disabled={submitting}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${attachment.name}`}
                      >
                        <Ionicons
                          name="close-circle"
                          size={22}
                          color={theme.textSecondary}
                        />
                      </Pressable>
                    </View>
                  );
                })}

            {/* Image / video / document previews */}
            {supportsAttachments &&
              attachments.some((a) => a.kind !== "audio") && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.attachmentList}
                >
                  {attachments
                    .filter((a) => a.kind !== "audio")
                    .map((attachment) => {
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
                            <Ionicons
                              name="close"
                              size={16}
                              color={theme.text}
                            />
                          </Pressable>
                        </View>
                      );
                    })}
                </ScrollView>
              )}

            {/* Voice recorder card */}
            {supportsAttachments && recording && (
              <VoiceRecorder
                visible={recording}
                disabled={submitting}
                onRecorded={attachRecording}
                onCancel={() => setRecording(false)}
                onError={setError}
              />
            )}

            {/* Help expiry — maps to expiresAt; backend lazy-expires past it */}
            {mode === "help" && (
              <View style={styles.helpFieldWrap}>
                <ThemedText
                  style={styles.categoryLabel}
                  themeColor="textSecondary"
                >
                  Active for
                </ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.categoryChips}
                >
                  {[
                    { label: "No expiry", days: null },
                    { label: "3 days", days: 3 },
                    { label: "7 days", days: 7 },
                    { label: "14 days", days: 14 },
                    { label: "30 days", days: 30 },
                  ].map((option) => {
                    const selected = helpExpiryDays === option.days;
                    return (
                      <Pressable
                        key={option.label}
                        onPress={() => setHelpExpiryDays(option.days)}
                        style={[
                          styles.helpKindBtn,
                          {
                            borderColor: selected
                              ? BrandColors.primary
                              : theme.border,
                            backgroundColor: selected
                              ? BrandColors.primarySurface
                              : "transparent",
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Expiry ${option.label}`}
                        accessibilityState={{ selected }}
                      >
                        <ThemedText
                          style={{
                            color: selected
                              ? BrandColors.primary
                              : theme.textSecondary,
                            fontSize: 13,
                            fontWeight: "600",
                          }}
                        >
                          {option.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Category picker — required for all post modes */}
            {mode !== "poll" && (
              <View style={styles.categoryWrap}>
                <ThemedText
                  style={styles.categoryLabel}
                  themeColor="textSecondary"
                >
                  Category{" "}
                  <ThemedText style={{ color: BrandColors.error }}>
                    *
                  </ThemedText>
                </ThemedText>
                {categoriesLoading ? (
                  <ActivityIndicator size="small" color={BrandColors.primary} />
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.categoryChips}
                  >
                    {categories.map((c) => (
                      <Pressable
                        key={c.id}
                        onPress={() => setCategoryId(c.id)}
                        style={[
                          styles.helpKindBtn,
                          {
                            borderColor:
                              categoryId === c.id
                                ? BrandColors.primary
                                : theme.border,
                            backgroundColor:
                              categoryId === c.id
                                ? BrandColors.primarySurface
                                : "transparent",
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Category ${c.name}`}
                        accessibilityState={{ selected: categoryId === c.id }}
                      >
                        <ThemedText
                          style={{
                            color:
                              categoryId === c.id
                                ? BrandColors.primary
                                : theme.textSecondary,
                            fontSize: 13,
                            fontWeight: "600",
                          }}
                        >
                          {c.name}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}

            {/* Hashtag entry + suggestions (all modes except poll) */}
            {mode !== "poll" && (
              <View style={styles.tagSection}>
                <ThemedText
                  style={styles.categoryLabel}
                  themeColor="textSecondary"
                >
                  Hashtags
                </ThemedText>
                <View
                  style={[styles.tagInputRow, { borderColor: theme.border }]}
                >
                  <ThemedText
                    style={styles.tagPrefix}
                    themeColor="textSecondary"
                  >
                    #
                  </ThemedText>
                  <TextInput
                    style={[styles.tagInputField, { color: theme.text }]}
                    placeholder="Add a hashtag"
                    placeholderTextColor={theme.textMuted}
                    value={tagInput}
                    onChangeText={(text) =>
                      setTagInput(text.replace(/^#+/, ""))
                    }
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
          {supportsAttachments && (
            <View
              style={[
                styles.attachmentToolbar,
                { borderTopColor: theme.border },
              ]}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                style={styles.flex}
                contentContainerStyle={styles.attachmentToolbarContent}
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
                    size={28}
                    color={BrandColors.primary}
                  />
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
                    size={28}
                    color={BrandColors.primary}
                  />
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
                    size={28}
                    color={BrandColors.primary}
                  />
                </Pressable>
                <Pressable
                  onPress={() => setRecording(true)}
                  disabled={
                    submitting ||
                    recording ||
                    attachments.length >= MAX_ATTACHMENTS
                  }
                  style={styles.attachmentAction}
                  accessibilityRole="button"
                  accessibilityLabel="Record voice message"
                >
                  <Ionicons
                    name="mic-outline"
                    size={28}
                    color={BrandColors.primary}
                  />
                </Pressable>
                <Pressable
                  onPress={pickAudio}
                  disabled={submitting || attachments.length >= MAX_ATTACHMENTS}
                  style={styles.attachmentAction}
                  accessibilityRole="button"
                  accessibilityLabel="Add audio file"
                >
                  <Ionicons
                    name="musical-notes-outline"
                    size={28}
                    color={BrandColors.primary}
                  />
                </Pressable>
              </ScrollView>
              <ThemedText
                style={[
                  styles.attachmentCount,
                  attachments.length >= MAX_ATTACHMENTS && {
                    color: BrandColors.error,
                  },
                ]}
                themeColor="textSecondary"
                accessibilityLabel={`${attachments.length} of ${MAX_ATTACHMENTS} attachments`}
              >
                {attachments.length}/{MAX_ATTACHMENTS}
              </ThemedText>
            </View>
          )}
          {(mode === "poll" || mode === "help") && (
            <View style={[styles.publishBar, { borderTopColor: theme.border }]}>
              <Pressable
                onPress={handleSubmit}
                accessibilityRole="button"
                accessibilityLabel={
                  mode === "poll"
                    ? "Publish poll"
                    : helpKind === "REQUEST"
                      ? "Publish help request"
                      : "Publish help offer"
                }
                disabled={!canPost}
                accessibilityState={{ disabled: !canPost, busy: submitting }}
                style={[
                  styles.publishBtn,
                  {
                    backgroundColor: canPost
                      ? BrandColors.primary
                      : theme.border,
                  },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={BrandColors.white} />
                ) : (
                  <ThemedText
                    style={[styles.postBtnText, !canPost && { opacity: 0.7 }]}
                  >
                    {mode === "poll"
                      ? "Publish Poll"
                      : helpKind === "REQUEST"
                        ? "Publish request"
                        : "Publish offer"}
                  </ThemedText>
                )}
              </Pressable>
            </View>
          )}
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
  navTitleWrap: {
    alignItems: "center",
    flex: 1,
    paddingHorizontal: Spacing.two,
  },
  navTitle: { fontSize: 15, fontWeight: "600" },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  cancelBtnText: { fontSize: 13, fontWeight: "600" },
  navSubtitle: { fontSize: 11, marginTop: 1 },
  postBtnSpacer: { width: 84 },
  postBtn: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 6 },
  postBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  publishBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  publishBtn: {
    borderRadius: BorderRadius.full,
    alignItems: "center",
    paddingVertical: Spacing.three,
  },
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
  helpFieldWrap: { gap: 6 },
  helpTitleRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
  },
  helpTitleInput: { fontSize: 15, fontWeight: "600", paddingVertical: 10 },
  helpBodyInput: { minHeight: 140 },
  categoryWrap: { gap: 6 },
  categoryLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  categoryChips: { flexDirection: "row", gap: Spacing.two },
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
  helpKindBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
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
    alignItems: "center",
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  attachmentToolbarContent: { gap: Spacing.four, alignItems: "center" },
  attachmentCount: { fontSize: 12, fontVariant: ["tabular-nums"] },
  charCount: { fontSize: 11, textAlign: "right", marginTop: 2 },
  audioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  audioIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
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
