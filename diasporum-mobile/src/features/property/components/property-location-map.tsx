import React, { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius } from "@/shared/theme/spacing";
import type { PublicLocation } from "../types/property-types";

/** Only the server-approved discovery point may reach this component. */
export function PropertyLocationMap({
  location,
}: {
  location: PublicLocation | null;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(320);
  const [failed, setFailed] = useState(false);
  const [linkError, setLinkError] = useState(false);
  if (location?.latitude == null || location.longitude == null) return null;
  const lat = location.latitude;
  const lng = location.longitude;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 85 ||
    Math.abs(lng) > 180
  )
    return null;
  const zoom = 12;
  const size = 2 ** zoom;
  const x = ((lng + 180) / 360) * size;
  const y =
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * size;
  const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
  return (
    <View>
      <Pressable
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessibilityRole="link"
        accessibilityLabel="Open approximate property location in OpenStreetMap"
        onPress={() => {
          void Linking.openURL(url).catch(() => setLinkError(true));
        }}
        style={[styles.map, { backgroundColor: theme.backgroundElement }]}
      >
        {!failed ? (
          [-1, 0, 1].flatMap((dx) =>
            [-1, 0, 1].map((dy) => {
              const tx = Math.floor(x) + dx;
              const ty = Math.floor(y) + dy;
              return (
                <Image
                  key={`${tx}:${ty}`}
                  accessibilityElementsHidden
                  source={{
                    uri: `https://tile.openstreetmap.org/${zoom}/${(tx + size) % size}/${ty}.png`,
                    headers: {
                      "User-Agent": "Diasporum/1.0 (property location preview)",
                    },
                  }}
                  onError={() => setFailed(true)}
                  style={{
                    position: "absolute",
                    width: 256,
                    height: 256,
                    left: width / 2 + (tx - x) * 256,
                    top: 70 + (ty - y) * 256,
                  }}
                />
              );
            }),
          )
        ) : (
          <ThemedText type="small">
            Map preview unavailable · Open map
          </ThemedText>
        )}
        {!failed ? (
          <View
            style={[
              styles.area,
              {
                backgroundColor: theme.primarySurface,
                borderColor: theme.primary,
              },
            ]}
          >
            <Ionicons name="location" size={27} color={theme.primary} />
          </View>
        ) : null}
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary">
        Approximate area · © OpenStreetMap contributors
      </ThemedText>
      {linkError ? (
        <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>
          Could not open the map.
        </ThemedText>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  map: {
    height: 140,
    overflow: "hidden",
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  area: {
    width: 66,
    height: 66,
    borderRadius: 33,
    opacity: 0.8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
