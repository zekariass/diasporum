/**
 * FeatureDrawer — LEFT-side drawer for main feature navigation.
 * Slides in/out with an animated panel + fading backdrop, mirroring
 * CommunityDrawer (right side) so the two drawers behave identically.
 *
 * Menu items are gated by the backend-provided community module snapshot
 * (session.access) — in Extended communities only permitted modules appear.
 * "Posts" is the parent destination for the existing Feed/Vids/Help/Polls
 * content experience (the home tab).
 */

import React, { useEffect, useState, type ComponentProps } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useSession } from "@/core/session/session-provider";
import {
  activeCommunityContext,
  isCommunityModuleEnabled,
} from "@/core/session/community-capabilities";
import type { CommunityModuleKey } from "@/features/communities/types/community-types";

type IconName = ComponentProps<typeof Ionicons>["name"];

interface DrawerFeature {
  key: string;
  label: string;
  icon: IconName;
  activeIcon: IconName;
  /** expo-router href */
  route: string;
  /** Bottom-tab destinations use navigate() so they don't stack. */
  tab?: boolean;
  /** Backend module that gates visibility; undefined = always visible. */
  module?: CommunityModuleKey;
  isActive: (pathname: string) => boolean;
}

const startsWith =
  (prefix: string) =>
  (pathname: string) =>
    pathname.startsWith(prefix);

