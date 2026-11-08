/**
 * EventFilterDrawer — left slide-in filter panel for event discovery.
 * Parent mounts it conditionally (`{open && <EventFilterDrawer/>}`); it
 * slides in on mount and animates out before calling `onClose`, so no
 * visible-prop state juggling is needed.
 * Sections mirror the discovery API filters: date window, format,
 * visibility scope and category (single-select — the API takes one
 * categoryId).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import type {
  EventCategory,
  EventMode,
  VisibilityScope,
} from "../types/event-types";

export type ScopeFilter = "ALL" | VisibilityScope;
export type ModeFilter = "ALL" | EventMode;
export type DateFilter = "ANY" | "TODAY" | "WEEK" | "MONTH";

export interface EventFilterSelection {
  scope: ScopeFilter;
  mode: ModeFilter;
  date: DateFilter;
  categoryId: string | null;
}

export const EMPTY_FILTER_SELECTION: EventFilterSelection = {
  scope: "ALL",
  mode: "ALL",
  date: "ANY",
  categoryId: null,
};

export function activeFilterCount(sel: EventFilterSelection): number {
  return (
    (sel.scope !== "ALL" ? 1 : 0) +
    (sel.mode !== "ALL" ? 1 : 0) +
    (sel.date !== "ANY" ? 1 : 0) +
    (sel.categoryId !== null ? 1 : 0)
  );
}

const DATE_OPTIONS: [DateFilter, string][] = [
  ["ANY", "Any day"],
  ["TODAY", "Today"],
  ["WEEK", "This week"],
  ["MONTH", "This month"],
];
const MODE_OPTIONS: [ModeFilter, string][] = [
  ["ALL", "Any format"],
  ["IN_PERSON", "In person"],
  ["ONLINE_EXTERNAL", "Online"],
];
const SCOPE_OPTIONS: [ScopeFilter, string][] = [
  ["ALL", "All events"],
  ["COMMUNITY", "My communities"],
  ["COUNTRY", "Country-wide"],
];

interface Props {
  /** Currently applied selection — used as the draft's initial state. */
  selection: EventFilterSelection;
  categories: EventCategory[];
  onApply: (sel: EventFilterSelection) => void;
  /** Called after the exit animation completes. */
  onClose: () => void;
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

export function EventFilterDrawer({
  selection,
  categories,
  onApply,
  onClose,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(340, Math.round(width * 0.85));

  const [slide] = useState(() => new Animated.Value(-drawerWidth));
  const [draft, setDraft] = useState<EventFilterSelection>(selection);

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
      toValue: -drawerWidth,
      duration: 220,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [slide, drawerWidth, onClose]);

  const apply = useCallback(() => {
    Animated.timing(slide, {
      toValue: -drawerWidth,
      duration: 220,
      useNativeDriver: true,
    }).start(() => onApply(draft));
  }, [slide, drawerWidth, draft, onApply]);

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
      <View style={s.overlay}>
        {/* Backdrop */}
        <Animated.View
          style={[s.backdrop, { opacity: backdropOpacity }]}
          pointerEvents="auto"
        >
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
          ]}
        >
          <View style={[s.header, { borderBottomColor: theme.border }]}>
            <ThemedText style={s.headerTitle}>Filters</ThemedText>
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
            <Section title="Date" themeBorder={theme.border}>
              {DATE_OPTIONS.map(([value, label]) => (
                <RadioRow
                  key={value}
                  label={label}
                  checked={draft.date === value}
                  onSelect={() => setDraft((d) => ({ ...d, date: value }))}
                />
              ))}
            </Section>

            <Section title="Format" themeBorder={theme.border}>
              {MODE_OPTIONS.map(([value, label]) => (
                <RadioRow
                  key={value}
                  label={label}
                  checked={draft.mode === value}
                  onSelect={() => setDraft((d) => ({ ...d, mode: value }))}
                />
              ))}
            </Section>

            <Section title="Visibility" themeBorder={theme.border}>
              {SCOPE_OPTIONS.map(([value, label]) => (
                <RadioRow
                  key={value}
                  label={label}
                  checked={draft.scope === value}
                  onSelect={() => setDraft((d) => ({ ...d, scope: value }))}
                />
              ))}
            </Section>

            <Section title="Category" themeBorder={theme.border}>
              <RadioRow
                label="All categories"
                checked={draft.categoryId === null}
                onSelect={() => setDraft((d) => ({ ...d, categoryId: null }))}
              />
              {categories.map((c) => (
                <RadioRow
                  key={c.id}
                  label={c.displayName}
                  checked={draft.categoryId === c.id}
                  onSelect={() => setDraft((d) => ({ ...d, categoryId: c.id }))}
                />
              ))}
            </Section>
          </ScrollView>

          <View style={[s.footer, { borderTopColor: theme.border }]}>
            <Pressable
              onPress={() => setDraft(EMPTY_FILTER_SELECTION)}
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
              <ThemedText style={s.applyText}>Show events</ThemedText>
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
    left: 0,
    top: 0,
    bottom: 0,
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
