/**
 * Two-column browse feed over the same queue as SwipeDeck. Compact cards show
 * only photo, name, age and address — details and actions live on the profile
 * screen. The first visible profile is reported to the decision bar below.
 */

import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import type { PublicMatchmakingProfile } from "../types/matchmaking-types";

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 55 };
type ViewableItemsChanged = NonNullable<
  React.ComponentProps<
    typeof FlatList<PublicMatchmakingProfile>
  >["onViewableItemsChanged"]
>;

function BrowseProfileCard({ profile }: { profile: PublicMatchmakingProfile }) {
  const theme = useTheme();
  const [failedPhoto, setFailedPhoto] = React.useState<string | null>(null);
  const open = () =>
    router.push(`/(app)/matchmaking/profile/${profile.userId}` as never);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`View ${profile.displayName}'s profile`}
        style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}
      >
        {profile.photoUrl && failedPhoto !== profile.photoUrl ? (
          <Image
            source={{ uri: profile.photoUrl }}
            style={styles.photo}
            contentFit="cover"
            transition={180}
            cachePolicy="memory-disk"
            onError={() => setFailedPhoto(profile.photoUrl)}
            accessibilityLabel={`${profile.displayName} profile photo`}
          />
        ) : (
          <View
            style={[
              styles.photo,
              styles.photoFallback,
              { backgroundColor: theme.primarySurface },
            ]}
            accessibilityLabel={`${profile.displayName} photo hidden`}
          >
            <View
              style={[
                styles.fallbackIcon,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <Ionicons name="person" size={38} color={theme.primary} />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Photo kept private
            </ThemedText>
          </View>
        )}
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.45)", "rgba(0,0,0,0.88)"]}
          locations={[0.4, 0.7, 1]}
          style={styles.scrim}
          pointerEvents="none"
        />
        <View style={styles.cardInfo} pointerEvents="none">
          <View style={styles.nameRow}>
            <ThemedText style={styles.name} numberOfLines={1}>
              {profile.displayName}
              {profile.age ? `, ${profile.age}` : ""}
            </ThemedText>
            {profile.verificationStatus === "VERIFIED" ? (
              <Ionicons
                name="checkmark-circle"
                size={16}
                color="#67E8F9"
                accessibilityLabel="Verified"
              />
            ) : null}
          </View>
          {profile.publicLocation ? (
            <View style={styles.locationRow}>
              <Ionicons
                name="location-sharp"
                size={11}
                color="rgba(255,255,255,0.88)"
              />
              <ThemedText style={styles.meta} numberOfLines={1}>
                {profile.publicLocation}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

export function BrowseGrid({
  items,
  refreshing,
  loadingMore,
  onRefresh,
  onLoadMore,
  onActiveProfileChange,
  empty,
}: {
  items: PublicMatchmakingProfile[];
  refreshing: boolean;
  loadingMore: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  onActiveProfileChange?: (profile: PublicMatchmakingProfile) => void;
  empty?: React.ReactElement;
}) {
  const theme = useTheme();
  const activeCallback = React.useRef(onActiveProfileChange);
  React.useEffect(() => {
    activeCallback.current = onActiveProfileChange;
  }, [onActiveProfileChange]);
  const [onViewableItemsChanged] = React.useState<ViewableItemsChanged>(() => {
    const handler: ViewableItemsChanged = ({ viewableItems }) => {
      const firstVisible = viewableItems.find((item) => item.isViewable)
        ?.item as PublicMatchmakingProfile | undefined;
      if (firstVisible) activeCallback.current?.(firstVisible);
    };
    return handler;
  });

  return (
    <FlatList
      style={styles.listSurface}
      data={items}
      numColumns={2}
      columnWrapperStyle={styles.row}
      keyExtractor={(item) => item.userId}
      contentContainerStyle={[
        styles.list,
        items.length === 0 && styles.emptyList,
      ]}
      renderItem={({ item }) => (
        <View style={styles.cardWrap}>
          <BrowseProfileCard profile={item} />
        </View>
      )}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.primary}
        />
      }
      onEndReached={onLoadMore}
      onEndReachedThreshold={0.35}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={VIEWABILITY_CONFIG}
      ListEmptyComponent={empty}
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={theme.primary} size="small" />
            <ThemedText type="small" themeColor="textSecondary">
              Finding more compatible profiles…
            </ThemedText>
          </View>
        ) : undefined
      }
      showsVerticalScrollIndicator={false}
      initialNumToRender={6}
      windowSize={7}
    />
  );
}

const styles = StyleSheet.create({
  listSurface: { flex: 1 },
  list: {
    paddingHorizontal: Spacing.three * 0.3,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  emptyList: { flexGrow: 1 },
  row: { gap: Spacing.two },
  cardWrap: { flex: 1, maxWidth: "50%", marginBottom: Spacing.two },
  card: {
    width: "100%",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  pressed: { opacity: 0.94 },
  photoButton: { width: "100%", aspectRatio: 0.75 },
  photo: { width: "100%", height: "100%" },
  photoFallback: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  fallbackIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "52%",
  },
  cardInfo: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.two,
    gap: 3,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    flexShrink: 1,
  },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  meta: { color: "rgba(255,255,255,0.9)", fontSize: 11, fontWeight: "500" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
});
