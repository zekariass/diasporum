/**
 * Shopping marketplace bottom navigation — styled like the dating section's
 * custom bar (DatingBottomNavigation): hairline separator, a top-edge pill
 * indicator on the active tab, a badge pill on the Inbox icon, and a raised
 * primary Sell button in the center.
 *
 * Used with expo-router/ui headless tabs: <TabList> takes the bar style and
 * each <TabTrigger asChild> forwards slot props (isFocused, onPress…) onto
 * ShopTabButton / ShopSellButton.
 */
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TabTriggerSlotProps } from "expo-router/ui";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** Same palette logic as the dating nav. */
function useNavColors() {
  const theme = useTheme();
  const scheme = useColorScheme();
  return {
    theme,
    inactive: scheme === "dark" ? "#64748B" : "#111827",
    separator:
      scheme === "dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.30)",
  };
}

/** Style for <TabList> — the bar itself; the separator is its top border. */
export function useShopTabBarStyle(): StyleProp<ViewStyle> {
  const { theme, separator } = useNavColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);
  return {
    height: 64 + bottomPad,
    paddingBottom: bottomPad,
    paddingHorizontal: 4,
    backgroundColor: theme.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: separator,
    overflow: "visible",
  };
}

/** Primary count pill pinned to a tab icon; hidden at 0, capped at 99+. */
function CountBadge({ count }: { count: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.countBadge, { backgroundColor: theme.primary }]}>
      <ThemedText style={styles.badgeText}>
        {count > 99 ? "99+" : count}
      </ThemedText>
    </View>
  );
}

export type ShopTabButtonProps = TabTriggerSlotProps & {
  icon: IconName;
  activeIcon: IconName;
  label: string;
  badge?: number;
};

/** Side tab: pill indicator, filled icon + bold label when active, badge. */
export function ShopTabButton({
  icon,
  activeIcon,
  label,
  badge = 0,
  isFocused,
  style,
  ref,
  ...props
}: ShopTabButtonProps) {
  const { theme, inactive } = useNavColors();
  const selected = !!isFocused;
  const color = selected ? theme.primary : inactive;
  return (
    <Pressable
      ref={ref as never}
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={`Shopping ${label.toLowerCase()}`}
      accessibilityState={{ selected }}
      style={(state) => [
        typeof style === "function" ? style(state) : style,
        styles.navItem,
        state.pressed && { opacity: 0.75 },
      ]}
    >
      {selected ? (
        <View style={[styles.indicator, { backgroundColor: theme.primary }]} />
      ) : null}
      <View style={styles.iconWrap}>
        <Ionicons name={selected ? activeIcon : icon} size={23} color={color} />
        <CountBadge count={badge} />
      </View>
      <ThemedText
        style={[
          styles.label,
          { color, fontWeight: selected ? "700" : "500" },
        ]}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Plain link button — not a tab, so it's never "active". Used for the Feed
 * entry that navigates out of the marketplace to the app's feed screen. */
export function ShopLinkButton({
  icon,
  label,
  href,
}: {
  icon: IconName;
  label: string;
  href: string;
}) {
  const { inactive } = useNavColors();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(href as never)}
      accessibilityRole="tab"
      accessibilityLabel={`Shopping ${label.toLowerCase()}`}
      style={({ pressed }) => [styles.navItem, pressed && { opacity: 0.75 }]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={23} color={inactive} />
      </View>
      <ThemedText style={[styles.label, { color: inactive, fontWeight: "500" }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Raised circular Sell button in the center, like the dating Messages one,
 * with its label pinned to the bottom of the bar like the other tabs. */
export function ShopSellButton({
  isFocused,
  style,
  ref,
  ...props
}: TabTriggerSlotProps) {
  const { theme, separator, inactive } = useNavColors();
  const selected = !!isFocused;
  return (
    <Pressable
      ref={ref as never}
      {...props}
      accessibilityRole="tab"
      accessibilityLabel="Sell an item"
      accessibilityState={{ selected }}
      style={(state) => [
        typeof style === "function" ? style(state) : style,
        styles.centerCell,
        state.pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.centerWrap}>
        <View
          style={[
            styles.centerOuter,
            { backgroundColor: theme.background, borderColor: separator },
          ]}
        >
          <View
            style={[
              styles.centerCircle,
              { backgroundColor: theme.primary, shadowColor: theme.primary },
            ]}
          >
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </View>
        </View>
      </View>
      <ThemedText
        style={[
          styles.label,
          styles.centerLabel,
          {
            color: selected ? theme.primary : inactive,
            fontWeight: selected ? "700" : "500",
          },
        ]}
      >
        Sell
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  navItem: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  indicator: {
    position: "absolute",
    top: 0,
    left: "50%",
    marginLeft: -12,
    width: 24,
    height: 2.5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  iconWrap: {
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 11, lineHeight: 14 },
  centerCell: {
    width: 62,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    alignSelf: "stretch",
  },
  centerWrap: { marginTop: -18 },
  centerLabel: { marginTop: "auto", marginBottom: 10 },
  centerOuter: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  centerCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  countBadge: {
    position: "absolute",
    top: -7,
    right: -10,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
});
