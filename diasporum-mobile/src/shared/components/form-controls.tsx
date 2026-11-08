/**
 * Shared form controls for multi-step editor flows (labelled inputs, chips,
 * segmented controls, native date entry, progress, cards, review rows).
 */
import React, { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {children}
      {hint ? <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText> : null}
    </View>
  );
}

export function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
  maxLength,
  autoCapitalize = "sentences",
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  maxLength?: number;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  hint?: string;
}) {
  const theme = useTheme();
  return (
    <Field label={label} hint={hint}>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        keyboardType={keyboardType}
        multiline={multiline}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        style={[styles.input, multiline && styles.multiline, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]}
      />
    </Field>
  );
}

export function ChoiceChip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? theme.primary : theme.border, backgroundColor: selected ? theme.primarySurface : theme.background }]}
    >
      {icon ? <Ionicons name={icon} size={16} color={selected ? theme.primary : theme.textSecondary} /> : null}
      <ThemedText type="smallBold" style={{ color: selected ? theme.primary : theme.text }}>{label}</ThemedText>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({ label, values, value, onChange }: {
  label: string;
  values: readonly { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <Field label={label}>
      <View style={[styles.segment, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        {values.map((item) => {
          const selected = item.value === value;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              onPress={() => onChange(item.value)}
              style={[styles.segmentItem, selected && { backgroundColor: theme.background }]}
            >
              {item.icon ? <Ionicons name={item.icon} size={17} color={selected ? theme.primary : theme.textSecondary} /> : null}
              <ThemedText type="smallBold" style={{ color: selected ? theme.primary : theme.textSecondary }}>{item.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

export function StepProgress({ step, titles }: { step: number; titles: readonly string[] }) {
  const theme = useTheme();
  return (
    <View style={styles.progress} accessibilityLabel={`Step ${step + 1} of ${titles.length}: ${titles[step]}`}>
      <View style={styles.progressCopy}>
        <ThemedText type="smallBold" style={{ color: theme.primary }}>Step {step + 1} of {titles.length}</ThemedText>
      </View>
      <View style={styles.progressTrack}>
        {titles.map((title, index) => (
          <View key={title} style={[styles.progressSegment, { backgroundColor: index <= step ? theme.primary : theme.backgroundSelected }]} />
        ))}
      </View>
    </View>
  );
}

function asDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function DateField({ label, value, onChange, optional = false }: { label: string; value: string; onChange: (value: string) => void; optional?: boolean }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  function change(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setOpen(false);
    if (event.type === "set" && date) onChange(isoDate(date));
  }
  return (
    <Field label={label}>
      <View style={[styles.dateInput, { borderColor: theme.border, backgroundColor: theme.background }]}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={optional ? "YYYY-MM-DD (optional)" : "YYYY-MM-DD"}
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          style={[styles.dateText, { color: theme.text }]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={`Choose ${label}`} onPress={() => setOpen(true)} style={styles.calendarButton}>
          <Ionicons name="calendar-outline" size={20} color={theme.primary} />
        </Pressable>
      </View>
      {open && Platform.OS === "android" ? (
        <DateTimePicker value={asDate(value)} mode="date" display="default" onChange={change} accessibilityLabel={`${label} picker`} />
      ) : null}
      <Modal visible={open && Platform.OS !== "android"} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dateBackdrop} onPress={() => setOpen(false)}>
          <Pressable onPress={() => undefined} style={[styles.dateCard, { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold">{label}</ThemedText>
            <DateTimePicker value={asDate(value)} mode="date" display="spinner" onChange={change} accessibilityLabel={`${label} picker`} />
            <Pressable accessibilityRole="button" accessibilityLabel={`Done ${label}`} onPress={() => setOpen(false)} style={[styles.doneButton, { backgroundColor: theme.primary }]}>
              <ThemedText type="smallBold" style={{ color: "#fff" }}>Done</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Field>
  );
}

export function SurfaceCard({ children, style }: { children: React.ReactNode; style?: object }) {
  const theme = useTheme();
  return <View style={[styles.surface, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, style]}>{children}</View>;
}

export function DetailRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={19} color={theme.primary} />
      <View style={styles.detailCopy}>
        <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
        <ThemedText type="smallBold">{value}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  input: { minHeight: 52, borderWidth: 1, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  multiline: { minHeight: 112, textAlignVertical: "top" },
  chip: { flexDirection: "row", alignItems: "center", gap: Spacing.one, borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  segment: { flexDirection: "row", borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.one, gap: Spacing.one },
  segmentItem: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.one, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.two },
  progress: { gap: Spacing.two },
  progressCopy: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Spacing.two },
  progressTrack: { flexDirection: "row", gap: Spacing.one },
  progressSegment: { height: 4, flex: 1, borderRadius: BorderRadius.full },
  dateInput: { minHeight: 52, flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: BorderRadius.md, paddingLeft: Spacing.three },
  dateText: { flex: 1, fontSize: 16, paddingVertical: Spacing.two },
  calendarButton: { alignSelf: "stretch", width: 50, alignItems: "center", justifyContent: "center" },
  dateBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: Spacing.four },
  dateCard: { width: "100%", maxWidth: 380, borderRadius: BorderRadius.xl, padding: Spacing.three, gap: Spacing.two },
  doneButton: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: BorderRadius.md },
  surface: { borderWidth: StyleSheet.hairlineWidth, borderRadius: BorderRadius.lg, padding: Spacing.three, gap: Spacing.three },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two },
  detailCopy: { flex: 1, gap: 2 },
});
