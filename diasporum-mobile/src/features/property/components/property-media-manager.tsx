import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createPropertyApi } from "../services/property-api";
import type { PropertyDetail } from "../types/property-types";
import { PropertyImage } from "./property-image";

export function PropertyMediaManager({ detail, onChange }: { detail: PropertyDetail; onChange: (detail: PropertyDetail) => void }) {
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
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not update property photos.");
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
      <ThemedText style={styles.title}>Manage uploaded photos</ThemedText>
      {media.map((item, index) => (
        <View key={item.mediaId} style={styles.row}>
          <PropertyImage propertyId={propertyId} mediaId={item.mediaId} style={styles.image} label={`Property photo ${index + 1}`} />
          <View style={styles.controls}>
            <ThemedText style={styles.caption}>{item.cover ? "Cover" : `Photo ${index + 1}`}</ThemedText>
            <View style={styles.buttons}>
              <MediaButton label={`Move photo ${index + 1} earlier`} text="Earlier" disabled={busy || index === 0} onPress={() => move(index, -1)} />
              <MediaButton label={`Move photo ${index + 1} later`} text="Later" disabled={busy || index === media.length - 1} onPress={() => move(index, 1)} />
              {!item.cover ? <MediaButton label={`Make photo ${index + 1} cover`} text="Make cover" disabled={busy} onPress={() => void run(() => api.reorderMedia(propertyId, media.map((entry) => entry.mediaId), item.mediaId))} /> : null}
              <MediaButton label={`Remove photo ${index + 1}`} text="Remove" disabled={busy} danger onPress={() => void run(() => api.removeMedia(propertyId, item.mediaId))} />
            </View>
          </View>
        </View>
      ))}
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
    </View>
  );
}

function MediaButton({ label, text, onPress, disabled, danger }: { label: string; text: string; onPress: () => void; disabled: boolean; danger?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={[styles.button, disabled && { opacity: 0.45 }]}><ThemedText style={[styles.buttonText, danger && { color: BrandColors.error }]}>{text}</ThemedText></Pressable>;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  title: { fontSize: 17, fontWeight: "800" },
  row: { flexDirection: "row", gap: Spacing.two },
  image: { width: 100, height: 100, borderRadius: BorderRadius.md },
  controls: { flex: 1, gap: Spacing.two },
  caption: { fontSize: 13, fontWeight: "700" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  button: { paddingHorizontal: 7, paddingVertical: 5 },
  buttonText: { color: BrandColors.primary, fontSize: 12, fontWeight: "700" },
  error: { color: BrandColors.error, fontSize: 13 },
});
