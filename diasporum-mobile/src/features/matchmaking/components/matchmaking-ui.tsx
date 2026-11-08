import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { FormInput } from "@/shared/components/form-input";
import { matchmakingError } from "../services/matchmaking-errors";
import { useTheme } from "@/hooks/use-theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSession } from "@/core/session/session-provider";
import { createMessagingApi } from "@/features/messaging/services/messaging-api";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { useMatchmakingRealtime } from "../hooks/use-matchmaking-realtime";
import {
  discoveryModeSnapshot,
  loadDiscoveryMode,
} from "../utils/discovery-mode";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { Choice } from "../types/matchmaking-options";
import type { ReferenceOption } from "../types/matchmaking-types";

export function ScreenHeader({
  title,
  subtitle,
  back = true,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      {back ? (
        <Pressable
          onPress={() => router.back()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={25} color={theme.text} />
        </Pressable>
      ) : null}
      <View style={styles.headerCopy}>
        <ThemedText type="title" style={styles.headerTitle}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

export function ChoiceChips({
  label,
  choices,
  value,
  onChange,
  multi = false,
  required = false,
}: {
  label: string;
  choices: (Choice | ReferenceOption)[];
  value: string | null | string[];
  onChange: (value: string | null | string[]) => void;
  multi?: boolean;
  required?: boolean;
}) {
  const theme = useTheme();
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const longList = choices.length > 16;
  const filtered = choices.filter((choice) =>
    choice.label
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const visible =
    longList && !expanded && !search.trim()
      ? filtered.filter(
          (choice, index) =>
            index < 12 ||
            selected.includes("value" in choice ? choice.value : choice.id),
        )
      : filtered;
  const choose = (next: string) => {
    if (multi) {
      onChange(
        selected.includes(next)
          ? selected.filter((item) => item !== next)
          : [...selected, next],
      );
    } else {
      onChange(selected.includes(next) && !required ? null : next);
    }
  };
  return (
    <View style={styles.field} accessibilityLabel={label}>
      <ThemedText style={styles.label}>
        {label}
        {required ? " *" : ""}
      </ThemedText>
      {longList ? (
        <FormInput
          label={`Search ${label.toLowerCase()}`}
          value={search}
          onChangeText={setSearch}
        />
      ) : null}
      <View style={styles.chips}>
        {visible.map((choice) => {
          const choiceValue = "value" in choice ? choice.value : choice.id;
          const active = selected.includes(choiceValue);
          return (
            <Pressable
              key={choiceValue}
              onPress={() => choose(choiceValue)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${choice.label}`}
              style={[
                styles.chip,
                {
                  backgroundColor: active
                    ? theme.primary
                    : theme.backgroundElement,
                  borderColor: active ? theme.primary : theme.border,
                },
              ]}
            >
              <ThemedText
                style={[styles.chipText, active && styles.selectedChipText]}
              >
                {choice.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      {longList && !search.trim() ? (
        <PrimaryButton
          variant="ghost"
          label={
            expanded
              ? `Show fewer ${label.toLowerCase()}`
              : `Show all ${label.toLowerCase()}`
          }
          onPress={() => setExpanded((current) => !current)}
        />
      ) : null}
      {search.trim() && visible.length === 0 ? (
        <ThemedText type="small">No choices found.</ThemedText>
      ) : null}
    </View>
  );
}

/**
 * Dropdown select for long option lists (e.g. ~195 countries). Renders a
 * field that opens a modal list — optionally searchable — instead of a
 * wall of chips. Optional fields get a "Not specified" row to clear.
 */
export function SelectField({
  label,
  options,
  value,
  onChange,
  required = false,
  searchable = false,
}: {
  label: string;
  options: (Choice | ReferenceOption)[];
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  searchable?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalized = options.map((option) => ({
    id: "value" in option ? option.value : option.id,
    label: option.label,
  }));
  const selected = normalized.find((option) => option.id === value);
  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed
    ? normalized.filter((option) =>
        option.label.toLowerCase().includes(trimmed),
      )
    : normalized;

  const choose = (id: string | null) => {
    setOpen(false);
    setQuery("");
    onChange(id);
  };

  return (
    <View style={styles.field} accessibilityLabel={label}>
      <ThemedText style={styles.label}>
        {label}
        {required ? " *" : ""}
      </ThemedText>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          selected ? `${label}: ${selected.label}` : `${label}: choose`
        }
        style={[
          styles.select,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
        ]}
      >
        <ThemedText
          numberOfLines={1}
          style={[
            styles.selectText,
            !selected && { color: theme.textSecondary },
          ]}
        >
          {selected?.label ?? "Select"}
        </ThemedText>
        <Ionicons name="chevron-down" size={15} color={theme.textSecondary} />
      </Pressable>
      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
            {/* Inner pressable swallows taps so the card itself doesn't dismiss. */}
            <Pressable
              onPress={() => {}}
              style={[
                styles.selectCard,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              {searchable ? (
                <View
                  style={[
                    styles.searchBox,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.background,
                    },
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={15}
                    color={theme.textSecondary}
                  />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search"
                    placeholderTextColor={theme.textSecondary}
                    autoFocus
                    accessibilityLabel={`Search ${label}`}
                    style={[styles.searchInput, { color: theme.text }]}
                  />
                </View>
              ) : null}
              <FlatList
                data={filtered}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={20}
                ListHeaderComponent={
                  required ? undefined : (
                    <Pressable
                      onPress={() => choose(null)}
                      accessibilityRole="button"
                      accessibilityLabel={`${label}: none`}
                      style={styles.option}
                    >
                      <ThemedText type="small" themeColor="textSecondary">
                        Not specified
                      </ThemedText>
                    </Pressable>
                  )
                }
                ListEmptyComponent={
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.option}
                  >
                    No matches
                  </ThemedText>
                }
                renderItem={({ item }) => {
                  const active = item.id === value;
                  return (
                    <Pressable
                      onPress={() => choose(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${label}: ${item.label}`}
                      style={[
                        styles.option,
                        active && { backgroundColor: theme.primarySurface },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.optionText,
                          active && { color: theme.primary },
                        ]}
                      >
                        {item.label}
                      </ThemedText>
                    </Pressable>
                  );
                }}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const REPORT_REASONS = [
  "SPAM",
  "SCAM",
  "HARASSMENT",
  "HATE",
  "SEXUAL_MISCONDUCT",
  "IMPERSONATION",
  "PRIVACY",
  "OTHER",
].map((value) => ({ value, label: value.replaceAll("_", " ").toLowerCase() }));

export function SafetyActions({
  onReport,
  onBlock,
  blocked = false,
  disabled = false,
}: {
  onReport: (reason: string, details: string) => Promise<unknown>;
  onBlock: () => Promise<unknown>;
  blocked?: boolean;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"report" | "block" | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy.current || !mode || (mode === "report" && !reason)) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (mode === "report") await onReport(reason!, details);
      else await onBlock();
      setFeedback(
        mode === "report"
          ? "Report sent. Your identity is kept private."
          : "Member blocked. You can still report them here.",
      );
      setMode(null);
    } catch (failure) {
      setError(
        matchmakingError(
          failure,
          "This safety action could not be completed. Please retry.",
        ),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <Section
      title="Your safety matters"
      hint="Reporting is private. You never need to unblock someone to report them."
    >
      {mode === "report" ? (
        <>
          <SelectField
            label="Report reason"
            required
            options={REPORT_REASONS}
            value={reason}
            onChange={setReason}
          />
          <FormInput
            label="What happened? (optional)"
            value={details}
            onChangeText={setDetails}
            multiline
            maxLength={4000}
          />
        </>
      ) : null}
      {mode === "block" ? (
        <ThemedText>
          Block this member? This closes your match and chat and prevents
          further contact. Unblocking will not restore the match.
        </ThemedText>
      ) : null}
      {mode ? (
        <>
          <PrimaryButton
            label={mode === "report" ? "Send report" : "Confirm block"}
            variant={mode === "block" ? "danger" : "primary"}
            disabled={disabled || (mode === "report" && !reason)}
            loading={pending}
            onPress={() => void submit()}
          />
          <PrimaryButton
            label="Cancel"
            variant="ghost"
            disabled={pending}
            onPress={() => setMode(null)}
          />
        </>
      ) : (
        <>
          <PrimaryButton
            label="Report member"
            variant="ghost"
            disabled={disabled}
            onPress={() => {
              setMode("report");
              setFeedback(null);
            }}
          />
          {!blocked ? (
            <PrimaryButton
              label="Block member"
              variant="danger"
              disabled={disabled}
              onPress={() => {
                setMode("block");
                setFeedback(null);
              }}
            />
          ) : null}
        </>
      )}
      {feedback ? (
        <ThemedText accessibilityRole="alert">{feedback}</ThemedText>
      ) : null}
      {error ? (
        <ThemedText themeColor="error" accessibilityRole="alert">
          {error}
        </ThemedText>
      ) : null}
    </Section>
  );
}

/**
 * Bottom-sheet chrome around SafetyActions — backdrop, handle, header, and a
 * scrollable body. Shared by the candidate profile and the swipe deck card.
 */
export function SafetySheet({
  visible,
  onClose,
  blocked = false,
  disabled = false,
  onReport,
  onBlock,
}: {
  visible: boolean;
  onClose: () => void;
  blocked?: boolean;
  disabled?: boolean;
  onReport: (reason: string, details: string) => Promise<unknown>;
  onBlock: () => Promise<unknown>;
}) {
  const theme = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.sheetRoot}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close safety options"
        />
        <SafeAreaView
          edges={["bottom"]}
          style={[styles.safetySheet, { backgroundColor: theme.background }]}
        >
          <View
            style={[styles.sheetHandle, { backgroundColor: theme.border }]}
          />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <ThemedText type="subtitle">Safety & privacy</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Your identity stays private when you report
              </ThemedText>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[
                styles.sheetClose,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <Ionicons name="close" size={21} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <SafetyActions
              blocked={blocked}
              disabled={disabled}
              onReport={onReport}
              onBlock={onBlock}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <ThemedText style={styles.toggleLabel}>{label}</ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: theme.border, true: theme.primary }}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function ProfilePhoto({
  uri,
  name,
  size = 88,
}: {
  uri: string | null;
  name: string;
  size?: number;
}) {
  const theme = useTheme();
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={style}
        contentFit="cover"
        accessibilityLabel={`${name} profile photo`}
        transition={150}
      />
    );
  }
  return (
    <View
      style={[
        style,
        styles.photoPlaceholder,
        { backgroundColor: theme.primarySurface },
      ]}
      accessibilityLabel={`${name} photo hidden`}
    >
      <Ionicons name="person" size={size * 0.45} color={theme.primary} />
    </View>
  );
}

export type DiscoveryMode = "swipe" | "browse";

/** Compact, icon-only swipe/browse switcher for the discovery header. */
export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: DiscoveryMode;
  onChange: (mode: DiscoveryMode) => void;
}) {
  const theme = useTheme();
  const options: {
    key: DiscoveryMode;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
  }[] = [
    { key: "swipe", icon: "albums-outline", label: "Swipe" },
    { key: "browse", icon: "grid-outline", label: "Browse" },
  ];
  return (
    <View
      style={[
        styles.modeWrap,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
      accessibilityRole="tablist"
      accessibilityLabel="Discovery mode"
    >
      {options.map((option) => {
        const active = mode === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${option.label} mode`}
            style={({ pressed }) => [
              styles.modeOption,
              active && { backgroundColor: theme.primarySurface },
              pressed && { opacity: 0.65 },
            ]}
          >
            <Ionicons
              name={option.icon}
              size={22}
              color={active ? theme.primary : theme.textSecondary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export type DatingSection =
  | "home"
  | "matches"
  | "messages"
  | "likes"
  | "profile";

/** Two stacked cards — the swipe-deck glyph. */
export function SwipeGlyph({
  active,
  activeColor,
  inactiveColor,
  inactiveFill,
}: {
  active: boolean;
  activeColor: string;
  inactiveColor: string;
  inactiveFill: string;
}) {
  const stroke = active ? activeColor : inactiveColor;
  return (
    <View
      style={styles.swipeGlyph}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <View
        style={[
          styles.glyphCard,
          styles.swipeCardBack,
          { borderColor: stroke },
        ]}
      />
      <View
        style={[
          styles.glyphCard,
          styles.swipeCardFront,
          {
            borderColor: stroke,
            backgroundColor: active ? activeColor : inactiveFill,
          },
        ]}
      />
    </View>
  );
}

/** Overlapping hearts — the matches glyph. */
export function MatchesGlyph({
  active,
  activeColor,
  inactiveColor,
  inactiveFill,
}: {
  active: boolean;
  activeColor: string;
  inactiveColor: string;
  inactiveFill: string;
}) {
  return (
    <View
      style={styles.matchesGlyph}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Ionicons
        name={active ? "heart" : "heart-outline"}
        size={19}
        color={active ? activeColor : inactiveColor}
        style={styles.matchesHeartBack}
      />
      <Ionicons
        name="heart"
        size={19}
        color={active ? activeColor : inactiveFill}
        style={styles.matchesHeartFront}
      />
    </View>
  );
}

/** Purple count pill pinned to a tab icon; hidden at 0, capped at 99+. */
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

/** Red unread pill pinned to the raised center button. */
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.unreadBadge}>
      <ThemedText style={styles.badgeText}>
        {count > 99 ? "99+" : count}
      </ThemedText>
    </View>
  );
}

/**
 * Live badge counts for the dating bar — matches and received likes use the
 * first-page totals, unread conversations use the messaging unread endpoint.
 * Realtime match events refresh all three so the bar stays current.
 */
function useDatingBadgeCounts() {
  const api = useMatchmakingApi();
  const { apiClient } = useSession();
  const messaging = useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const [counts, setCounts] = useState({ matches: 0, likes: 0, unread: 0 });
  const refresh = useCallback(() => {
    void Promise.allSettled([
      api.matches(),
      api.receivedLikes(),
      messaging.unreadCount(),
    ]).then(([matches, likes, unread]) =>
      setCounts({
        matches:
          matches.status === "fulfilled" ? matches.value.items.length : 0,
        likes: likes.status === "fulfilled" ? likes.value.items.length : 0,
        unread:
          unread.status === "fulfilled" ? (unread.value.total ?? 0) : 0,
      }),
    );
  }, [api, messaging]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useMatchmakingRealtime(refresh);
  return counts;
}

/**
 * Dating-specific navigation kept separate from the app's primary tab bar:
 * a screen-colored bar with a hairline separator, a top-edge pill indicator
 * on the active tab, and a raised circular Messages button in the center.
 */
export function DatingBottomNavigation({
  active = "home",
  onHome,
  onLikes,
  mode,
}: {
  active?: DatingSection;
  onHome?: () => void;
  onLikes?: () => void;
  /** Live discovery view mode; falls back to the persisted mode snapshot. */
  mode?: DiscoveryMode;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const counts = useDatingBadgeCounts();
  const [storedMode, setStoredMode] = useState<DiscoveryMode>(
    discoveryModeSnapshot,
  );
  useEffect(() => {
    if (mode !== undefined) return;
    void loadDiscoveryMode().then(setStoredMode);
  }, [mode]);
  const discoverMode = mode ?? storedMode;
  const inactive = scheme === "dark" ? "#64748B" : "#111827";
  const inactiveFill = scheme === "dark" ? "#E5E7EB" : "#0B0B0B";
  const separator =
    scheme === "dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.30)";

  const glyph = (key: DatingSection, selected: boolean) => {
    const color = selected ? theme.primary : inactive;
    switch (key) {
      case "home":
        return discoverMode === "browse" ? (
          <Ionicons name="grid-outline" size={23} color={color} />
        ) : (
          <SwipeGlyph
            active={selected}
            activeColor={theme.primary}
            inactiveColor={inactive}
            inactiveFill={inactiveFill}
          />
        );
      case "matches":
        return (
          <MatchesGlyph
            active={selected}
            activeColor={theme.primary}
            inactiveColor={inactive}
            inactiveFill={inactiveFill}
          />
        );
      case "likes":
        return (
          <Ionicons
            name={selected ? "heart" : "heart-outline"}
            size={23}
            color={color}
          />
        );
      case "profile":
        return (
          <Ionicons
            name={selected ? "person" : "person-outline"}
            size={23}
            color={color}
          />
        );
      default:
        return null;
    }
  };

  const items: {
    key: DatingSection;
    label: string;
    badge?: number;
    onPress: () => void;
  }[] = [
    {
      key: "home",
      label: "Discover",
      onPress: onHome ?? (() => router.push("/(app)/matchmaking" as never)),
    },
    {
      key: "matches",
      label: "Matches",
      badge: counts.matches,
      onPress: () => router.push("/(app)/matchmaking/matches" as never),
    },
    {
      key: "messages",
      label: "Messages",
      onPress: () => router.push("/(app)/(tabs)/messages" as never),
    },
    {
      key: "likes",
      label: "Likes",
      badge: counts.likes,
      onPress:
        onLikes ??
        (() => router.push("/(app)/matchmaking?tab=received" as never)),
    },
    {
      key: "profile",
      label: "Profile",
      onPress: () => router.push("/(app)/matchmaking/profile" as never),
    },
  ];

  return (
    <View
      style={[
        styles.datingNav,
        {
          backgroundColor: theme.background,
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
      accessibilityRole="tablist"
      accessibilityLabel="Dating navigation"
    >
      <View
        style={[styles.datingNavSeparator, { backgroundColor: separator }]}
      />
      <View style={styles.datingNavBar}>
        {items.map((item) => {
          const selected = active === item.key;
          if (item.key === "messages") {
            return (
              <View key={item.key} style={styles.datingNavCenterCell}>
                <Pressable
                  onPress={item.onPress}
                  accessibilityRole="tab"
                  accessibilityLabel="Dating messages"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.datingNavCenterWrap,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View
                    style={[
                      styles.datingNavCenterOuter,
                      {
                        backgroundColor: theme.background,
                        borderColor: separator,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.datingNavCenterCircle,
                        {
                          backgroundColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ]}
                    >
                      <Ionicons name="chatbubbles" size={22} color="#FFFFFF" />
                      <UnreadBadge count={counts.unread} />
                    </View>
                  </View>
                </Pressable>
              </View>
            );
          }
          return (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              accessibilityRole="tab"
              accessibilityLabel={`Dating ${item.label.toLowerCase()}`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.datingNavItem,
                pressed && { opacity: 0.75 },
              ]}
            >
              {selected ? (
                <View
                  style={[
                    styles.datingNavIndicator,
                    { backgroundColor: theme.primary },
                  ]}
                />
              ) : null}
              <View style={styles.datingNavIconWrap}>
                {glyph(item.key, selected)}
                <CountBadge count={item.badge ?? 0} />
              </View>
              <ThemedText
                style={[
                  styles.datingNavLabel,
                  {
                    color: selected ? theme.primary : inactive,
                    fontWeight: selected ? "700" : "500",
                  },
                ]}
              >
                {item.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Static placeholder cards shown while discovery loads. */
export function DiscoverySkeleton({ mode }: { mode: DiscoveryMode }) {
  const theme = useTheme();
  const placeholder = [
    styles.skeleton,
    { backgroundColor: theme.backgroundElement },
  ];
  if (mode === "swipe") {
    return (
      <View style={styles.skeletonDeck}>
        <View style={[...placeholder, styles.skeletonCard]} />
      </View>
    );
  }
  return (
    <View style={styles.skeletonGrid}>
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.skeletonGridRow}>
          {[0, 1].map((col) => (
            <View
              key={col}
              style={[...placeholder, styles.skeletonGridCard]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  icon = "heart-outline",
  action,
}: {
  title: string;
  body: string;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View
        style={[styles.emptyIcon, { backgroundColor: theme.primarySurface }]}
      >
        <Ionicons name={icon} size={30} color={theme.primary} />
      </View>
      <ThemedText type="subtitle" style={styles.centerText}>
        {title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.centerText}>
        {body}
      </ThemedText>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { padding: Spacing.one },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 25, lineHeight: 31 },
  section: { gap: Spacing.three },
  field: { gap: Spacing.two },
  label: { fontSize: 14, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
  },
  chipText: { fontSize: 13, lineHeight: 17 },
  select: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  selectText: { fontSize: 15, flexShrink: 1 },
  modalRoot: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
  selectCard: {
    alignSelf: "stretch",
    maxWidth: 360,
    maxHeight: 400,
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    margin: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    minHeight: 42,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: Spacing.two },
  option: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  optionText: { fontSize: 15 },
  selectedChipText: { color: "#fff", fontWeight: "700" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.three },
  toggleCopy: { flex: 1, gap: 3 },
  toggleLabel: { fontSize: 15, fontWeight: "600" },
  photoPlaceholder: { alignItems: "center", justifyContent: "center" },
  modeWrap: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  modeOption: {
    width: 44,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  datingNav: { overflow: "visible" },
  datingNavSeparator: { height: StyleSheet.hairlineWidth },
  datingNavBar: {
    height: 64,
    flexDirection: "row",
    paddingHorizontal: 4,
  },
  datingNavItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  datingNavIndicator: {
    position: "absolute",
    top: 0,
    left: "50%",
    marginLeft: -12,
    width: 24,
    height: 2.5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  datingNavIconWrap: {
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  datingNavLabel: { fontSize: 11, lineHeight: 14 },
  datingNavCenterCell: { width: 62, alignItems: "center" },
  datingNavCenterWrap: { marginTop: -27 },
  datingNavCenterOuter: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  datingNavCenterCircle: {
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
  unreadBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EF4444",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  swipeGlyph: { width: 28, height: 24 },
  glyphCard: {
    position: "absolute",
    width: 16,
    height: 20,
    borderWidth: 1.6,
    borderRadius: 4,
  },
  swipeCardBack: { right: 2, top: 3, opacity: 0.7 },
  swipeCardFront: {
    left: 2,
    top: 1,
    transform: [{ rotate: "-12deg" }],
  },
  matchesGlyph: { width: 34, height: 26 },
  matchesHeartBack: { position: "absolute", left: 0, top: 3, opacity: 0.55 },
  matchesHeartFront: { position: "absolute", right: 0, top: 4 },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  safetySheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
  },
  sheetHeaderCopy: { flex: 1, gap: 3 },
  sheetClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
  },
  skeleton: { borderRadius: BorderRadius.lg },
  skeletonDeck: { flex: 1, padding: Spacing.four },
  skeletonCard: { flex: 1, borderRadius: BorderRadius.xl, opacity: 0.7 },
  skeletonGrid: {
    flex: 1,
    gap: Spacing.two,
    paddingHorizontal: Spacing.three * 0.3,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  skeletonGridRow: { flexDirection: "row", gap: Spacing.two },
  skeletonGridCard: {
    flex: 1,
    aspectRatio: 0.75,
    borderRadius: 20,
    opacity: 0.7,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.five,
    gap: Spacing.three,
    flexGrow: 1,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  centerText: { textAlign: "center" },
});
