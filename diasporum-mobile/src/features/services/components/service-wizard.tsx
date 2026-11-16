/**
 * Service Marketplace onboarding wizard — the same step-by-step chrome used
 * for customer (request) and provider onboarding: segmented progress header,
 * a question block per step, card/row pickers and a Continue footer.
 */
import React, { useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export type WizardIcon = ComponentProps<typeof Ionicons>["name"];

/**
 * Top chrome for every wizard step: back control, stage title, "x of y"
 * counter and the segmented progress track.
 */
export function WizardScaffold({
  step,
  total,
  title,
  onBack,
  canContinue,
  continueLabel = "Continue",
  submitting = false,
  onContinue,
  children,
}: {
  step: number;
  total: number;
  title: string;
  onBack: () => void;
  canContinue: boolean;
  continueLabel?: string;
  submitting?: boolean;
  onContinue: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={onBack}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [
              styles.backButton,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text} />
          </Pressable>
          <View style={styles.stageHeading}>
            <Ionicons name="construct-outline" size={17} color={theme.primary} />
            <ThemedText style={styles.stageTitle} numberOfLines={1}>
              {title}
            </ThemedText>
          </View>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.counter}
          >
            {step + 1} of {total}
          </ThemedText>
        </View>
        <View
          style={styles.segments}
          accessibilityRole="progressbar"
          accessibilityLabel={`Step ${step + 1} of ${total}`}
          accessibilityValue={{ min: 0, max: total, now: step + 1 }}
        >
          {Array.from({ length: total }, (_, index) => (
            <View
              key={index}
              style={[
                styles.segment,
                index === step && styles.segmentCurrent,
                {
                  backgroundColor:
                    index <= step ? theme.primary : theme.backgroundElement,
                },
              ]}
            />
          ))}
        </View>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            borderTopColor: theme.border,
            paddingBottom: keyboardOpen
              ? Spacing.two
              : Math.max(Spacing.four, insets.bottom + Spacing.two),
          },
        ]}
      >
        <Pressable
          onPress={onContinue}
          disabled={!canContinue || submitting}
          accessibilityRole="button"
          accessibilityLabel={continueLabel}
          accessibilityState={{ disabled: !canContinue, busy: submitting }}
          style={({ pressed }) => [
            styles.continue,
            { backgroundColor: BrandColors.primary },
            (pressed || !canContinue) && styles.continueDim,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={BrandColors.white} accessibilityLabel="Saving" />
          ) : (
            <>
              <ThemedText style={styles.continueText}>
                {continueLabel}
              </ThemedText>
              <Ionicons name="arrow-forward" size={18} color={BrandColors.white} />
            </>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Question block at the top of each step. */
export function WizardQuestion({
  icon,
  title,
  description,
}: {
  icon: WizardIcon;
  title: string;
  description?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.question}>
      <View
        style={[styles.questionIcon, { backgroundColor: theme.primarySurface }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Ionicons name={icon} size={24} color={theme.primary} />
      </View>
      <ThemedText style={styles.questionTitle}>{title}</ThemedText>
      {description ? (
        <ThemedText
          style={styles.questionDescription}
          themeColor="textSecondary"
        >
          {description}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Fade-and-slide transition applied whenever the step changes. */
export function WizardStepTransition({
  step,
  direction,
  children,
}: {
  step: number;
  direction: 1 | -1;
  children: React.ReactNode;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [step, progress]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateX: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [direction * 28, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** Image-backed selection card used for category picks; falls back to an icon tile. */
export function WizardImageCard({
  label,
  hint,
  image,
  icon,
  tint,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  image?: string;
  icon: WizardIcon;
  tint: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.imageCard,
        { borderColor: selected ? theme.primary : theme.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.imageCardArt, { backgroundColor: tint }]}>
        {image && !failed ? (
          <Image
            source={{ uri: image }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Ionicons name={icon} size={30} color={BrandColors.primaryDark} />
        )}
      </View>
      <View style={styles.imageCardBody}>
        <ThemedText
          style={[styles.imageCardLabel, selected && { color: theme.primary }]}
          numberOfLines={2}
        >
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {selected ? (
        <View style={[styles.imageCardCheck, { backgroundColor: BrandColors.primary }]}>
          <Ionicons name="checkmark" size={12} color={BrandColors.white} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Two-column grid for WizardImageCard; the last odd card stretches. */
export function WizardGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

export function WizardGridItem({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <View style={[styles.gridItem, wide && styles.gridItemWide]}>
      {children}
    </View>
  );
}

/** Single-select row with leading icon and trailing radio/check. */
export function WizardOptionRow({
  label,
  hint,
  icon,
  selected,
  drill,
  onPress,
}: {
  label: string;
  hint?: string;
  icon?: WizardIcon;
  selected: boolean;
  /** Show a forward chevron instead of the radio — the row drills deeper. */
  drill?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected
            ? theme.primarySurface
            : theme.backgroundElement,
          borderColor: selected ? theme.primary : theme.border,
        },
        pressed && styles.pressed,
      ]}
    >
      {icon ? (
        <View
          style={[
            styles.rowIcon,
            { backgroundColor: selected ? BrandColors.primary : theme.background },
          ]}
        >
          <Ionicons
            name={icon}
            size={18}
            color={selected ? BrandColors.white : theme.primary}
          />
        </View>
      ) : null}
      <View style={styles.rowCopy}>
        <ThemedText
          style={[styles.rowLabel, selected && { color: theme.primary }]}
        >
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {drill ? (
        <Ionicons
          name="chevron-forward"
          size={20}
          color={theme.textSecondary}
        />
      ) : selected ? (
        <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
      ) : (
        <View style={[styles.rowCircle, { borderColor: theme.border }]} />
      )}
    </Pressable>
  );
}

/** Multi-select chip for provider service subscriptions. */
export function WizardChip({
  label,
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
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? BrandColors.primary : theme.backgroundElement,
          borderColor: selected ? BrandColors.primary : theme.border,
        },
        pressed && styles.pressed,
      ]}
    >
      {selected ? (
        <Ionicons name="checkmark" size={14} color={BrandColors.white} />
      ) : null}
      <ThemedText style={[styles.chipText, selected && styles.chipTextActive]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Small heading above a field cluster inside a step. */
export function WizardFieldLabel({
  label,
  required = false,
}: {
  label: string;
  required?: boolean;
}) {
  return (
    <ThemedText style={styles.fieldLabel}>
      {label}
      {required ? " *" : ""}
    </ThemedText>
  );
}

/** Review-row used on the final summary step. */
export function WizardSummaryRow({
  icon,
  label,
  value,
}: {
  icon: WizardIcon;
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.summaryRow, { borderBottomColor: theme.border }]}>
      <Ionicons name={icon} size={16} color={theme.primary} />
      <ThemedText
        type="small"
        themeColor="textSecondary"
        style={styles.summaryLabel}
      >
        {label}
      </ThemedText>
      <ThemedText
        type="small"
        style={styles.summaryValue}
        numberOfLines={2}
      >
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    gap: Spacing.three,
    paddingHorizontal: 6,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  stageHeading: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
  },
  stageTitle: { fontSize: 14, fontWeight: "700", flexShrink: 1 },
  counter: { fontWeight: "600", width: 44, textAlign: "right" },
  segments: { flexDirection: "row", gap: Spacing.one },
  segment: { flex: 1, height: 4, borderRadius: BorderRadius.full },
  segmentCurrent: { height: 6, marginTop: -1 },
  content: {
    paddingVertical: Spacing.four,
    paddingHorizontal: 6,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  footer: {
    paddingTop: Spacing.four,
    paddingHorizontal: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  continue: {
    minHeight: 54,
    borderRadius: BorderRadius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  continueDim: { opacity: 0.55 },
  continueText: { color: BrandColors.white, fontSize: 16, fontWeight: "700" },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  question: { gap: Spacing.two, marginBottom: Spacing.one },
  questionIcon: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.one,
  },
  questionTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  questionDescription: { fontSize: 15, lineHeight: 22 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.three },
  gridItem: { flexBasis: "46%", flexGrow: 1 },
  gridItemWide: { flexBasis: "100%" },
  imageCard: {
    borderWidth: 1.5,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  imageCardArt: {
    width: "100%",
    aspectRatio: 1.6,
    alignItems: "center",
    justifyContent: "center",
  },
  imageCardBody: { padding: Spacing.two, gap: 2, minHeight: 52 },
  imageCardLabel: { fontSize: 14, fontWeight: "700" },
  imageCardCheck: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    borderWidth: 1.5,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 56,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: "600" },
  rowCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    borderWidth: 1.5,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  chipText: { fontSize: 14, fontWeight: "600" },
  chipTextActive: { color: BrandColors.white },
  fieldLabel: { fontSize: 15, fontWeight: "600" },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryLabel: { width: 92 },
  summaryValue: { flex: 1, fontWeight: "600", textAlign: "right" },
});

