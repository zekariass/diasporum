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
  const extraTags = item.categories.length - 2;
  const showEngagement =
    !item.canManage &&
    ((job.status === "PUBLISHED" && job.applicationsEnabled) ||
      job.contactEnabled);
  return (
    <Pressable
      onPress={() => onPress(job.id)}
      accessibilityRole="button"
      accessibilityLabel={`${job.title} at ${job.employerName}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.heading}>
        <JobLogo jobId={job.id} mediaIds={item.mediaIds} />
        <View style={styles.titleBlock}>
          <ThemedText style={styles.title} numberOfLines={2}>
            {job.title}
          </ThemedText>
          <View style={styles.employerRow}>
            <ThemedText
              style={styles.employer}
              themeColor="textSecondary"
              numberOfLines={1}
            >
              {job.employerName}
            </ThemedText>
            {job.verifiedEmployer ? (
              <Ionicons
                name="checkmark-circle"
                size={15}
                color={theme.primary}
              />
            ) : null}
          </View>
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
          <Ionicons
            name="chevron-forward"
            size={18}
            color={theme.textSecondary}
          />
        )}
      </View>
      <View style={styles.meta}>
        <Meta
          icon="location-outline"
          text={formatLocation(item.location, job.workplaceType)}
        />
        <Meta icon="briefcase-outline" text={label(job.employmentType)} />
        <Meta icon="business-outline" text={label(job.workplaceType)} />
        {job.workHoursType !== "UNSPECIFIED" ? (
          <Meta icon="time-outline" text={label(job.workHoursType)} />
        ) : null}
      </View>
      {salary ? (
        <View
          style={[styles.salaryRow, { backgroundColor: theme.primarySurface }]}
        >
          <Ionicons name="cash-outline" size={17} color={theme.primary} />
          <ThemedText style={[styles.salary, { color: theme.primary }]}>
            {salary}
          </ThemedText>
        </View>
      ) : null}
      {item.categories.length ||
      (item.canManage && job.status !== "PUBLISHED") ||
      item.myApplicationStatus ? (
        <View style={styles.tags}>
          {item.categories.slice(0, 2).map((category) => (
            <Tag key={category.id} text={category.displayName} />
          ))}
          {extraTags > 0 ? <Tag text={`+${extraTags} more`} /> : null}
          {item.canManage && job.status !== "PUBLISHED" ? (
            <Tag text={label(job.status)} />
          ) : null}
          {item.myApplicationStatus ? (
            <Tag text={`Applied: ${label(item.myApplicationStatus)}`} accent />
          ) : null}
        </View>
      ) : null}
      {showEngagement ? (
        <View style={styles.engagement}>
          {job.status === "PUBLISHED" && job.applicationsEnabled ? (
            <EngagementTag icon="paper-plane-outline" text="Apply now" />
          ) : null}
          {job.contactEnabled ? (
            <EngagementTag
              icon="chatbubble-ellipses-outline"
              text="Contact employer"
            />
          ) : null}
        </View>
      ) : null}
      {posted || deadline ? (
        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          {posted ? (
            <ThemedText
              style={styles.footerText}
              themeColor="textSecondary"
              numberOfLines={1}
            >
              {posted}
            </ThemedText>
          ) : null}
          {deadline ? (
            <View style={styles.deadline}>
              <Ionicons
                name="time-outline"
                size={13}
                color={theme.textSecondary}
              />
              <ThemedText
                style={styles.footerText}
                themeColor="textSecondary"
                numberOfLines={1}
              >
                {deadline}
              </ThemedText>
            </View>
          ) : null}
        </View>
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
    <Image
      source={{ uri: url }}
      style={styles.logo}
      accessibilityLabel="Job image"
    />
  ) : (
    <View style={[styles.logo, { backgroundColor: theme.primarySurface }]}>
      <Ionicons name="business-outline" size={22} color={theme.primary} />
    </View>
  );
}

function Meta({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={13} color={theme.textSecondary} />
      <ThemedText
        style={styles.metaText}
        themeColor="textSecondary"
        numberOfLines={1}
      >
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
            ? theme.primarySurface
            : theme.backgroundElement,
        },
      ]}
    >
      <ThemedText
        style={[styles.tagText, accent && { color: theme.primary }]}
        themeColor={accent ? undefined : "textSecondary"}
      >
        {text}
      </ThemedText>
    </View>
  );
}

function EngagementTag({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.engagementTag, { borderColor: theme.primary }]}>
      <Ionicons name={icon} size={14} color={theme.primary} />
      <ThemedText style={[styles.engagementText, { color: theme.primary }]}>
        {text}
      </ThemedText>
    </View>
  );
}

/** Placeholder card rendered while the first page loads — mirrors the real card shape. */
export function JobCardSkeleton() {
  const theme = useTheme();
  const block = {
    backgroundColor: theme.backgroundSelected,
    borderRadius: BorderRadius.sm,
  };
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      accessibilityLabel="Loading job"
    >
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
      <View
        style={[styles.skeletonLine, { width: "45%", height: 32 }, block]}
      />
      <View style={styles.tags}>
        <View style={[styles.skeletonTag, block]} />
        <View style={[styles.skeletonTag, block]} />
      </View>
      <View style={styles.engagement}>
        <View style={[styles.skeletonEngagement, block]} />
        <View style={[styles.skeletonEngagement, block]} />
      </View>
      <View style={[styles.skeletonLine, { width: "65%" }, block]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  pressed: { opacity: 0.72 },
  heading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
  },
  logo: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  titleBlock: { flex: 1, gap: 3 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "800" },
  employerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  employer: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  bookmark: { padding: Spacing.two, margin: -Spacing.two },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: "100%",
  },
  metaText: { fontSize: 12.5, lineHeight: 18, flexShrink: 1 },
  salaryRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  salary: { fontSize: 14, lineHeight: 18, fontWeight: "800" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagText: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
  engagement: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  engagementTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  engagementText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  footerText: { fontSize: 11.5, lineHeight: 16, flexShrink: 1 },
  deadline: { flexDirection: "row", alignItems: "center", gap: 4 },
  skeletonLine: { height: 12, marginVertical: 3 },
  skeletonTag: { width: 72, height: 22 },
  skeletonEngagement: {
    width: 112,
    height: 30,
    borderRadius: BorderRadius.full,
  },
});
