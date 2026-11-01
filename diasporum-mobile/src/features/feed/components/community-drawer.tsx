/**
 * CommunityDrawer — right-side drawer opened from the header's menu icon.
 * Slides in/out with an animated panel + fading backdrop.
 * Sections: current community · communities to join (origin match) ·
 * manage footer with safe-area padding.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Modal, Pressable, ScrollView,
  StyleSheet, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { createFeedApi } from '../services/feed-api';
import { useSession } from '@/core/session/session-provider';
import type { CommunityDetail } from '../types/feed-types';

interface Props { visible: boolean; onClose: () => void }

const PANEL_WIDTH = 320;

export function CommunityDrawer({ visible, onClose }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, apiClient, setActiveCommunity, joinCommunity } = useSession();
  const api = useMemo(() => createFeedApi(apiClient), [apiClient]);
  const activeId = session?.activeCommunityId;

  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(PANEL_WIDTH)).current;

  const [current, setCurrent] = useState<CommunityDetail | null>(null);
  const [currentCount, setCurrentCount] = useState<number | null>(null);
  const [joinable, setJoinable] = useState<CommunityDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Slide in / out
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(slide, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    } else {
      Animated.timing(slide, { toValue: PANEL_WIDTH, duration: 220, useNativeDriver: true })
        .start(() => setMounted(false));
    }
  }, [visible, slide]);

  // Data — reload when opened or membership/community changes
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const joined = new Set((session?.memberships ?? []).map(m => m.communityId));
      const [detail, count, avail] = await Promise.all([
        activeId ? api.communityDetail(activeId).catch(() => null) : Promise.resolve(null),
        activeId ? api.memberCount(activeId).catch(() => null) : Promise.resolve(null),
        api.availableCommunities().catch(() => ({ items: [] as CommunityDetail[] })),
      ]);
      if (cancelled) return;
      setCurrent(detail);
      setCurrentCount(count?.total ?? null);
      setJoinable(avail.items.filter(c => !joined.has(c.id) && c.id !== activeId));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visible, activeId, session?.memberships, api]);

  const pick = async (c: CommunityDetail) => {
    onClose();
    if (c.id === activeId) return;
    setJoiningId(c.id);
    try {
      const joined = (session?.memberships ?? []).some(m => m.communityId === c.id);
      if (!joined) await joinCommunity(c.id);
      await setActiveCommunity(c.id);
    } finally { setJoiningId(null); }
  };

  const backdropOpacity = slide.interpolate({ inputRange: [0, PANEL_WIDTH], outputRange: [1, 0] });
  const membersLabel = currentCount != null
    ? `${currentCount >= 1000 ? `${(currentCount / 1000).toFixed(1)}K` : currentCount} members`
    : '';

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.backdropTouch, { opacity: backdropOpacity }]}>
          <Pressable style={styles.backdropInner} onPress={onClose} accessibilityLabel="Close drawer" />
        </Animated.View>

        <Animated.View style={[
          styles.panel,
          { backgroundColor: theme.background, borderLeftColor: theme.border, paddingTop: insets.top },
          { transform: [{ translateX: slide }] },
        ]}>
          {/* Header */}
          <View style={styles.head}>
            <ThemedText style={styles.headTitle}>Communities</ThemedText>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close drawer">
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {loading ? <ActivityIndicator style={styles.loader} color={theme.textSecondary} /> : null}

            {/* Current community */}
            {current ? (
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle} themeColor="textSecondary">CURRENT</ThemedText>
                <View style={[styles.card, { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary }]}>
                  <View style={[styles.cardIcon, { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
                    <Ionicons name="people" size={16} color="#FFF" />
                  </View>
                  <View style={styles.cardText}>
                    <ThemedText style={[styles.cardName, { color: '#FFF' }]} numberOfLines={2}>{current.name}</ThemedText>
                    {membersLabel ? (
                      <ThemedText style={[styles.cardMeta, { color: 'rgba(255,255,255,0.85)' }]}>{membersLabel}</ThemedText>
                    ) : null}
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                </View>
              </View>
            ) : null}

            {/* Joinable communities (origin match, not yet joined) */}
            {joinable.length > 0 ? (
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle} themeColor="textSecondary">COMMUNITIES YOU CAN JOIN</ThemedText>
                {joinable.map(c => (
                  <Pressable
                    key={c.id}
                    onPress={() => void pick(c)}
                    style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Join ${c.name}`}>
                    <View style={[styles.cardIcon, { backgroundColor: theme.textSecondary }]}>
                      <Ionicons name="earth" size={16} color={theme.background} />
                    </View>
                    <View style={styles.cardText}>
                      <ThemedText style={styles.cardName} numberOfLines={2}>{c.name}</ThemedText>
                      {c.description ? (
                        <ThemedText style={styles.cardDesc} themeColor="textSecondary" numberOfLines={1}>{c.description}</ThemedText>
                      ) : null}
                    </View>
                    {joiningId === c.id
                      ? <ActivityIndicator size="small" color={BrandColors.primary} />
                      : <Ionicons name="add-circle-outline" size={22} color={BrandColors.primary} />}
                  </Pressable>
                ))}
              </View>
            ) : null}

            {!loading && !current && joinable.length === 0 ? (
              <ThemedText style={styles.none} themeColor="textSecondary">No communities yet.</ThemedText>
            ) : null}
          </ScrollView>

          {/* Footer — padded for the system nav bar */}
          <Pressable
            onPress={() => { onClose(); router.push('/(app)/(tabs)/communities' as never); }}
            style={[styles.manage, { borderTopColor: theme.border, paddingBottom: Spacing.four + insets.bottom }]}
            accessibilityRole="button"
            accessibilityLabel="Manage communities">
            <Ionicons name="settings-outline" size={18} color={theme.text} />
            <ThemedText style={styles.manageText}>Manage communities</ThemedText>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdropTouch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  backdropInner: { flex: 1 },
  panel: {
    width: PANEL_WIDTH, maxWidth: '85%', height: '100%',
    borderLeftWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: -4, height: 0 }, elevation: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.three },
  headTitle: { fontSize: 20, fontWeight: '800' },
  list: { flex: 1 },
  loader: { marginTop: Spacing.four },
  section: { marginBottom: Spacing.four },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: Spacing.four, marginBottom: Spacing.two },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginHorizontal: Spacing.four, marginBottom: Spacing.two, padding: Spacing.three, borderRadius: 14, borderWidth: 1 },
  cardIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  cardMeta: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  cardDesc: { fontSize: 12, marginTop: 1 },
  none: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  manage: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  manageText: { fontSize: 14, fontWeight: '600' },
});
