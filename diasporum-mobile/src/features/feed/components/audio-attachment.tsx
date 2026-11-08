/**
 * AudioAttachment — inline player for FEED_AUDIO post attachments.
 * Resolves a parent-authorized signed URL (feed media endpoint), then plays
 * via expo-audio. Only one attachment plays at a time; no autoplay.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius } from "@/shared/theme/spacing";
import { getFeedMediaUrl, refreshFeedMediaUrl } from "../utils/media-cache";

/** Playback coordinator — pauses whichever attachment was playing. */
let activePlayer: { pause(): void } | null = null;
function claim(player: { pause(): void }) {
  if (activePlayer && activePlayer !== player) {
    try {
      activePlayer.pause();
    } catch {
      /* stale player */
    }
  }
  activePlayer = player;
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Props {
  mediaId: string;
  /** Declared duration from the post payload — shown before metadata loads. */
  durationMs?: number | null;
}

export function AudioAttachment({ mediaId, durationMs }: Props) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const barWidth = useRef(0);

  useEffect(() => {
    let cancelled = false;
    getFeedMediaUrl(apiClient, mediaId)
      .then((u) => {
        if (!cancelled) {
          setFailed(false);
          setUri(u);
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [apiClient, mediaId]);

  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const toggle = useCallback(() => {
    if (!status.isLoaded) return;
    if (status.playing) {
      player.pause();
      return;
    }
    claim(player);
    if (status.didJustFinish) player.seekTo(0);
    player.play();
  }, [player, status.isLoaded, status.playing, status.didJustFinish]);

  const seek = useCallback(
    (x: number) => {
      if (!status.isLoaded || !status.duration || barWidth.current <= 0) return;
      claim(player);
      player.seekTo(
        Math.min(status.duration, Math.max(0, (x / barWidth.current) * status.duration)),
      );
    },
    [player, status.isLoaded, status.duration],
  );

  useEffect(() => {
    if (status.didJustFinish && activePlayer === player) {
      player.seekTo(0);
    }
  }, [player, status.didJustFinish]);

  if (failed) {
    return (
      <Pressable
        onPress={() =>
          refreshFeedMediaUrl(apiClient, mediaId)
            .then(setUri)
            .catch(() => {})
        }
        style={[styles.card, { backgroundColor: theme.backgroundElement }]}
        accessibilityRole="button"
        accessibilityLabel="Audio unavailable — tap to retry"
      >
        <Ionicons name="alert-circle-outline" size={22} color={theme.error} />
        <ThemedText style={styles.err} themeColor="textSecondary">
          Audio unavailable — tap to retry
        </ThemedText>
      </Pressable>
    );
  }

  const duration = status.duration || (durationMs ?? 0) / 1000;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement }]}
      accessibilityLabel={`Voice message, ${fmt(duration)}`}
    >
      <Pressable
        onPress={toggle}
        disabled={!status.isLoaded}
        style={[styles.btn, { backgroundColor: BrandColors.primary }]}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "Pause voice message" : "Play voice message"}
      >
        {!status.isLoaded || status.isBuffering ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Ionicons
            name={status.playing ? "pause" : "play"}
            size={20}
            color="#FFFFFF"
          />
        )}
      </Pressable>
      <View style={styles.trackWrap}>
        <Pressable
          style={styles.trackHit}
          onLayout={(e) => {
            barWidth.current = e.nativeEvent.layout.width;
          }}
          onPress={(e) => seek(e.nativeEvent.locationX)}
          accessibilityRole="adjustable"
          accessibilityLabel="Seek voice message"
        >
          <View style={[styles.track, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: BrandColors.primary, width: `${progress * 100}%` },
              ]}
            />
          </View>
        </Pressable>
        <View style={styles.times}>
          <ThemedText style={styles.time} themeColor="textSecondary">
            {fmt(status.currentTime)}
          </ThemedText>
          <ThemedText style={styles.time} themeColor="textSecondary">
            {fmt(duration)}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: BorderRadius.md,
    padding: 10,
    marginTop: 10,
    maxWidth: 320,
  },
  btn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  trackWrap: { flex: 1, justifyContent: "center", gap: 4 },
  trackHit: { paddingVertical: 8 },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  times: { flexDirection: "row", justifyContent: "space-between" },
  time: { fontSize: 11 },
  err: { fontSize: 13 },
});
