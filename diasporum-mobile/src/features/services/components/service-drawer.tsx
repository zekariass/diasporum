/**
 * Services menu drawer — slide-in panel for the Service Marketplace.
 * Mount conditionally (`{open && <ServicesMenuDrawer/>}`); it slides in on
 * mount and animates out before `onClose`, mirroring JobsMenuDrawer.
 */
import React, { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

function DrawerShell({
  onClose,
  children,
}: {
  /** Called after the exit animation completes. */
  onClose: () => void;
  children: (close: (after?: () => void) => void) => React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(340, Math.round(width * 0.85));

  const [slide] = useState(() => new Animated.Value(drawerWidth));

  useEffect(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [slide]);

  const close = useCallback(
    (after?: () => void) => {
      Animated.timing(slide, {
        toValue: drawerWidth,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        onClose();
        after?.();
      });
    },
    [slide, drawerWidth, onClose],
  );

  const backdropOpacity = slide.interpolate({
    inputRange: [0, drawerWidth],
    outputRange: [0.5, 0],
    extrapolate: "clamp",
  });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => close()}
    >
      <View style={s.overlay}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => close()}
            accessibilityLabel="Close menu"
            accessibilityRole="button"
          />
        </Animated.View>
        <Animated.View
          style={[
            s.panel,
            {
              width: drawerWidth,
              backgroundColor: theme.background,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: slide }],
            },
          ]}
        >
          {children(close)}
        </Animated.View>
      </View>
    </Modal>
  );
}

type IconName = ComponentProps<typeof Ionicons>["name"];

interface DrawerItem {
  key: string;
  label: string;
  icon: IconName;
  route: string;
  isActive: (pathname: string) => boolean;
}

interface DrawerSection {
  title: string;
  items: DrawerItem[];
}

const startsWith = (prefix: string) => (pathname: string) =>
  pathname.startsWith(prefix);

const SECTIONS: DrawerSection[] = [
  {
    title: "Find help",
    items: [
      {
        key: "browse",
        label: "Browse services",
        icon: "search-outline",
        route: "/(app)/services",
        isActive: (pathname) =>
          pathname === "/services" || pathname === "/services/index",
      },
      {
        key: "request",
        label: "Request a service",
        icon: "add-circle-outline",
        route: "/(app)/services/requests/create",
        isActive: startsWith("/services/requests/create"),
      },
      {
        key: "my-jobs",
        label: "My jobs",
        icon: "briefcase-outline",
        route: "/(app)/services/requests/mine",
        isActive: startsWith("/services/requests/mine"),
      },
      {
        key: "providers",
        label: "Browse providers",
        icon: "people-outline",
        route: "/(app)/services/providers",
        isActive: (pathname) => pathname === "/services/providers",
      },
    ],
  },
  {
    title: "Work with us",
    items: [
      {
        key: "offer",
        label: "Offer services",
        icon: "storefront-outline",
        route: "/(app)/services/providers/mine",
        isActive: startsWith("/services/providers/mine"),
      },
      {
        key: "become-provider",
        label: "Become a provider",
        icon: "person-add-outline",
        route: "/(app)/services/providers/create",
        isActive: startsWith("/services/providers/create"),
      },
      {
        key: "find-work",
        label: "Find work",
        icon: "megaphone-outline",
        route: "/(app)/services/requests/discover",
        isActive: startsWith("/services/requests/discover"),
      },
      {
        key: "responses",
        label: "My responses",
        icon: "chatbubbles-outline",
        route: "/(app)/services/responses",
        isActive: startsWith("/services/responses"),
      },
    ],
  },
];

export function ServicesMenuDrawer({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  const go = useCallback(
    (item: DrawerItem, close: (after?: () => void) => void) => {
      close(() => router.push(item.route as never));
    },
    [router],
  );

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: section.items.map((item) => ({
          ...item,
          active: item.isActive(pathname),
        })),
      })),
    [pathname],
  );

  return (
    <DrawerShell onClose={onClose}>
      {(close) => (
        <>
          <View style={[s.header, { borderBottomColor: theme.border }]}>
            <View style={s.brand}>
              <View style={[s.brandMark, { borderColor: theme.primary }]}>
                <Ionicons
                  name="construct-outline"
                  size={15}
                  color={theme.primary}
                />
              </View>
              <ThemedText style={[s.brandText, { color: theme.primary }]}>
                Services
              </ThemedText>
            </View>
            <Pressable
              onPress={() => close()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
              style={[s.closeBtn, { backgroundColor: theme.backgroundElement }]}
            >
              <Ionicons name="close" size={18} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.menuContent}
            showsVerticalScrollIndicator={false}
          >
            {sections.map((section) => (
              <View key={section.title} style={s.menuSection}>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={s.menuSectionTitle}
                >
                  {section.title.toUpperCase()}
                </ThemedText>
                {section.items.map((item) => (
                  <Pressable
                    key={item.key}
                    onPress={() => go(item, close)}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: item.active }}
                    style={({ pressed }) => [
                      s.item,
                      item.active && { backgroundColor: theme.primarySurface },
                      pressed && !item.active && s.itemPressed,
                    ]}
                  >
                    <View
                      style={[
                        s.itemIcon,
                        {
                          backgroundColor: item.active
                            ? theme.primary
                            : theme.backgroundElement,
                        },
                      ]}
                    >
                      <Ionicons
                        name={item.icon}
                        size={19}
                        color={
                          item.active ? BrandColors.white : theme.textSecondary
                        }
                      />
                    </View>
                    <ThemedText
                      style={[
                        s.itemLabel,
                        item.active && {
                          color: theme.primary,
                          fontWeight: "800",
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </ThemedText>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={
                        item.active ? theme.primary : theme.textSecondary
                      }
                    />
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        </>
      )}
    </DrawerShell>
  );
}

const s = StyleSheet.create({
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
    right: 0,
    top: 0,
    bottom: 0,
    shadowColor: BrandColors.black,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: -4, height: 0 },
    elevation: 12,
  },
  header: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: BorderRadius.sm,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "45deg" }],
  },
  brandText: { fontSize: 18, fontWeight: "800", letterSpacing: 0.3 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flex: 1 },
  menuContent: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.one,
    gap: Spacing.four,
  },
  menuSection: { gap: Spacing.one },
  menuSectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    paddingHorizontal: 1,
    marginBottom: Spacing.one,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 2,
    paddingVertical: Spacing.two,
  },
  itemPressed: { opacity: 0.7 },
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  itemLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
});
