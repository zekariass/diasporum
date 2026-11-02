/**
 * EventCover — renders the event cover via GET /events/{id}/cover/download-url.
 * Unlike MediaImage (owner-only media URL), this endpoint performs the event
 * visibility check server-side so any permitted viewer can load the cover.
 * Retries once when the signed URL expires mid-display.
 */

import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useSession } from "@/core/session/session-provider";
import { BrandColors } from "@/shared/theme/colors";
import { useTheme } from "@/hooks/use-theme";
import { createEventApi } from "../services/event-api";

interface Props {
  eventId: string;
  /** Only fetches when the event actually has a cover. */
  coverMediaId: string | null;
  style?: object;
}

export function EventCover({ eventId, coverMediaId, style }: Props) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // No synchronous resets here: the render guards below handle the
    // no-cover case, and `loading || !uri` covers the pre-fetch state.
    if (!coverMediaId) return;
    const eventApi = createEventApi(apiClient);
    eventApi
      .coverDownloadUrl(eventId)
      .then((r) => {
        if (!cancelled) {
          setUri(r.downloadUrl);
          setFailed(false);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, eventId, coverMediaId]);

  const handleError = useCallback(() => {
    if (retried) {
      setFailed(true);
      return;
    }
    setRetried(true);
    setLoading(true);
    createEventApi(apiClient)
      .coverDownloadUrl(eventId)
      .then((r) => {
        setUri(r.downloadUrl);
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, [retried, apiClient, eventId]);

  if (!coverMediaId || failed) {
    return (
      <View
        style={[
          styles.placeholder,
          style,
          { backgroundColor: theme.backgroundElement },
        ]}
        accessibilityLabel="No event cover"
      >
        <Ionicons
          name="calendar-outline"
          size={26}
          color={theme.textSecondary}
        />
      </View>
    );
  }
  if (loading || !uri) {
    return (
      <View
        style={[
          styles.placeholder,
          style,
          { backgroundColor: theme.backgroundElement },
        ]}
        accessibilityLabel="Loading event cover"
      >
        <ActivityIndicator size="small" color={BrandColors.primary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={[styles.image, style]}
      resizeMode="cover"
      accessibilityLabel="Event cover"
      onError={handleError}
    />
  );
}

const styles = StyleSheet.create({
  image: { width: "100%", aspectRatio: 16 / 9, borderRadius: 10 },
  placeholder: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
