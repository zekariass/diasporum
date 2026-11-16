/**
 * Jobs drawers — slide-in panels for the Jobs screen.
 * Parent mounts them conditionally (`{open && <Drawer/>}`); they slide in
 * on mount and animate out before calling `onClose`/`onApply`, mirroring
 * EventFilterDrawer and SpareBagMenuDrawer. The left drawer carries every
 * discovery filter; the right drawer is the Jobs feature menu.
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
  TextInput,
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
import type { JobCategory } from "../types/job-types";
import { label } from "../utils/job-format";
import {
  EMPLOYMENT_TYPES,
  EMPTY_JOB_FILTERS,
  WORKPLACE_TYPES,
  type CommunityOption,
  type DatePosted,
  type JobsFilterState,
} from "./job-discovery-sheets";

const DATE_POSTED: { value: DatePosted; label: string }[] = [
  { value: "ANY", label: "Any time" },
  { value: "24H", label: "Past 24 hours" },
  { value: "7D", label: "Past week" },
  { value: "30D", label: "Past month" },
];

// ------------------------------------------------------------------ shell

function DrawerShell({
  side,
  onClose,
  children,
}: {
  side: "left" | "right";
  /** Called after the exit animation completes. */
  onClose: () => void;
  children: (close: (after?: () => void) => void) => React.ReactNode;
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

  const close = useCallback(
    (after?: () => void) => {
      Animated.timing(slide, {
        toValue: offscreen,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        onClose();
        after?.();
      });
    },
    [slide, offscreen, onClose],
  );

  const backdropOpacity = slide.interpolate(
    side === "left"
      ? {
          inputRange: [-drawerWidth, 0],
          outputRange: [0, 0.5],
          extrapolate: "clamp",
        }
      : {
          inputRange: [0, drawerWidth],
          outputRange: [0.5, 0],
          extrapolate: "clamp",
        },
  );

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
            accessibilityLabel="Close drawer"
            accessibilityRole="button"
          />
        </Animated.View>

        <Animated.View
          style={[
            s.panel,
            side === "left" ? s.panelLeft : s.panelRight,
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

// ------------------------------------------------------------------ filters (left)

export function JobsFilterDrawer({
  filters,
  categories,
  communities,
  activeCommunityId,
  onApply,
  onClose,
}: {
  filters: JobsFilterState;
  categories: JobCategory[];
  communities: CommunityOption[];
  activeCommunityId: string | null;
  /** Called after the exit animation completes. */
  onApply: (filters: JobsFilterState) => void;
  /** Called after the exit animation completes. */
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<JobsFilterState>(filters);
  const patch = (value: Partial<JobsFilterState>) =>
    setDraft((current) => ({ ...current, ...value }));

  return (
    <DrawerShell side="left" onClose={onClose}>
      {(close) => (
        <>
          <View style={[s.header, { borderBottomColor: theme.border }]}>
            <ThemedText style={s.headerTitle}>Filters</ThemedText>
            <Pressable
              onPress={() => close()}
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
            {communities.length ? (
              <Section title="Community" themeBorder={theme.border}>
                <View style={s.chipWrap}>
                  <FilterChip
                    label="Any"
                    selected={!draft.communityId}
                    onPress={() => patch({ communityId: null })}
                  />
                  {communities.map((community) => (
                    <FilterChip
                      key={community.id}
                      label={
                        community.id === activeCommunityId
                          ? `${community.name} (active)`
                          : community.name
                      }
                      selected={draft.communityId === community.id}
                      onPress={() =>
                        patch({
                          communityId:
                            draft.communityId === community.id
                              ? null
                              : community.id,
                        })
                      }
                    />
                  ))}
                </View>
              </Section>
            ) : null}

            <Section title="City or region" themeBorder={theme.border}>
              <SheetInput
                value={draft.city}
                onChange={(city) => patch({ city })}
                placeholder="Any city"
                accessibilityLabel="Filter city"
              />
            </Section>

            <Section title="Scope" themeBorder={theme.border}>
              <View style={s.chipWrap}>
                <FilterChip
                  label="All scopes"
                  selected={!draft.scope}
                  onPress={() => patch({ scope: null })}
                />
                <FilterChip
                  label="Community"
                  selected={draft.scope === "COMMUNITY"}
                  onPress={() => patch({ scope: "COMMUNITY" })}
                />
                <FilterChip
                  label="Country"
                  selected={draft.scope === "COUNTRY"}
                  onPress={() => patch({ scope: "COUNTRY" })}
                />
              </View>
            </Section>

            {categories.length ? (
              <ExpandableSection
                title="Job category"
                themeBorder={theme.border}
                summary={
                  categories.find(
                    (category) => category.id === draft.categoryId,
                  )?.displayName ?? "All"
                }
                defaultOpen={draft.categoryId !== null}
              >
                <View style={s.chipWrap}>
                  {categories.map((category) => (
                    <FilterChip
                      key={category.id}
                      label={category.displayName}
                      selected={draft.categoryId === category.id}
                      onPress={() =>
                        patch({
                          categoryId:
                            draft.categoryId === category.id
                              ? null
                              : category.id,
                        })
                      }
                    />
                  ))}
                </View>
              </ExpandableSection>
            ) : null}

            <Section title="Employment type" themeBorder={theme.border}>
              <View style={s.chipWrap}>
                {EMPLOYMENT_TYPES.map((type) => (
                  <FilterChip
                    key={type}
                    label={label(type)}
                    selected={draft.employmentType === type}
                    onPress={() =>
                      patch({
                        employmentType:
                          draft.employmentType === type ? null : type,
                      })
                    }
                  />
                ))}
              </View>
            </Section>

            <Section title="Work arrangement" themeBorder={theme.border}>
              <View style={s.chipWrap}>
                {WORKPLACE_TYPES.map((type) => (
                  <FilterChip
                    key={type}
                    label={type === "ONSITE" ? "On-site" : label(type)}
                    selected={draft.workplaceType === type}
                    onPress={() =>
                      patch({
                        workplaceType:
                          draft.workplaceType === type ? null : type,
                      })
                    }
                  />
                ))}
              </View>
            </Section>

            <Section title="Salary" themeBorder={theme.border}>
              <View style={s.salaryPair}>
                <View style={s.flex}>
                  <SheetInput
                    value={draft.salaryMin}
                    onChange={(salaryMin) => patch({ salaryMin })}
                    placeholder="Minimum"
                    accessibilityLabel="Minimum salary"
                    numeric
                  />
                </View>
                <View style={s.flex}>
                  <SheetInput
                    value={draft.salaryMax}
                    onChange={(salaryMax) => patch({ salaryMax })}
                    placeholder="Maximum"
                    accessibilityLabel="Maximum salary"
                    numeric
                  />
                </View>
              </View>
            </Section>

            <Section title="Date posted" themeBorder={theme.border}>
              <View style={s.chipWrap}>
                {DATE_POSTED.map((option) => (
                  <FilterChip
                    key={option.value}
                    label={option.label}
                    selected={draft.datePosted === option.value}
                    onPress={() => patch({ datePosted: option.value })}
                  />
                ))}
              </View>
            </Section>
          </ScrollView>

          <View style={[s.footer, { borderTopColor: theme.border }]}>
            <Pressable
              onPress={() => setDraft(EMPTY_JOB_FILTERS)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
            >
              <ThemedText style={s.clearText} themeColor="textSecondary">
                Clear all
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => close(() => onApply(draft))}
              accessibilityRole="button"
              accessibilityLabel="Show results"
              style={[s.applyBtn, { backgroundColor: BrandColors.primary }]}
            >
              <ThemedText style={s.applyText}>Show results</ThemedText>
            </Pressable>
          </View>
        </>
      )}
    </DrawerShell>
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

/** Section whose options stay hidden behind a tap-to-expand header row. */
function ExpandableSection({
  title,
  themeBorder,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  themeBorder: string;
  /** Current value shown next to the chevron while collapsed. */
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={[s.section, { borderBottomColor: themeBorder }]}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        style={s.sectionToggle}
      >
        <ThemedText style={s.sectionTitle} themeColor="textSecondary">
          {title}
        </ThemedText>
        <View style={s.sectionToggleRight}>
          {summary ? (
            <ThemedText
              style={s.sectionSummary}
              themeColor="textSecondary"
              numberOfLines={1}
            >
              {summary}
            </ThemedText>
          ) : null}
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={16}
            color={theme.textSecondary}
          />
        </View>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

function FilterChip({
  label: text,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        s.filterChip,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: selected ? theme.primarySurface : theme.background,
        },
      ]}
    >
      <ThemedText
        type="small"
        style={{ color: selected ? theme.primary : theme.text }}
      >
        {text}
      </ThemedText>
    </Pressable>
  );
}

function SheetInput({
  value,
  onChange,
  placeholder,
  accessibilityLabel,
  numeric = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  numeric?: boolean;
}) {
  const theme = useTheme();
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      keyboardType={numeric ? "decimal-pad" : "default"}
      style={[
        s.textInput,
        {
          borderColor: theme.border,
          backgroundColor: theme.background,
          color: theme.text,
        },
      ]}
    />
  );
}

// ------------------------------------------------------------------ menu (right)

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
    label: "Browse jobs",
    icon: "search-outline",
    route: "/(app)/jobs",
    isActive: (pathname) =>
      pathname === "/jobs" || pathname === "/jobs/index",
  },
  {
    key: "my",
    label: "My listings",
    icon: "briefcase-outline",
    route: "/(app)/jobs/my",
    isActive: (pathname) =>
      pathname === "/jobs/my" || pathname.startsWith("/jobs/my/"),
  },
  {
    key: "applications",
    label: "My applications",
    icon: "document-text-outline",
    route: "/(app)/jobs/my-applications",
    isActive: (pathname) =>
      pathname.startsWith("/jobs/my-applications") ||
      pathname.startsWith("/jobs/application"),
  },
  {
    key: "saved",
    label: "Saved jobs",
    icon: "bookmark-outline",
    route: "/(app)/jobs/saved",
    isActive: startsWith("/jobs/saved"),
  },
  {
    key: "create",
    label: "Post a job",
    icon: "add-circle-outline",
    route: "/(app)/jobs/create",
    isActive: startsWith("/jobs/create"),
  },
];

export function JobsMenuDrawer({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  const go = useCallback(
    (item: DrawerItem, close: (after?: () => void) => void) => {
      close(() => router.push(item.route as never));
    },
    [router],
  );

  const menu = useMemo(
    () =>
      ITEMS.map((item) => ({ ...item, active: item.isActive(pathname) })),
    [pathname],
  );

  return (
    <DrawerShell side="right" onClose={onClose}>
      {(close) => (
        <>
          <View style={[s.header, { borderBottomColor: theme.border }]}>
            <View style={s.brand}>
              <View style={[s.brandMark, { borderColor: theme.primary }]}>
                <Ionicons
                  name="briefcase-outline"
                  size={15}
                  color={theme.primary}
                />
              </View>
              <ThemedText style={[s.brandText, { color: theme.primary }]}>
                Jobs
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
            {menu.map((item) => (
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
                    item.active && { color: theme.primary, fontWeight: "800" },
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </ThemedText>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={item.active ? theme.primary : theme.textSecondary}
                />
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
    </DrawerShell>
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
  panelLeft: {
    left: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 4, height: 0 },
  },
  panelRight: {
    right: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: -4, height: 0 },
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
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  menuContent: { padding: Spacing.three, gap: Spacing.one },
  section: {
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  sectionToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  sectionToggleRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    flexShrink: 1,
  },
  sectionSummary: { fontSize: 12, fontWeight: "600", flexShrink: 1 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  filterChip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  textInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  salaryPair: { flexDirection: "row", gap: Spacing.two },
  flex: { flex: 1 },
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
