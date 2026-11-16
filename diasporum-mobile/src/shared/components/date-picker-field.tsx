/**
 * DatePickerField — tap-to-open date field backed by the native picker.
 * No free-text entry: Android shows the system dialog, iOS a bottom-sheet
 * spinner with Done/Clear actions. Values stay in YYYY-MM-DD form.
 */
import React, { useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

const DATE_MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function parseIsoDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function displayIsoDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return value;
  return `${day} ${DATE_MONTH_LABELS[month - 1]} ${year}`;
}

export function DatePickerField({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  minimumDate,
  maximumDate,
  placeholder = "Select a date",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
  placeholder?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  function change(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setOpen(false);
    if (event.type === "set" && date) onChange(toIsoDate(date));
  }

  const pickerBounds = { minimumDate, maximumDate };

  return (
    <View style={styles.field}>
      <ThemedText style={styles.label}>
        {label}
        {required ? (
          <ThemedText style={[styles.label, { color: theme.error }]}>
            {" "}
            *
          </ThemedText>
        ) : null}
      </ThemedText>
      <Pressable
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={required ? `${label} (required)` : label}
        accessibilityValue={
          value ? { text: displayIsoDate(value) } : undefined
        }
        style={({ pressed }) => [
          styles.inputShell,
          {
            borderColor: error
              ? theme.error
              : open
                ? theme.primary
                : theme.border,
            backgroundColor: open ? theme.background : theme.backgroundElement,
            paddingRight: Spacing.three,
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ionicons
          name="calendar-outline"
          size={19}
          color={open ? theme.primary : theme.textSecondary}
        />
        <ThemedText
          style={[styles.dateValue, !value && { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {value ? displayIsoDate(value) : placeholder}
        </ThemedText>
        {value ? (
          <Pressable
            onPress={() => onChange("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={theme.textSecondary}
            />
          </Pressable>
        ) : (
          <Ionicons
            name="chevron-down"
            size={16}
            color={theme.textSecondary}
          />
        )}
      </Pressable>
      {error ? (
        <ThemedText
          style={[styles.fieldHint, { color: theme.error }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText themeColor="textSecondary" style={styles.fieldHint}>
          {hint}
        </ThemedText>
      ) : null}
      {open && Platform.OS === "android" ? (
        <DateTimePicker
          value={parseIsoDate(value)}
          mode="date"
          display="default"
          onChange={change}
          accessibilityLabel={`${label} picker`}
          {...pickerBounds}
        />
      ) : null}
      <Modal
        visible={open && Platform.OS !== "android"}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <View style={styles.sheetRoot}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={`Close ${label} picker`}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
                paddingBottom: Spacing.three + insets.bottom,
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <ThemedText style={styles.sheetTitle}>{label}</ThemedText>
              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>
            <DateTimePicker
              value={parseIsoDate(value)}
              mode="date"
              display="spinner"
              onChange={change}
              accessibilityLabel={`${label} picker`}
              {...pickerBounds}
            />
            <View style={styles.sheetActions}>
              {value ? (
                <Pressable
                  onPress={() => {
                    onChange("");
                    close();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear ${label}`}
                  style={[styles.sheetButton, { borderColor: theme.border }]}
                >
                  <ThemedText style={styles.sheetButtonText}>Clear</ThemedText>
                </Pressable>
              ) : null}
              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel={`Done ${label}`}
                style={[
                  styles.sheetButton,
                  { backgroundColor: BrandColors.primary },
                ]}
              >
                <ThemedText
                  style={[
                    styles.sheetButtonText,
                    { color: BrandColors.white },
                  ]}
                >
                  Done
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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
  fieldHint: { fontSize: 12, lineHeight: 17 },
  dateValue: { flex: 1, fontSize: 16, lineHeight: 22 },
  sheetRoot: { flex: 1 },
  sheetBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15,14,23,0.6)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    borderTopWidth: 1,
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: { fontSize: 16, fontWeight: "800" },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.two,
  },
  sheetButton: {
    minHeight: 44,
    minWidth: 96,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
  },
  sheetButtonText: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
});
