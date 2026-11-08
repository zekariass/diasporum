/**
 * MediaImage — resolves a mediaId via POST /media/{id}/download-url,
 * renders <Image> with expiry-aware caching. Never constructs URLs manually.
 * On load failure (expired signed URL → 403), refreshes the URL once and retries.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
  type ImageLoadEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "@/core/session/session-provider";
import { BrandColors } from "@/shared/theme/colors";
import { useTheme } from "@/hooks/use-theme";
import {
  getAvatarUrl,
  getFeedMediaUrl,
  getMediaUrl,
  peekAvatarUrl,
  peekFeedMediaUrl,
  peekMediaUrl,
  refreshAvatarUrl,
  refreshFeedMediaUrl,
  refreshMediaUrl,
} from "../utils/media-cache";
export { clearMediaCache } from "../utils/media-cache";

interface Props {
  mediaId: string;
  style?: object;
  /** Resolve via the parent-authorized feed endpoint (media on posts). */
  feed?: boolean;
  /** Resolve via the block-checked avatar endpoint for this user's photo. */
  userId?: string;
  /** Fires once the bitmap loads — lets callers size the frame to the real aspect ratio. */
  onDimensions?: (width: number, height: number) => void;
}

export function MediaImage({ mediaId, style, feed, userId, onDimensions }: Props) {
  const theme = useTheme();
  const { apiClient } = useSession();
  // Warm-cache init — skips the placeholder frame entirely when the signed
  // URL was already resolved (e.g. same image shown on the feed screen).
  const [uri, setUri] = useState<string | null>(() =>
    userId ? peekAvatarUrl(userId) : feed ? peekFeedMediaUrl(mediaId) : peekMediaUrl(mediaId));
  const [loading, setLoading] = useState(uri == null);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const resolve = userId
      ? () => getAvatarUrl(apiClient, userId)
      : () => (feed ? getFeedMediaUrl : getMediaUrl)(apiClient, mediaId);
    resolve()
      .then((u) => {
        if (!cancelled) {
          setUri(u);
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
  }, [apiClient, mediaId, feed, userId]);

  // Retry once with fresh URL on image load failure (expired signed URL → 403)
  const handleError = useCallback(() => {
    if (retried) {
      setFailed(true);
      return;
    }
    setRetried(true);
    setLoading(true);
    const refresh = userId
      ? () => refreshAvatarUrl(apiClient, userId)
      : () => (feed ? refreshFeedMediaUrl : refreshMediaUrl)(apiClient, mediaId);
    refresh()
      .then((u) => {
        setUri(u);
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, [retried, apiClient, mediaId, feed, userId]);

  const handleLoad = useCallback(
    (e: ImageLoadEvent) => {
      const { width, height } = e.nativeEvent.source;
      if (width > 0 && height > 0) onDimensions?.(width, height);
    },
    [onDimensions],
  );

  if (failed) {
    return (
      <View
        style={[
          styles.placeholder,
          style,
          { backgroundColor: theme.backgroundElement },
        ]}
      >
        <Ionicons name="image-outline" size={28} color={theme.textSecondary} />
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
      accessibilityLabel="Post image"
      onError={handleError}
      onLoad={handleLoad}
    />
  );
}

const styles = StyleSheet.create({
  image: { borderRadius: 10, width: "100%", aspectRatio: 4 / 3 },
  placeholder: {
    borderRadius: 10,
    width: "100%",
    aspectRatio: 4 / 3,
    alignItems: "center",
    justifyContent: "center",
  },
});
