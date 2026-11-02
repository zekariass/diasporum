import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ImageStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { createPropertyApi } from "../services/property-api";

interface Props {
  propertyId: string;
  mediaId: string | null;
  style?: StyleProp<ImageStyle>;
  label?: string;
}

export function PropertyImage({
  propertyId,
  mediaId,
  style,
  label = "Property image",
}: Props) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(mediaId));
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  const load = useCallback(() => {
    if (!mediaId) return Promise.resolve();
    return createPropertyApi(apiClient)
      .mediaUrl(propertyId, mediaId)
      .then((result) => {
        setUri(result.downloadUrl);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [apiClient, mediaId, propertyId]);

  useEffect(() => {
    let active = true;
    if (!mediaId) return () => {};
    void createPropertyApi(apiClient)
      .mediaUrl(propertyId, mediaId)
      .then((result) => {
        if (active) setUri(result.downloadUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiClient, mediaId, propertyId]);

  const retryExpiredUrl = useCallback(() => {
    if (retried) {
      setFailed(true);
      return;
    }
    setRetried(true);
    setLoading(true);
    void load();
  }, [load, retried]);

  if (!mediaId || failed) {
    return (
      <View
        style={[styles.placeholder, style, { backgroundColor: theme.backgroundElement }]}
        accessibilityLabel="No property image"
      >
        <Ionicons name="home-outline" size={28} color={theme.textSecondary} />
      </View>
    );
  }
  if (loading || !uri) {
    return (
      <View
        style={[styles.placeholder, style, { backgroundColor: theme.backgroundElement }]}
        accessibilityLabel="Loading property image"
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
      onError={retryExpiredUrl}
    />
  );
}

const styles = StyleSheet.create({
  image: { width: "100%", height: 190 },
  placeholder: {
    width: "100%",
    height: 190,
    alignItems: "center",
    justifyContent: "center",
  },
});
