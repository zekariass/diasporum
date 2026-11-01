/**
 * EventCard — compact list row: date badge, title, category, location/mode,
 * participant counts and viewer's RSVP state. Tapping opens the detail screen.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { BrandColors } from '@/shared/theme/colors';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import type { EventItem, RsvpStatus } from '../types/event-types';
import { countsSummary, eventDayBadge, formatEventDate } from '../utils/event-time';

const RSVP_LABEL: Record<RsvpStatus, string> = {
  GOING: 'Going',
  INTERESTED: 'Interested',
  NOT_GOING: 'Not going',
  WAITLISTED: 'Waitlisted',
};

interface Props {
  item: EventItem;
  onPress: (eventId: string) => void;
}

export function EventCard({ item, onPress }: Props) {
  const theme = useTheme();
  const e = item.event;
  const badge = eventDayBadge(e.startsAt, e.timezone);
  const cancelled = e.cancelledAt !== null;
  const isDraft = e.status === 'DRAFT';

  return (
    <Pressable
      onPress={() => onPress(e.id)}
      accessibilityRole="button"
      accessibilityLabel={`${e.title} event, ${formatEventDate(e.startsAt, e.timezone)}`}
      style={({ pressed }) => [
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.background },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.dateBadge,
          { backgroundColor: cancelled ? theme.backgroundElement : BrandColors.primarySurface },
        ]}
        accessibilityLabel={`Starts ${badge.month} ${badge.day}`}
      >
        <ThemedText style={[styles.dateMonth, { color: BrandColors.primary }]}>
          {badge.month}
        </ThemedText>
        <ThemedText style={[styles.dateDay, { color: BrandColors.primary }]}>
          {badge.day}
        </ThemedText>
      </View>

      <View style={styles.info}>
        <View style={styles.titleRow}>
          <ThemedText style={styles.title} numberOfLines={2}>
            {e.title}
          </ThemedText>
          {item.saved && (
            <Ionicons name="bookmark" size={14} color={BrandColors.primary} />
          )}
        </View>
        <ThemedText style={styles.meta} themeColor="textSecondary" numberOfLines={1}>
          {formatEventDate(e.startsAt, e.timezone)}
          {e.eventMode === 'ONLINE_EXTERNAL' ? ' · Online' : e.locationName ? ` · ${e.locationName}` : ''}
        </ThemedText>
        <View style={styles.tagRow}>
          {item.category && (
            <View style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.tagText} themeColor="textSecondary">
                {item.category.displayName}
              </ThemedText>
            </View>
          )}
          {e.visibilityScope === 'COUNTRY' && (
            <View style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="globe-outline" size={11} color={theme.textSecondary} />
              <ThemedText style={styles.tagText} themeColor="textSecondary">
                Country-wide
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
            <View style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.tagText} themeColor="textSecondary">
                Draft
              </ThemedText>
            </View>
          )}
          {item.myRsvp && (
            <View style={[styles.tag, styles.rsvpTag]}>
              <ThemedText style={[styles.tagText, { color: BrandColors.primary }]}>
                {RSVP_LABEL[item.myRsvp]}
              </ThemedText>
            </View>
          )}
        </View>
        <ThemedText style={styles.counts} themeColor="textSecondary" numberOfLines={1}>
          {countsSummary(item.counts.going, item.counts.interested, item.counts.waitlisted)}
          {e.capacity !== null ? ` · ${e.capacity} spots` : ''}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    marginHorizontal: Spacing.four,
    marginVertical: Spacing.one + Spacing.half,
  },
  pressed: { opacity: 0.8, transform: [{ scale: 0.995 }] },
  dateBadge: {
    width: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.one + Spacing.half,
  },
  dateMonth: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  dateDay: { fontSize: 20, fontWeight: '800', marginTop: -2 },
  info: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  title: { flex: 1, fontSize: 16, fontWeight: '700', lineHeight: 21 },
  meta: { fontSize: 13, lineHeight: 18 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { fontSize: 11, fontWeight: '600' },
  cancelTag: { backgroundColor: BrandColors.errorSurface },
  rsvpTag: { backgroundColor: BrandColors.primarySurface },
  counts: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});
