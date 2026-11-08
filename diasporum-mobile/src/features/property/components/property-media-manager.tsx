import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createPropertyApi } from "../services/property-api";
import type { PropertyDetail } from "../types/property-types";
import { PropertyImage } from "./property-image";

export function PropertyMediaManager({
  detail,
  onChange,
}: {
  detail: PropertyDetail;
  onChange: (detail: PropertyDetail) => void;
}) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const propertyId = detail.item.property.id;
  const media = [...detail.media].sort((a, b) => a.sortOrder - b.sortOrder);

  async function run(action: () => Promise<PropertyDetail>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not update property photos.",
      );
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= media.length) return;
    const ids = media.map((item) => item.mediaId);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const cover = media.find((item) => item.cover)?.mediaId ?? ids[0];
    void run(() => api.reorderMedia(propertyId, ids, cover));
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <ThemedText style={styles.title}>Uploaded photos</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Reorder your gallery or choose a different cover.
          </ThemedText>
        </View>
        <View style={[styles.count, { backgroundColor: theme.primarySurface }]}>
          <ThemedText style={[styles.countText, { color: theme.primary }]}>
            {media.length}/12
          </ThemedText>
        </View>
      </View>
      {media.map((item, index) => (
        <View
          key={item.mediaId}
          style={[
            styles.row,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
        >
          <PropertyImage
            propertyId={propertyId}
            mediaId={item.mediaId}
            style={styles.image}
            label={`Property photo ${index + 1}`}
          />
          <View style={styles.controls}>
            <View style={styles.captionRow}>
              <ThemedText style={styles.caption}>
                {item.cover ? "Cover photo" : `Photo ${index + 1}`}
              </ThemedText>
              {item.cover ? (
                <Ionicons name="star" size={15} color={theme.primary} />
              ) : null}
            </View>
            <View style={styles.buttons}>
              <MediaButton
                label={`Move photo ${index + 1} earlier`}
                text="Earlier"
                icon="arrow-back"
                disabled={busy || index === 0}
                onPress={() => move(index, -1)}
              />
              <MediaButton
                label={`Move photo ${index + 1} later`}
                text="Later"
                icon="arrow-forward"
                disabled={busy || index === media.length - 1}
                onPress={() => move(index, 1)}
              />
              {!item.cover ? (
                <MediaButton
                  label={`Make photo ${index + 1} cover`}
                  text="Make cover"
                  icon="star-outline"
                  disabled={busy}
                  onPress={() =>
                    void run(() =>
                      api.reorderMedia(
                        propertyId,
                        media.map((entry) => entry.mediaId),
                        item.mediaId,
                      ),
                    )
                  }
                />
              ) : null}
              <MediaButton
                label={`Remove photo ${index + 1}`}
                text="Remove"
                icon="trash-outline"
                disabled={busy}
                danger
                onPress={() =>
                  void run(() => api.removeMedia(propertyId, item.mediaId))
                }
              />
            </View>
          </View>
        </View>
      ))}
      {error ? (
        <View
          style={[styles.errorBanner, { backgroundColor: theme.errorSurface }]}
          accessibilityRole="alert"
        >
          <Ionicons name="alert-circle" size={18} color={theme.error} />
          <ThemedText style={[styles.error, { color: theme.error }]}>
            {error}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function MediaButton({
  label,
  text,
  icon,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  text: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  const theme = useTheme();
  const color = danger ? theme.error : theme.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: danger
            ? theme.errorSurface
            : theme.backgroundElement,
          borderColor: danger ? theme.error : theme.border,
        },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons name={icon} size={14} color={color} />
      <ThemedText style={[styles.buttonText, { color }]}>{text}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
  },
  headerCopy: { flex: 1, gap: Spacing.one },
  title: { fontSize: 17, lineHeight: 23, fontWeight: "800" },
  subtitle: { fontSize: 12, lineHeight: 17 },
  count: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  countText: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  row: {
    flexDirection: "row",
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  image: { width: 96, height: 112, borderRadius: BorderRadius.md },
  controls: { flex: 1, minWidth: 0, gap: Spacing.three },
  captionRow: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
  caption: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  button: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  buttonText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
  error: { flex: 1, fontSize: 13, lineHeight: 19 },
});
