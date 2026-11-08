import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { ThemedText } from "@/components/themed-text";
import { PhotoViewerModal } from "@/shared/components/photo-viewer-modal";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { PropertyApi } from "../services/property-api";
import type { PropertyMedia } from "../types/property-types";
import { PropertyImage } from "./property-image";

export function PropertyGallery({
  propertyId,
  media,
  api,
}: {
  propertyId: string;
  media: PropertyMedia[];
  api: PropertyApi;
}) {
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const [index, setIndex] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);
  const ordered = useMemo(
    () => [...media].sort((a, b) => a.sortOrder - b.sortOrder),
    [media],
  );
  const resolve = useCallback(
    (id: string) =>
      api.mediaUrl(propertyId, id).then((result) => result.downloadUrl),
    [api, propertyId],
  );
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {ordered.length ? (
        <>
          <FlatList
            key={`${propertyId}:${width}`}
            data={ordered}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.mediaId}
            initialScrollIndex={Math.min(index, ordered.length - 1)}
            getItemLayout={(_, i) => ({
              length: width,
              offset: width * i,
              index: i,
            })}
            onMomentumScrollEnd={(event) =>
              setIndex(
                Math.max(
                  0,
                  Math.min(
                    ordered.length - 1,
                    Math.round(event.nativeEvent.contentOffset.x / width),
                  ),
                ),
              )
            }
            renderItem={({ item, index: photoIndex }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open property photo ${photoIndex + 1} full screen`}
                onPress={() => setViewer(photoIndex)}
                style={{ width }}
              >
                <PropertyImage
                  propertyId={propertyId}
                  mediaId={item.mediaId}
                  style={{ height: Math.min(width * 0.65, 400) }}
                  label={`Property photo ${photoIndex + 1}`}
                />
              </Pressable>
            )}
          />
          <View pointerEvents="none" style={styles.counter}>
            <ThemedText style={styles.counterText}>
              {Math.min(index + 1, ordered.length)} / {ordered.length}
            </ThemedText>
          </View>
          <PhotoViewerModal
            visible={viewer !== null}
            initialIndex={viewer ?? 0}
            mediaIds={ordered.map((item) => item.mediaId)}
            resolve={resolve}
            refresh={resolve}
            onClose={() => setViewer(null)}
          />
        </>
      ) : (
        <PropertyImage
          propertyId={propertyId}
          mediaId={null}
          style={{ height: width * 0.6 }}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  counter: {
    position: "absolute",
    bottom: Spacing.two,
    right: Spacing.three,
    backgroundColor: BrandColors.black,
    opacity: 0.8,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  counterText: { color: BrandColors.white, fontSize: 13, fontWeight: "600" },
});
