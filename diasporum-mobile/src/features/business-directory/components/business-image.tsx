import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { createDirectoryApi } from "../services/directory-api";

interface Props {
  businessId: string;
  mediaId: string | null;
  style?: StyleProp<ImageStyle>;
  label?: string;
}

/** Public-safe image loading: the directory endpoint authorizes the parent profile. */
export function BusinessImage({
  businessId,
  mediaId,
  style,
  label = "Business image",
}: Props) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(mediaId));
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!mediaId) return;
    createDirectoryApi(apiClient)
      .mediaUrl(businessId, mediaId)
      .then((result) => {
        if (!cancelled) {
          setUri(result.downloadUrl);
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
  }, [apiClient, businessId, mediaId]);

  const retry = useCallback(() => {
    if (!mediaId) return;
    if (retried) {
      setFailed(true);
      return;
    }
    setRetried(true);
    setLoading(true);
    createDirectoryApi(apiClient)
      .mediaUrl(businessId, mediaId)
      .then((result) => {
        setUri(result.downloadUrl);
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, [apiClient, businessId, mediaId, retried]);

  if (!mediaId || failed) {
    return (
      <View
        style={[
          styles.placeholder,
          style,
          { backgroundColor: theme.backgroundElement },
        ]}
        accessibilityLabel={`No ${label.toLowerCase()}`}
      >
        <Ionicons
          name="storefront-outline"
          size={28}
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
        accessibilityLabel={`Loading ${label.toLowerCase()}`}
      >
        <ActivityIndicator color={BrandColors.primary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={[styles.image, style]}
      resizeMode="cover"
      accessibilityLabel={label}
      onError={retry}
    />
  );
}

const styles = StyleSheet.create({
  image: { width: "100%", height: "100%" },
  placeholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
});
