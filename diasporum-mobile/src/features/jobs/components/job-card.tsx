import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { JobItem } from "../types/job-types";
import {
  formatDeadline,
  formatLocation,
  formatSalary,
  label,
} from "../utils/job-format";

export function JobCard({
  item,
  onPress,
}: {
  item: JobItem;
  onPress: (jobId: string) => void;
}) {
  const theme = useTheme();
  const job = item.job;
  const salary = formatSalary(job);
  const deadline = formatDeadline(job.closesAt);
  return (
    <Pressable
      onPress={() => onPress(job.id)}
      accessibilityRole="button"
      accessibilityLabel={`${job.title} at ${job.employerName}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.background, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.heading}>
        <View
          style={[styles.icon, { backgroundColor: BrandColors.primarySurface }]}
        >
          <Ionicons
            name="briefcase-outline"
            size={22}
            color={BrandColors.primary}
          />
        </View>
        <View style={styles.titleBlock}>
          <ThemedText style={styles.title} numberOfLines={2}>
            {job.title}
          </ThemedText>
          <ThemedText
            style={styles.employer}
            themeColor="textSecondary"
            numberOfLines={1}
          >
            {job.employerName}
          </ThemedText>
        </View>
        {item.saved ? (
          <Ionicons name="bookmark" size={18} color={BrandColors.primary} />
        ) : (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={theme.textSecondary}
          />
        )}
      </View>
      <View style={styles.metaRow}>
        <Ionicons
          name="location-outline"
          size={14}
          color={theme.textSecondary}
        />
        <ThemedText
          style={styles.meta}
          themeColor="textSecondary"
          numberOfLines={1}
        >
          {formatLocation(item.location, job.workplaceType)}
        </ThemedText>
      </View>
      {salary ? (
        <ThemedText style={styles.salary}>{salary}</ThemedText>
      ) : null}
      <View style={styles.tags}>
        {item.categories.slice(0, 2).map((category) => (
          <Tag key={category.id} text={category.displayName} />
        ))}
        <Tag text={label(job.employmentType)} />
        {job.status !== "PUBLISHED" ? <Tag text={label(job.status)} /> : null}
        {item.myApplicationStatus ? (
          <Tag text={`Applied: ${label(item.myApplicationStatus)}`} accent />
        ) : null}
      </View>
      {deadline ? (
        <ThemedText style={styles.deadline} themeColor="textSecondary">
          {deadline}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

function Tag({ text, accent = false }: { text: string; accent?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: accent
            ? BrandColors.primarySurface
            : theme.backgroundElement,
        },
      ]}
    >
      <ThemedText
        style={[styles.tagText, accent && { color: BrandColors.primary }]}
        themeColor={accent ? undefined : "textSecondary"}
      >
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.four,
    marginVertical: Spacing.one,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  pressed: { opacity: 0.78 },
  heading: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: { flex: 1 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "700" },
  employer: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  meta: { flex: 1, fontSize: 13 },
  salary: { fontSize: 14, fontWeight: "700", color: BrandColors.primary },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagText: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
  deadline: { fontSize: 12 },
});
