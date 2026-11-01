/**
 * Avatar — circular profile picture. Renders the real avatar when a mediaId
 * exists, otherwise a neutral initial-letter disc (Threads-style grey).
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { MediaImage } from "./media-image";

interface Props {
  name?: string | null;
  mediaId?: string | null;
  size?: number;
}

export function Avatar({ name, mediaId, size = 40 }: Props) {
  const theme = useTheme();
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (mediaId) {
    return (
      <View style={[shape, styles.clip]}>
        <MediaImage mediaId={mediaId} style={{ ...shape, aspectRatio: 1 }} />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        shape,
        { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <ThemedText
        style={[styles.initial, { fontSize: size * 0.42 }]}
        themeColor="textSecondary"
      >
        {(name?.trim()[0] ?? "?").toUpperCase()}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  fallback: { alignItems: "center", justifyContent: "center" },
  initial: { fontWeight: "700" },
});
