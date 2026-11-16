/**
 * Shop filter drawers — slide-in panels for the browse screen.
 * Parent mounts them conditionally (`{open && <Drawer/>}`); they slide in
 * on mount and animate out before calling `onClose`/`onApply`, mirroring
 * EventFilterDrawer. Left side lists categories; right side holds the
 * sort and condition filters.
 */

import React, { useCallback, useEffect, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { conditionLabel } from "./shop-ui";
import type { Category } from "../types/shop-types";

// Must match products.condition CHECK in V28.
const CONDITIONS = ["NEW", "LIKE_NEW", "USED_GOOD", "USED_FAIR", "REFURBISHED", "OTHER"];
const SORTS = [
  { key: "RELEVANCE", label: "Relevance" },
  { key: "NEWEST", label: "Newest" },
  { key: "POPULAR", label: "Popular" },
  { key: "PRICE_ASC", label: "Price ↑" },
  { key: "PRICE_DESC", label: "Price ↓" },
];

export interface FilterSortSelection {
  sort: string;
  condition: string | null;
}

// ------------------------------------------------------------------ shell

function FilterDrawerShell({
  side,
  title,
  onClear,
  onApply,
  onClose,
  children,
}: {
  side: "left" | "right";
  title: string;
  onClear: () => void;
  /** Called after the exit animation completes. */
  onApply: () => void;
  /** Called after the exit animation completes. */
  onClose: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(340, Math.round(width * 0.85));
  const offscreen = side === "left" ? -drawerWidth : drawerWidth;

  const [slide] = useState(() => new Animated.Value(offscreen));

  // Slide in on mount. Animation only — no state updates in the effect.
  useEffect(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [slide]);

  const close = useCallback(() => {
    Animated.timing(slide, {
      toValue: offscreen,
      duration: 220,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [slide, offscreen, onClose]);

  const apply = useCallback(() => {
    Animated.timing(slide, {
      toValue: offscreen,
      duration: 220,
      useNativeDriver: true,
    }).start(() => onApply());
  }, [slide, offscreen, onApply]);

  const backdropOpacity = slide.interpolate(
    side === "left"
      ? { inputRange: [-drawerWidth, 0], outputRange: [0, 0.5], extrapolate: "clamp" }
      : { inputRange: [0, drawerWidth], outputRange: [0.5, 0], extrapolate: "clamp" },
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={s.overlay}>
        {/* Backdrop */}
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityLabel="Close filters"
            accessibilityRole="button"
          />
        </Animated.View>

        {/* Panel */}
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
            side === "left" ? s.panelLeft : s.panelRight,
          ]}
        >
          <View style={[s.header, { borderBottomColor: theme.border }]}>
            <ThemedText style={s.headerTitle}>{title}</ThemedText>
            <Pressable
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close filters"
              style={[s.closeBtn, { backgroundColor: theme.backgroundElement }]}
            >
              <Ionicons name="close" size={18} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>

          <View style={[s.footer, { borderTopColor: theme.border }]}>
            <Pressable
              onPress={onClear}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
            >
              <ThemedText style={s.clearText} themeColor="textSecondary">
                Clear all
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={apply}
              accessibilityRole="button"
              accessibilityLabel="Apply filters"
              style={[s.applyBtn, { backgroundColor: BrandColors.primary }]}
            >
              <ThemedText style={s.applyText}>Show items</ThemedText>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Section({
  title,
  themeBorder,
  children,
}: {
  title: string;
  themeBorder: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[s.section, { borderBottomColor: themeBorder }]}>
      <ThemedText style={s.sectionTitle} themeColor="textSecondary">
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function RadioRow({
  label,
  checked,
  onSelect,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: checked }}
      style={({ pressed }) => [
        s.radioRow,
        pressed && { backgroundColor: theme.backgroundElement },
      ]}
    >
      <View
        style={[
          s.radioOuter,
          { borderColor: checked ? BrandColors.primary : theme.textMuted },
        ]}
      >
        {checked && <View style={s.radioInner} />}
      </View>
      <ThemedText style={[s.radioLabel, checked && s.radioLabelActive]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

// ------------------------------------------------------------------ categories (left)

export function ShopCategoriesDrawer({
  categories,
  selectedId,
  onApply,
  onClose,
}: {
  categories: Category[];
  selectedId: string | null;
  onApply: (categoryId: string | null) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<string | null>(selectedId);
  return (
    <FilterDrawerShell
      side="left"
      title="Categories"
      onClear={() => setDraft(null)}
      onApply={() => onApply(draft)}
      onClose={onClose}
    >
      <Section title="Category" themeBorder={theme.border}>
        <RadioRow
          label="All categories"
          checked={draft === null}
          onSelect={() => setDraft(null)}
        />
        {categories.map((c) => (
          <RadioRow
            key={c.id}
            label={c.name}
            checked={draft === c.id}
            onSelect={() => setDraft(c.id)}
          />
        ))}
      </Section>
    </FilterDrawerShell>
  );
}

// ------------------------------------------------------------------ sort + condition (right)

export function ShopFilterSortDrawer({
  selection,
  onApply,
  onClose,
}: {
  selection: FilterSortSelection;
  onApply: (selection: FilterSortSelection) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<FilterSortSelection>(selection);
  return (
    <FilterDrawerShell
      side="right"
      title="Sort & filter"
      onClear={() => setDraft({ sort: "RELEVANCE", condition: null })}
      onApply={() => onApply(draft)}
      onClose={onClose}
    >
      <Section title="Sort by" themeBorder={theme.border}>
        {SORTS.map((option) => (
          <RadioRow
            key={option.key}
            label={option.label}
            checked={draft.sort === option.key}
            onSelect={() => setDraft((d) => ({ ...d, sort: option.key }))}
          />
        ))}
      </Section>
      <Section title="Condition" themeBorder={theme.border}>
        <RadioRow
          label="Any condition"
          checked={draft.condition === null}
          onSelect={() => setDraft((d) => ({ ...d, condition: null }))}
        />
        {CONDITIONS.map((c) => (
          <RadioRow
            key={c}
            label={conditionLabel(c)}
            checked={draft.condition === c}
            onSelect={() => setDraft((d) => ({ ...d, condition: c }))}
          />
        ))}
      </Section>
    </FilterDrawerShell>
  );
}

// ------------------------------------------------------------------ styles

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
    top: 0,
    bottom: 0,
    shadowColor: BrandColors.black,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
  },
  panelLeft: { left: 0, shadowOffset: { width: 4, height: 0 } },
  panelRight: { right: 0, shadowOffset: { width: -4, height: 0 } },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 19, fontWeight: "800" },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.four },
  section: { paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: Spacing.one,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: 10,
    paddingHorizontal: Spacing.one,
    borderRadius: BorderRadius.sm,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: BrandColors.primary,
  },
  radioLabel: { fontSize: 15 },
  radioLabelActive: { fontWeight: "700" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  clearText: { fontSize: 14, fontWeight: "600" },
  applyBtn: {
    flex: 1,
    borderRadius: BorderRadius.md,
    paddingVertical: 13,
    alignItems: "center",
  },
  applyText: { color: BrandColors.white, fontSize: 15, fontWeight: "800" },
});