const SECTIONS: { title: string | null; items: DrawerFeature[] }[] = [
  {
    title: null,
    items: [
      {
        key: "posts",
        label: "Posts",
        icon: "newspaper-outline",
        activeIcon: "newspaper",
        route: "/(app)/(tabs)",
        tab: true,
        module: "FEED",
        isActive: (pathname) =>
          pathname === "/" ||
          pathname === "/index" ||
          pathname.startsWith("/posts") ||
          pathname.startsWith("/reels"),
      },
    ],
  },
  {
    title: "CONNECT",
    items: [
      {
        key: "people",
        label: "People Connect",
        icon: "people-outline",
        activeIcon: "people",
        route: "/(app)/people",
        module: "PEOPLE",
        isActive: startsWith("/people"),
      },
      {
        key: "dating",
        label: "Dating",
        icon: "heart-outline",
        activeIcon: "heart",
        route: "/(app)/matchmaking",
        module: "MATCHMAKING",
        isActive: startsWith("/matchmaking"),
      },
    ],
  },
  {
    title: "COMMUNITY",
    items: [
      {
        key: "events",
        label: "Events",
        icon: "calendar-outline",
        activeIcon: "calendar",
        route: "/(app)/events",
        module: "EVENTS",
        isActive: startsWith("/events"),
      },
      {
        key: "jobs",
        label: "Jobs",
        icon: "briefcase-outline",
        activeIcon: "briefcase",
        route: "/(app)/jobs",
        module: "JOBS",
        isActive: startsWith("/jobs"),
      },
      {
        key: "chat",
        label: "Community Chat",
        icon: "chatbubble-ellipses-outline",
        activeIcon: "chatbubble-ellipses",
        route: "/(app)/(tabs)/messages",
        tab: true,
        module: "GENERAL_CHAT",
        isActive: startsWith("/messages"),
      },
      {
        key: "rooms",
        label: "Voice Rooms",
        icon: "mic-outline",
        activeIcon: "mic",
        route: "/(app)/(tabs)/rooms",
        tab: true,
        module: "VOICE_ROOMS",
        isActive: startsWith("/rooms"),
      },
    ],
  },
  {
    title: "MARKETPLACE",
    items: [
      {
        key: "business",
        label: "Business Directory",
        icon: "storefront-outline",
        activeIcon: "storefront",
        route: "/(app)/businesses",
        module: "BUSINESS_DIRECTORY",
        isActive: startsWith("/business"),
      },
      {
        key: "services",
        label: "Service Marketplace",
        icon: "construct-outline",
        activeIcon: "construct",
        route: "/(app)/services",
        module: "SERVICE_MARKETPLACE",
        isActive: startsWith("/services"),
      },
      {
        key: "spare-bag",
        label: "Spare Bag",
        icon: "bag-handle-outline",
        activeIcon: "bag-handle",
        route: "/(app)/spare-bag",
        module: "SPARE_BAG",
        isActive: startsWith("/spare-bag"),
      },
      {
        key: "properties",
        label: "Properties",
        icon: "business-outline",
        activeIcon: "business",
        route: "/(app)/properties",
        module: "PROPERTY",
        isActive: startsWith("/properties"),
      },
      {
        key: "vehicles",
        label: "Vehicles",
        icon: "car-outline",
        activeIcon: "car",
        route: "/(app)/vehicles",
        module: "VEHICLE",
        isActive: startsWith("/vehicles"),
      },
    ],
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Opens the community (right) drawer — used by the footer shortcut. */
  onSwitchCommunity: () => void;
}

const PANEL_WIDTH = 320;

export function FeatureDrawer({ visible, onClose, onSwitchCommunity }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const access = session?.access;
  const community = activeCommunityContext(access);

  const [mounted, setMounted] = useState(visible);
  const [slide] = useState(() => new Animated.Value(-PANEL_WIDTH));

  // Slide in / out — same timing curve as the community drawer.
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      Animated.timing(slide, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slide, {
        toValue: -PANEL_WIDTH,
        duration: 220,
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
  }, [visible, slide]);

  const backdropOpacity = slide.interpolate({
    inputRange: [-PANEL_WIDTH, 0],
    outputRange: [0, 1],
  });

  const go = (item: DrawerFeature) => {
    onClose();
    if (item.tab) router.navigate(item.route as never);
    else router.push(item.route as never);
  };

  const openProfile = () => {
    onClose();
    router.navigate("/(app)/(tabs)/profile" as never);
  };

  const displayName =
    session?.profile?.displayName ?? session?.me.email ?? "";
  const handle = session?.profile?.username
    ? `@${session.profile.username}`
    : null;
  const initial = (displayName || "?").trim().charAt(0).toUpperCase();

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[styles.backdropTouch, { opacity: backdropOpacity }]}
        >
          <Pressable
            style={styles.backdropInner}
            onPress={onClose}
            accessibilityLabel="Close navigation menu"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            {
              backgroundColor: theme.background,
              borderRightColor: theme.border,
              paddingTop: insets.top,
            },
            { transform: [{ translateX: slide }] },
          ]}
        >
          {/* Brand header */}
          <View style={styles.head}>
            <View style={styles.brand}>
              <View
                style={[
                  styles.logoBadge,
                  { backgroundColor: BrandColors.primary },
                ]}
              >
                <ThemedText style={styles.logoLetter}>D</ThemedText>
              </View>
              <ThemedText style={styles.wordmark}>diasporum</ThemedText>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel="Close navigation menu"
            >
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>

          {/* Profile shortcut */}
          <Pressable
            onPress={openProfile}
            style={[
              styles.profileRow,
              { borderBottomColor: theme.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open your profile"
          >
            <View
              style={[
                styles.avatar,
                { backgroundColor: theme.primarySurface },
              ]}
            >
              <ThemedText
                style={[styles.avatarText, { color: BrandColors.primary }]}
              >
                {initial}
              </ThemedText>
            </View>
            <View style={styles.profileText}>
              <ThemedText style={styles.profileName} numberOfLines={1}>
                {displayName}
              </ThemedText>
              {handle ? (
                <ThemedText
                  style={styles.profileHandle}
                  themeColor="textSecondary"
                  numberOfLines={1}
                >
                  {handle}
                </ThemedText>
              ) : null}
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={theme.textSecondary}
            />
          </Pressable>

          {/* Feature menu */}
          <ScrollView
            style={styles.list}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          >
            {SECTIONS.map((section, sectionIndex) => {
              const items = section.items.filter(
                (item) =>
                  item.module == null ||
                  isCommunityModuleEnabled(access, item.module),
              );
              if (items.length === 0) return null;
              return (
                <View key={section.title ?? `section-${sectionIndex}`}>
                  {sectionIndex > 0 ? (
                    <View
                      style={[
                        styles.divider,
                        { backgroundColor: theme.border },
                      ]}
                    />
                  ) : null}
                  {section.title ? (
                    <ThemedText
                      style={styles.sectionTitle}
                      themeColor="textSecondary"
                    >
                      {section.title}
                    </ThemedText>
                  ) : null}
                  {items.map((item) => {
                    const active = item.isActive(pathname);
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => go(item)}
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [
                          styles.item,
                          active && {
                            backgroundColor: theme.primarySurface,
                          },
                          pressed && !active && styles.itemPressed,
                        ]}
                      >
                        <View
                          style={[
                            styles.itemIcon,
                            active && {
                              backgroundColor: BrandColors.primary,
                            },
                          ]}
                        >
                          <Ionicons
                            name={active ? item.activeIcon : item.icon}
                            size={20}
                            color={
                              active ? BrandColors.white : theme.textSecondary
                            }
                          />
                        </View>
                        <ThemedText
                          style={[
                            styles.itemLabel,
                            active && {
                              color: BrandColors.primary,
                              fontWeight: "800",
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {item.label}
                        </ThemedText>
                        {active ? (
                          <Ionicons
                            name="chevron-forward"
                            size={16}
                            color={BrandColors.primary}
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>

          {/* Footer — bridges to the community switcher (right drawer) */}
          <Pressable
            onPress={onSwitchCommunity}
            style={[
              styles.communityRow,
              {
                borderTopColor: theme.border,
                paddingBottom: Spacing.four + insets.bottom,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Switch community"
          >
            <View
              style={[
                styles.itemIcon,
                { backgroundColor: theme.primarySurface },
              ]}
            >
              <Ionicons
                name="people"
                size={18}
                color={BrandColors.primary}
              />
            </View>
            <View style={styles.communityText}>
              <ThemedText style={styles.communityName} numberOfLines={1}>
                {community?.communityName ?? "Communities"}
              </ThemedText>
              <ThemedText
                style={styles.communityMeta}
                themeColor="textSecondary"
              >
                {community
                  ? `${community.accessType === "DEFAULT" ? "Default" : "Extended"} community · tap to switch`
                  : "Switch community"}
              </ThemedText>
            </View>
            <Ionicons
              name="swap-horizontal"
              size={22}
              color={BrandColors.primary}
            />
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, flexDirection: "row", justifyContent: "flex-start" },
  backdropTouch: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  backdropInner: { flex: 1 },
  panel: {
    width: PANEL_WIDTH,
    maxWidth: "85%",
    height: "100%",
    borderRightWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 4, height: 0 },
    elevation: 10,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoBadge: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  logoLetter: {
    fontSize: 16,
    fontWeight: "800",
    color: BrandColors.white,
    lineHeight: 20,
  },
  wordmark: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.9,
    lineHeight: 29,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "800" },
  profileText: { flex: 1 },
  profileName: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  profileHandle: { fontSize: 12, marginTop: 1 },
  list: { flex: 1 },
  listContent: { paddingBottom: Spacing.three },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginHorizontal: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
  },
  itemPressed: { opacity: 0.65 },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  itemLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
  communityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.three,
  },
  communityText: { flex: 1 },
  communityName: { fontSize: 14, fontWeight: "700", lineHeight: 19 },
  communityMeta: { fontSize: 11, marginTop: 1 },
});
