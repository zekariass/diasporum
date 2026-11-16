/**
 * SpareBagMenuDrawer — left slide-in navigation drawer for the Spare Bag
 * feature, opened from the header's menu button. Parent mounts it
 * conditionally (`{open && <SpareBagMenuDrawer/>}`); it slides in on mount
 * and animates out before calling `onClose` — the same behaviour as
 * PropertyMenuDrawer and the app-wide FeatureDrawer.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

type IconName = ComponentProps<typeof Ionicons>["name"];

interface DrawerItem {
  key: string;
  label: string;
  icon: IconName;
  route: string;
  isActive: (pathname: string) => boolean;
}

const startsWith =
  (prefix: string) =>
  (pathname: string) =>
    pathname.startsWith(prefix);

const ITEMS: DrawerItem[] = [
  {
    key: "browse",
    label: "Browse Listings",
    icon: "search-outline",
    route: "/(app)/spare-bag",
    isActive: (pathname) =>
      pathname === "/spare-bag" || pathname === "/spare-bag/index",
  },
  {
    key: "my",
    label: "My Spare Bag",
    icon: "briefcase-outline",
    route: "/(app)/spare-bag/my",
    isActive: startsWith("/spare-bag/my"),
  },
  {
    key: "saved",
    label: "Saved",
    icon: "bookmark-outline",
    route: "/(app)/spare-bag/saved",
    isActive: startsWith("/spare-bag/saved"),
  },
  {
    key: "requests",
    label: "Requests",
    icon: "chatbubbles-outline",
    route: "/(app)/spare-bag/contacts",
    isActive: startsWith("/spare-bag/contacts"),
  },
];

export function SpareBagMenuDrawer({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(320, Math.round(width * 0.85));

  const [slide] = useState(() => new Animated.Value(-drawerWidth));

  useEffect(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [slide]);

  const close = useCallback(() => {
    Animated.timing(slide, {
      toValue: -drawerWidth,
      duration: 220,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [slide, drawerWidth, onClose]);

  const go = useCallback(
    (item: DrawerItem) => {
      Animated.timing(slide, {
        toValue: -drawerWidth,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        onClose();
        router.push(item.route as never);
      });
    },
    [slide, drawerWidth, onClose, router],
  );

  const backdropOpacity = useMemo(
    () =>
      slide.interpolate({
        inputRange: [-drawerWidth, 0],
        outputRange: [0, 0.5],
        extrapolate: "clamp",
      }),
    [slide, drawerWidth],
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[styles.backdrop, { opacity: backdropOpacity }]}
          pointerEvents="auto"
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityLabel="Close menu"
            accessibilityRole="button"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            {
              width: drawerWidth,
              backgroundColor: theme.background,
              borderRightColor: theme.border,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: slide }],
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.brand}>
              <View
                style={[
                  styles.brandMark,
                  { borderColor: theme.primary },
                ]}
              >
                <Ionicons
                  name="bag-handle-outline"
                  size={15}
                  color={theme.primary}
                />
              </View>
              <ThemedText style={[styles.brandText, { color: theme.primary }]}>
                Spare Bag
              </ThemedText>
            </View>
            <Pressable
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
              style={[
                styles.closeButton,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <Ionicons name="close" size={18} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {ITEMS.map((item) => {
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
                    active && { backgroundColor: theme.primarySurface },
                    pressed && !active && styles.itemPressed,
                  ]}
                >
                  <View
                    style={[
                      styles.itemIcon,
                      {
                        backgroundColor: active
                          ? theme.primary
                          : theme.backgroundElement,
                      },
                    ]}
                  >
                    <Ionicons
                      name={item.icon}
                      size={19}
                      color={active ? BrandColors.white : theme.textSecondary}
                    />
                  </View>
                  <ThemedText
                    style={[
                      styles.itemLabel,
                      active && { color: theme.primary, fontWeight: "800" },
                    ]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </ThemedText>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={active ? theme.primary : theme.textSecondary}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BrandColors.black,
  },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    shadowColor: BrandColors.black,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 4, height: 0 },
    elevation: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.full,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  brandText: { fontSize: 19, fontWeight: "700" },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { flex: 1 },
  listContent: { padding: Spacing.three, gap: Spacing.one },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    minHeight: 52,
    borderRadius: BorderRadius.md,
  },
  itemPressed: { opacity: 0.65 },
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  itemLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
});
