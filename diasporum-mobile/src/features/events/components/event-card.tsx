/**
 * EventCard — Eventbrite-style card: cover on top, bold title with inline
 * share + save icons, date · location meta line, "Free" price line,
 * participant counts and status badges. Tapping opens the detail screen.
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
      {/* Cover — inset inside the card like the Eventbrite list */}
      <View style={styles.coverWrap}>
        <EventCover
          eventId={e.id}
          coverMediaId={e.coverMediaId}
          style={styles.cover}
        />
        {fewSpotsLeft && (
          <View style={styles.urgencyBadge}>
            <Ionicons name="flame" size={11} color="#3F6212" />
            <ThemedText style={styles.urgencyText}>Few spots left</ThemedText>
          </View>
        )}
        {e.visibilityScope === "COUNTRY" && !fewSpotsLeft && (
          <View style={styles.scopeBadge}>
            <Ionicons name="globe-outline" size={11} color={BrandColors.white} />
            <ThemedText style={styles.scopeBadgeText}>Country-wide</ThemedText>
          </View>
        )}
      </View>

      {/* Body */}
      <View style={styles.body}>
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
          {formatEventDate(e.startsAt, e.timezone)}
          {" · "}
          {isOnline ? "Online" : (e.locationName ?? "Location TBA")}
        </ThemedText>

        <ThemedText style={styles.price}>Free</ThemedText>

        <ThemedText
          style={styles.counts}
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

        {(item.category || cancelled || isDraft || item.myRsvp) && (
          <View style={styles.tagRow}>
            {item.category && (
              <View style={[styles.tag, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText style={styles.tagText} themeColor="textSecondary">
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
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.one,
    marginVertical: Spacing.two,
    padding: Spacing.two,
    shadowColor: BrandColors.black,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  coverWrap: { position: "relative" },
  cover: { aspectRatio: 16 / 9, borderRadius: BorderRadius.md },
  urgencyBadge: {
    position: "absolute",
    top: Spacing.two,
    left: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: BorderRadius.sm,
    backgroundColor: "#D9F99D",
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
  },
  urgencyText: {
    color: "#3F6212",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  scopeBadge: {
    position: "absolute",
    top: Spacing.two,
    left: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: BorderRadius.sm,
    backgroundColor: "rgba(17,24,39,0.72)",
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
  },
  scopeBadgeText: { color: BrandColors.white, fontSize: 10, fontWeight: "700" },
  body: { padding: Spacing.two, paddingBottom: Spacing.one, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two },
  title: { flex: 1, fontSize: 17, fontWeight: "800", lineHeight: 22 },
  titleActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingTop: 2,
  },
  meta: { fontSize: 13, lineHeight: 18 },
  price: { fontSize: 14, fontWeight: "800" },
  counts: { fontSize: 12, lineHeight: 16 },
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
