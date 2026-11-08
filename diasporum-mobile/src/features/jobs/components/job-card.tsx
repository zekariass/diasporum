import React, { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createJobApi } from "../services/job-api";
import type { JobItem } from "../types/job-types";
import {
  formatDeadline,
  formatLocation,
  formatPosted,
  formatSalary,
  label,
} from "../utils/job-format";

export function JobCard({
  item,
  onPress,
  onToggleSave,
}: {
  item: JobItem;
  onPress: (jobId: string) => void;
  onToggleSave?: (item: JobItem) => void;
}) {
  const theme = useTheme();
  const job = item.job;
  const salary = formatSalary(job);
  const deadline = formatDeadline(job.closesAt);
  const posted = formatPosted(job.publishedAt ?? job.createdAt);
  const extraTags = item.categories.length - 3;
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
        <JobLogo jobId={job.id} mediaIds={item.mediaIds} />
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
        {onToggleSave ? (
          <Pressable
            onPress={() => onToggleSave(item)}
            accessibilityRole="button"
            accessibilityLabel={item.saved ? "Unsave job" : "Save job"}
            hitSlop={8}
            style={styles.bookmark}
          >
            <Ionicons
              name={item.saved ? "bookmark" : "bookmark-outline"}
              size={20}
              color={item.saved ? BrandColors.primary : theme.textSecondary}
            />
          </Pressable>
        ) : item.saved ? (
          <Ionicons name="bookmark" size={18} color={BrandColors.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
        )}
      </View>
      <View style={styles.meta}>
        <Meta icon="location-outline" text={formatLocation(item.location, job.workplaceType)} />
        <Meta icon="briefcase-outline" text={label(job.employmentType)} />
        <Meta icon="business-outline" text={label(job.workplaceType)} />
        {job.workHoursType !== "UNSPECIFIED" ? (
          <Meta icon="time-outline" text={label(job.workHoursType)} />
        ) : null}
      </View>
      {salary ? <ThemedText style={styles.salary}>{salary}</ThemedText> : null}
      {item.categories.length || job.status !== "PUBLISHED" || item.myApplicationStatus ? (
        <View style={styles.tags}>
          {item.categories.slice(0, 3).map((category) => (
            <Tag key={category.id} text={category.displayName} />
          ))}
          {extraTags > 0 ? <Tag text={`+${extraTags} more`} /> : null}
          {job.status !== "PUBLISHED" ? <Tag text={label(job.status)} /> : null}
          {item.myApplicationStatus ? (
            <Tag text={`Applied: ${label(item.myApplicationStatus)}`} accent />
          ) : null}
        </View>
      ) : null}
      {posted || deadline ? (
        <ThemedText style={styles.footer} themeColor="textSecondary">
          {[posted, deadline].filter(Boolean).join("  ·  ")}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

/** Square job-image thumbnail; falls back to a building icon when the job has no media. */
function JobLogo({ jobId, mediaIds }: { jobId: string; mediaIds: string[] }) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const mediaId = mediaIds[0];
    if (!mediaId) return;
    let active = true;
    createJobApi(apiClient)
      .mediaDownloadUrl(jobId, mediaId)
      .then((response) => {
        if (active) setUrl(response.downloadUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiClient, jobId, mediaIds]);
  return url ? (
    <Image source={{ uri: url }} style={styles.logo} accessibilityLabel="Job image" />
  ) : (
    <View style={[styles.logo, { backgroundColor: theme.primarySurface }]}>
      <Ionicons name="business-outline" size={22} color={theme.primary} />
    </View>
  );
}

function Meta({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={13} color={theme.textSecondary} />
      <ThemedText style={styles.metaText} themeColor="textSecondary" numberOfLines={1}>
        {text}
      </ThemedText>
    </View>
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

/** Placeholder card rendered while the first page loads — mirrors the real card shape. */
export function JobCardSkeleton() {
  const theme = useTheme();
  const block = { backgroundColor: theme.backgroundElement, borderRadius: BorderRadius.sm };
  return (
    <View style={[styles.card, { borderColor: theme.border }]} accessibilityLabel="Loading job">
      <View style={styles.heading}>
        <View style={[styles.logo, block]} />
        <View style={styles.titleBlock}>
          <View style={[styles.skeletonLine, { width: "75%" }, block]} />
          <View style={[styles.skeletonLine, { width: "45%" }, block]} />
        </View>
      </View>
      <View style={styles.meta}>
        <View style={[styles.skeletonLine, { width: 84 }, block]} />
        <View style={[styles.skeletonLine, { width: 64 }, block]} />
        <View style={[styles.skeletonLine, { width: 56 }, block]} />
      </View>
      <View style={[styles.skeletonLine, { width: "40%" }, block]} />
      <View style={styles.tags}>
        <View style={[styles.skeletonTag, block]} />
        <View style={[styles.skeletonTag, block]} />
        <View style={[styles.skeletonTag, block]} />
      </View>
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
  logo: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  titleBlock: { flex: 1 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "700" },
  employer: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  bookmark: { padding: Spacing.one },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: Spacing.two },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12.5 },
  salary: { fontSize: 15, fontWeight: "700", color: BrandColors.primary },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagText: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
  footer: { fontSize: 12 },
  skeletonLine: { height: 12, marginVertical: 3 },
  skeletonTag: { width: 72, height: 22 },
});
