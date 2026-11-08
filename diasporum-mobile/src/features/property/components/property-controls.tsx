import React, { useContext, useRef, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { safeBack } from "@/core/navigation/safe-back";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export function PropertyScreen({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable
            onPress={safeBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle} numberOfLines={1}>
            {title}
          </ThemedText>
          <View style={styles.actions}>
            {actions ?? <View style={styles.headerSpacer} />}
          </View>
        </View>
        {children}
      </SafeAreaView>
    </ThemedView>
  );
}

export function Chip({
  label,
  active,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: active ? theme.primary : theme.border,
          backgroundColor: active ? theme.primarySurface : theme.background,
        },
        pressed && { opacity: 0.75 },
      ]}
    >
      {active ? (
        <Ionicons name="checkmark-circle" size={16} color={theme.primary} />
      ) : null}
      <ThemedText style={[styles.chipText, active && { color: theme.primary }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Provided by scrollable forms — scrolls a focused field above the keyboard/footer. */
export const FormScrollContext = React.createContext<{
  reveal: (input: React.ComponentRef<typeof TextInput>) => void;
  blur: () => void;
} | null>(null);

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  secureTextEntry,
  autoCapitalize,
  icon,
  hint,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  icon?: keyof typeof Ionicons.glyphMap;
  hint?: string;
  maxLength?: number;
}) {
  const theme = useTheme();
  const formScroll = useContext(FormScrollContext);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const [multilineHeight, setMultilineHeight] = useState<number | null>(null);
  return (
    <View style={styles.field}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <View
        style={[
          styles.inputShell,
          {
            borderColor: focused ? theme.primary : theme.border,
            backgroundColor: focused
              ? theme.background
              : theme.backgroundElement,
          },
          multiline && styles.multilineShell,
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={19}
            color={focused ? theme.primary : theme.textSecondary}
            style={multiline ? styles.multilineIcon : undefined}
          />
        ) : null}
        <TextInput
          ref={inputRef}
          onFocus={() => {
            setFocused(true);
            if (inputRef.current) formScroll?.reveal(inputRef.current);
          }}
          onBlur={() => {
            setFocused(false);
            formScroll?.blur();
          }}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          selectionColor={theme.primary}
          keyboardType={keyboardType}
          multiline={multiline}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          maxLength={maxLength}
          accessibilityLabel={label}
          onContentSizeChange={
            multiline
              ? (event) => {
                  setMultilineHeight(
                    Math.min(
                      Math.max(event.nativeEvent.contentSize.height, 132),
                      360,
                    ),
                  );
                  // The field grows while typing — re-reveal so the cursor stays visible.
                  // Only while focused: onContentSizeChange also fires at mount,
                  // and an unfocused reveal scrolls the form on open.
                  if (focused && inputRef.current) formScroll?.reveal(inputRef.current);
                }
              : undefined
          }
          style={[
            styles.input,
            { color: theme.text },
            icon && styles.inputWithIcon,
            multiline && styles.multiline,
            multiline &&
              multilineHeight !== null && {
                height: multilineHeight,
                minHeight: 0,
              },
          ]}
        />
      </View>
      {hint ? (
        <ThemedText themeColor="textSecondary" style={styles.fieldHint}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const RADIUS_MIN = 1;
const RADIUS_MAX = 100;

function sliderValue(x: number, state: { shown: number; trackWidth: number }) {
  if (state.trackWidth <= 0) return state.shown;
  const clamped = Math.min(Math.max(x, 0), state.trackWidth);
  return Math.round(
    RADIUS_MIN + (clamped / state.trackWidth) * (RADIUS_MAX - RADIUS_MIN),
  );
}

/** Dependency-free radius slider (1–100 km) so it works in Expo Go and dev builds. */
export function RadiusSlider({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (value: number) => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const shown = draft ?? value;
  const fraction = Math.min(
    Math.max((shown - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN), 0),
    1,
  );

  // Handlers are recreated each render so every touch dispatches with fresh state.
  const panHandlers = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) =>
      setDraft(sliderValue(event.nativeEvent.locationX, { shown, trackWidth })),
    onPanResponderMove: (event) =>
      setDraft(sliderValue(event.nativeEvent.locationX, { shown, trackWidth })),
    onPanResponderRelease: (event) => {
      const next = sliderValue(event.nativeEvent.locationX, {
        shown,
        trackWidth,
      });
      setDraft(null);
      onCommit(next);
    },
    onPanResponderTerminate: () => setDraft(null),
  }).panHandlers;

  return (
    <View style={styles.sliderBlock}>
      <View style={styles.sliderLabelRow}>
        <Ionicons name="locate-outline" size={14} color={BrandColors.primary} />
        <ThemedText style={styles.sliderLabel}>Within {shown} km</ThemedText>
        <ThemedText style={[styles.sliderHint, { color: theme.textSecondary }]}>
          {RADIUS_MIN}–{RADIUS_MAX} km
        </ThemedText>
      </View>
      <View
        style={styles.sliderTouch}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        {...panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Search radius in kilometres"
        accessibilityValue={{
          min: RADIUS_MIN,
          max: RADIUS_MAX,
          now: shown,
          text: `${shown} kilometres`,
        }}
        onAccessibilityAction={(event) => {
          const step =
            event.nativeEvent.actionName === "increment"
              ? 5
              : event.nativeEvent.actionName === "decrement"
                ? -5
                : 0;
          if (step) {
            onCommit(Math.min(Math.max(shown + step, RADIUS_MIN), RADIUS_MAX));
          }
        }}
      >
        <View style={[styles.sliderTrack, { backgroundColor: theme.border }]}>
          <View
            style={[
              styles.sliderFill,
              {
                width: `${fraction * 100}%`,
                backgroundColor: BrandColors.primary,
              },
            ]}
          />
        </View>
        <View
          style={[
            styles.sliderThumb,
            { left: `${fraction * 100}%`, borderColor: BrandColors.primary },
          ]}
        />
      </View>
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { id: T; label: string; icon?: keyof typeof Ionicons.glyphMap }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.segmented,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.segment,
              active && { backgroundColor: BrandColors.primary },
              pressed && { opacity: 0.8 },
            ]}
          >
            {option.icon ? (
              <Ionicons
                name={option.icon}
                size={17}
                color={active ? BrandColors.white : theme.textSecondary}
              />
            ) : null}
            <ThemedText
              style={[
                styles.segmentText,
                active && { color: BrandColors.white },
              ]}
              numberOfLines={1}
            >
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StepperInput({
  label,
  value,
  onChange,
  max = 20,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  hint?: string;
}) {
  const theme = useTheme();
  const current = value.trim() === "" ? null : Number(value);
  const bump = (delta: 1 | -1) => {
    if (delta === 1) onChange(String(Math.min(max, (current ?? 0) + 1)));
    else if (current !== null)
      onChange(current <= 1 ? "" : String(current - 1));
  };
  return (
    <View style={styles.stepper}>
      <View style={styles.stepperText}>
        <ThemedText style={styles.label}>{label}</ThemedText>
        {hint ? (
          <ThemedText themeColor="textSecondary" style={styles.stepperHint}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={() => bump(-1)}
          disabled={current === null}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          style={[
            styles.stepperButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
            },
            current === null && { opacity: 0.45 },
          ]}
        >
          <Ionicons name="remove" size={17} color={theme.text} />
        </Pressable>
        <ThemedText
          style={styles.stepperValue}
          accessibilityLabel={`${label} count`}
        >
          {current ?? "—"}
        </ThemedText>
        <Pressable
          onPress={() => bump(1)}
          disabled={current !== null && current >= max}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          style={[
            styles.stepperButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
            },
            current !== null && current >= max && { opacity: 0.45 },
          ]}
        >
          <Ionicons name="add" size={17} color={theme.text} />
        </Pressable>
      </View>
    </View>
  );
}

export function FormSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.section,
        { backgroundColor: theme.background, borderColor: theme.border },
      ]}
    >
      <View style={styles.sectionHeader}>
        {icon ? (
          <View
            style={[
              styles.sectionIcon,
              { backgroundColor: theme.primarySurface },
            ]}
          >
            <Ionicons name={icon} size={19} color={theme.primary} />
          </View>
        ) : null}
        <View style={styles.sectionHeading}>
          <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
          {description ? (
            <ThemedText
              themeColor="textSecondary"
              style={styles.sectionDescription}
            >
              {description}
            </ThemedText>
          ) : null}
        </View>
      </View>
      {children}
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  loading,
  disabled,
  danger,
  variant = "primary",
  icon,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  danger?: boolean;
  variant?: "primary" | "secondary";
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  const busy = Boolean(loading || disabled);
  const secondary = variant === "secondary";
  const foreground = danger
    ? theme.error
    : secondary
      ? theme.text
      : BrandColors.white;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: Boolean(loading), disabled: busy }}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: danger
            ? theme.errorSurface
            : secondary
              ? theme.background
              : BrandColors.primary,
        },
        secondary && { borderColor: theme.border, borderWidth: 1 },
        busy && { opacity: 0.55 },
        pressed && !busy && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.actionContent}>
          <ThemedText style={[styles.actionText, { color: foreground }]}>
            {label}
          </ThemedText>
          {icon ? <Ionicons name={icon} size={18} color={foreground} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontSize: 18 },
  actions: { minWidth: 24, alignItems: "flex-end" },
  headerSpacer: { width: 24 },
  chip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  field: { gap: Spacing.two },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  inputShell: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingLeft: Spacing.three,
  },
  multilineShell: { alignItems: "flex-start" },
  multilineIcon: { marginTop: 15 },
  input: {
    flex: 1,
    minHeight: 50,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    fontSize: 16,
    lineHeight: 22,
  },
  inputWithIcon: { paddingLeft: 0 },
  multiline: { minHeight: 132, textAlignVertical: "top" },
  fieldHint: { fontSize: 12, lineHeight: 17 },
  section: {
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeading: { flex: 1, gap: Spacing.half },
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: "800" },
  sectionDescription: { fontSize: 13, lineHeight: 18 },
  actionButton: {
    minHeight: 52,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
  },
  actionContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  actionText: { color: BrandColors.white, fontSize: 15, fontWeight: "700" },
  sliderBlock: { gap: Spacing.two },
  sliderLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  sliderLabel: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  sliderHint: { fontSize: 11, lineHeight: 15 },
  sliderTouch: { height: 32, justifyContent: "center" },
  sliderTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  sliderFill: { height: 4, borderRadius: 2 },
  sliderThumb: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: -10,
    backgroundColor: BrandColors.white,
    borderWidth: 2,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmented: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.one,
    gap: Spacing.one,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    gap: Spacing.one,
    borderRadius: BorderRadius.sm + 4,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  segmentText: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  stepper: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  stepperText: { flex: 1, gap: 2 },
  stepperHint: { fontSize: 12, lineHeight: 16 },
  stepperControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    minWidth: 32,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
  },
});
