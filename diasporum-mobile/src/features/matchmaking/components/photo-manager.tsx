import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type {
  MatchmakingPhotoList,
  MatchmakingProfilePhoto,
} from "../types/matchmaking-types";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { pickAndUploadMatchmakingPhotos } from "../services/matchmaking-media-api";
import { matchmakingError } from "../services/matchmaking-errors";
import { useSession } from "@/core/session/session-provider";

/**
 * Shared gallery manager used by onboarding and profile editing — photo
 * slots up to the backend-configured maximum, primary badge, accessible
 * reorder controls, remove and add. Every mutation goes through the
 * /profile/photos API; the returned list replaces local state so the server
 * stays the single source of truth (primary promotion included).
 */
export function MatchmakingPhotoManager({
  photos,
  maxPhotos,
  onChange,
  onError,
  disabled,
}: {
  photos: MatchmakingProfilePhoto[];
  maxPhotos: number;
  onChange: (list: MatchmakingPhotoList) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const { apiClient } = useSession();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (cause: unknown, fallback: string) => {
    const message = matchmakingError(cause, fallback);
    setError(message);
    onError?.(message);
  };

  const run = async (operation: () => Promise<MatchmakingPhotoList>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await operation());
    } catch (cause) {
      fail(cause, "The photos could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    setUploading(true);
    void run(async () => {
      const remaining = Math.max(0, maxPhotos - photos.length);
      const uploaded = await pickAndUploadMatchmakingPhotos(apiClient, remaining);
      if (!uploaded.length) return { photos, maxPhotos };
      let list: MatchmakingPhotoList | null = null;
      for (const item of uploaded) {
        list = await api.addPhoto(item.assetId);
      }
      return list ?? { photos, maxPhotos };
    }).finally(() => setUploading(false));
  };

  const remove = (photo: MatchmakingProfilePhoto) => {
    Alert.alert(
      photo.isPrimary ? "Remove primary photo?" : "Remove photo?",
      photo.isPrimary
        ? "The next photo in your gallery becomes your primary photo."
        : "This photo will be removed from your profile.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void run(() => api.deletePhoto(photo.id)),
        },
      ],
    );
  };

  const move = (photo: MatchmakingProfilePhoto, delta: -1 | 1) => {
    const index = photos.findIndex((item) => item.id === photo.id);
    const swap = index + delta;
    if (index < 0 || swap < 0 || swap >= photos.length) return;
    const ids = photos.map((item) => item.id);
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
    void run(() => api.reorderPhotos(ids));
  };

  const COLUMNS = 3;
  const slots: (MatchmakingProfilePhoto | null)[] = [...photos];
  while (slots.length < maxPhotos) slots.push(null);
  const rows: (MatchmakingProfilePhoto | null)[][] = [];
  for (let i = 0; i < slots.length; i += COLUMNS) {
    rows.push(slots.slice(i, i + COLUMNS));
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary">
          {photos.length} of {maxPhotos} photos added
        </ThemedText>
      </View>
      <View style={styles.grid}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((photo, index) => {
              const globalIndex = rowIndex * COLUMNS + index;
              return photo ? (
                <View
                  key={photo.id}
                  style={[
                    styles.cell,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.backgroundElement,
                    },
                  ]}
                >
                  {photo.url ? (
                    <Image
                      source={{ uri: photo.url }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      accessibilityLabel={`Profile photo ${globalIndex + 1}`}
                    />
                  ) : (
                    <View
                      style={[
                        StyleSheet.absoluteFill,
                        styles.thumbPending,
                      ]}
                    >
                      <Ionicons
                        name="hourglass"
                        size={22}
                        color={theme.textSecondary}
                      />
                    </View>
                  )}
                  {photo.isPrimary ? (
                    <View
                      style={[
                        styles.primaryBadge,
                        { backgroundColor: theme.primary },
                      ]}
                    >
                      <ThemedText style={styles.primaryBadgeText}>
                        Primary
                      </ThemedText>
                    </View>
                  ) : null}
                  <View style={styles.cellActions}>
                    <IconAction
                      icon={photo.isPrimary ? "star" : "star-outline"}
                      label={photo.isPrimary ? "Primary photo" : "Make primary"}
                      disabled={disabled || busy || photo.isPrimary}
                      color="#fff"
                      onPress={() =>
                        void run(() => api.setPrimaryPhoto(photo.id))
                      }
                    />
                    <IconAction
                      icon="chevron-back"
                      label="Move photo earlier"
                      disabled={disabled || busy || globalIndex === 0}
                      color="#fff"
                      onPress={() => move(photo, -1)}
                    />
                    <IconAction
                      icon="chevron-forward"
                      label="Move photo later"
                      disabled={
                        disabled || busy || globalIndex === photos.length - 1
                      }
                      color="#fff"
                      onPress={() => move(photo, 1)}
                    />
                    <IconAction
                      icon="trash-outline"
                      label="Remove photo"
                      disabled={disabled || busy}
                      color="#fff"
                      onPress={() => remove(photo)}
                    />
                  </View>
                </View>
              ) : (
                <Pressable
                  key={`empty-${globalIndex}`}
                  accessibilityRole="button"
                  accessibilityLabel={
                    uploading && globalIndex === photos.length
                      ? "Uploading photo"
                      : globalIndex === 0 && photos.length === 0
                        ? "Add primary photo"
                        : `Add photo ${globalIndex + 1}`
                  }
                  disabled={disabled || busy}
                  onPress={add}
                  style={[
                    styles.cell,
                    styles.addCell,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.backgroundElement,
                    },
                  ]}
                >
                  {uploading && globalIndex === photos.length ? (
                    <>
                      <ActivityIndicator size="small" color={theme.primary} />
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        style={styles.uploadingText}
                      >
                        Uploading…
                      </ThemedText>
                    </>
                  ) : (
                    <Ionicons
                      name={busy ? "hourglass" : "add"}
                      size={26}
                      color={theme.primary}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Your primary photo appears in discovery cards and to members you like.
      </ThemedText>
      {error ? (
        <ThemedText
          themeColor="error"
          style={styles.error}
          accessibilityRole="alert"
        >
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

function IconAction({
  icon,
  label,
  disabled,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      <Ionicons name={icon} size={16} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.two },
  header: { flexDirection: "row", justifyContent: "flex-end" },
  grid: { gap: Spacing.two },
  row: { flexDirection: "row", gap: Spacing.two },
  cell: {
    flex: 1,
    aspectRatio: 0.75,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  addCell: {
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  uploadingText: { fontSize: 11 },
  thumbPending: { alignItems: "center", justifyContent: "center" },
  primaryBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  primaryBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  cellActions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  action: { padding: 4 },
  actionPressed: { opacity: 0.5 },
  error: { fontSize: 13 },
});
