/**
 * EventCard — compact horizontal card: cover thumbnail on the left, bold
 * title with inline share + save icons, date · location meta line, "Free"
 * price line, participant counts and status badges on the right. Tapping
 * opens the detail screen.
 */

import React from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { EventItem, RsvpStatus } from "../types/event-types";
import { countsSummary, formatEventDate } from "../utils/event-time";
import { EventCover } from "./event-cover";

const RSVP_LABEL: Record<RsvpStatus, string> = {
  GOING: "Going",
  INTERESTED: "Interested",
  NOT_GOING: "Not going",
  WAITLISTED: "Waitlisted",
};

interface Props {
  item: EventItem;
  onPress: (eventId: string) => void;
  /** Called with the desired new saved state; parent owns the mutation. */
  onToggleSave?: (eventId: string, saved: boolean) => void;
}

export function EventCard({ item, onPress, onToggleSave }: Props) {
  const theme = useTheme();
  const e = item.event;
  const cancelled = e.cancelledAt !== null;
  const isDraft = e.status === "DRAFT";
  const isOnline = e.eventMode === "ONLINE_EXTERNAL";

  // "Few spots left" urgency badge — event has a capacity and is nearly
  // full or already waitlisting.
  const fewSpotsLeft =
    !cancelled &&
    e.capacity !== null &&
    e.capacity > 0 &&
    (item.counts.waitlisted > 0 || item.counts.going / e.capacity >= 0.8);

  const shareEvent = async () => {
    try {
      await Share.share({
        message: `${e.title} — ${formatEventDate(e.startsAt, e.timezone)}\ndiasporummobile://events/${e.id}`,
      });
    } catch {
      // User dismissed the sheet — not an error.
    }
  };

  return (
    <Pressable
      onPress={() => onPress(e.id)}
      accessibilityRole="button"
      accessibilityLabel={`${e.title} event, ${formatEventDate(e.startsAt, e.timezone)}`}
      style={({ pressed }) => [
        styles.card,
        {
          borderColor: theme.border,
          backgroundColor: theme.backgroundElement,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      {/* Cover thumbnail — left column, fills the card height */}
      <View style={styles.coverWrap}>
        <EventCover
          eventId={e.id}
          coverMediaId={e.coverMediaId}
          style={styles.cover}
        />
        {fewSpotsLeft && (
          <View style={styles.urgencyBadge}>
            <Ionicons name="flame" size={10} color="#3F6212" />
            <ThemedText style={styles.urgencyText}>Few spots left</ThemedText>
          </View>
        )}
        {e.visibilityScope === "COUNTRY" && !fewSpotsLeft && (
          <View style={styles.scopeBadge}>
            <Ionicons name="globe-outline" size={10} color={BrandColors.white} />
            <ThemedText style={styles.scopeBadgeText}>Country-wide</ThemedText>
          </View>
        )}
      </View>

      {/* Body — right column */}
      <View style={styles.body}>
        <ThemedText style={styles.date} numberOfLines={1}>
          {formatEventDate(e.startsAt, e.timezone)}
        </ThemedText>

        <View style={styles.titleRow}>
          <ThemedText style={styles.title} numberOfLines={2}>
            {e.title}
          </ThemedText>
          <View style={styles.titleActions}>
            <Pressable
              onPress={() => void shareEvent()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Share event"
            >
              <Ionicons
                name="share-social-outline"
                size={20}
                color={theme.text}
              />
            </Pressable>
            <Pressable
              onPress={() => onToggleSave?.(e.id, !item.saved)}
              disabled={!onToggleSave}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                item.saved ? "Remove from saved events" : "Save event"
              }
            >
              <Ionicons
                name={item.saved ? "heart" : "heart-outline"}
                size={20}
                color={item.saved ? BrandColors.primary : theme.text}
              />
            </Pressable>
          </View>
        </View>

        <ThemedText
          style={styles.meta}
          themeColor="textSecondary"
          numberOfLines={1}
        >
          {isOnline ? "Online" : (e.locationName ?? "Location TBA")}
        </ThemedText>

        <View style={styles.footRow}>
          <ThemedText style={styles.footPrice}>Free</ThemedText>
          <ThemedText style={styles.foot} themeColor="textSecondary">
            ·
          </ThemedText>
          <ThemedText
            style={[styles.foot, styles.footCounts]}
            themeColor="textSecondary"
            numberOfLines={1}
          >
            {countsSummary(
              item.counts.going,
              item.counts.interested,
              item.counts.waitlisted,
            )}
            {e.capacity !== null ? ` · ${e.capacity} spots` : ""}
          </ThemedText>
        </View>

        {(item.category || cancelled || isDraft || item.myRsvp) && (
          <View style={styles.tagRow}>
            {item.category && (
              <View style={[styles.tag, { backgroundColor: theme.primarySurface }]}>
                <ThemedText style={[styles.tagText, { color: theme.primary }]}>
                  {item.category.displayName}
                </ThemedText>
              </View>
            )}
            {cancelled && (
              <View style={[styles.tag, styles.cancelTag]}>
                <ThemedText style={[styles.tagText, { color: BrandColors.error }]}>
                  Cancelled
                </ThemedText>
              </View>
            )}
            {isDraft && (
              <View style={[styles.tag, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText style={styles.tagText} themeColor="textSecondary">
                  Draft
                </ThemedText>
              </View>
            )}
            {item.myRsvp && !cancelled && (
              <View style={[styles.tag, styles.rsvpTag]}>
                <ThemedText style={[styles.tagText, { color: BrandColors.primary }]}>
                  {RSVP_LABEL[item.myRsvp]}
                </ThemedText>
              </View>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.one,
    marginVertical: Spacing.two,
    padding: Spacing.two,
    shadowColor: BrandColors.black,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  coverWrap: { position: "relative", width: 116, minHeight: 104 },
  cover: {
    width: "100%",
    height: "100%",
    aspectRatio: undefined,
    borderRadius: BorderRadius.md,
  },
  urgencyBadge: {
    position: "absolute",
    top: Spacing.one,
    left: Spacing.one,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: BorderRadius.sm,
    backgroundColor: "#D9F99D",
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  urgencyText: {
    color: "#3F6212",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  scopeBadge: {
    position: "absolute",
    top: Spacing.one,
    left: Spacing.one,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: BorderRadius.sm,
    backgroundColor: "rgba(17,24,39,0.72)",
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  scopeBadgeText: { color: BrandColors.white, fontSize: 9, fontWeight: "700" },
  body: { flex: 1, gap: 3 },
  date: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 15,
    color: BrandColors.primary,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two },
  title: { flex: 1, fontSize: 16, fontWeight: "800", lineHeight: 21 },
  titleActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 2,
  },
  meta: { fontSize: 13, lineHeight: 18 },
  footRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  foot: { fontSize: 12, lineHeight: 16 },
  footPrice: { fontSize: 12, fontWeight: "800", lineHeight: 16 },
  footCounts: { flexShrink: 1 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { fontSize: 11, fontWeight: "600" },
  cancelTag: { backgroundColor: BrandColors.errorSurface },
  rsvpTag: { backgroundColor: BrandColors.primarySurface },
});
