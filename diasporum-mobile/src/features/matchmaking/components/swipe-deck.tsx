/**
 * SwipeDeck — an immersive card deck with the active profile's details beneath it.
 * Horizontal drags own the card; vertical drags remain with the surrounding ScrollView.
 */

import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import {
  ACTIVITY_LEVELS,
  EDUCATION,
  INTENTIONS,
  optionLabel,
} from "../types/matchmaking-options";
import type {
  PublicMatchmakingProfile,
  SwipeAction,
} from "../types/matchmaking-types";
import { ProfileDetails } from "./candidate-profile";
import { SafetySheet } from "./matchmaking-ui";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";

const SWIPE_FRACTION = 0.28;
const VELOCITY_FLING = 0.7;

/** Pulsing caret that hints the active card's details continue below. */
function ScrollHintChevron() {
  const theme = useTheme();
  const [drift] = React.useState(() => new Animated.Value(0));
  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [drift]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        opacity: drift.interpolate({
          inputRange: [0, 1],
          outputRange: [0.45, 1],
        }),
        transform: [
          {
            translateY: drift.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 7],
            }),
          },
        ],
      }}
    >
      <Ionicons name="chevron-down" size={24} color={theme.textSecondary} />
    </Animated.View>
  );
}

function DeckCardContent({ profile }: { profile: PublicMatchmakingProfile }) {
  const theme = useTheme();
  const [failedPhoto, setFailedPhoto] = React.useState<string | null>(null);
  const intention = optionLabel(profile.relationshipIntention, INTENTIONS, "");
  const chips = [
    ...new Set([
      intention,
      profile.occupation,
      ...(profile.interests ?? []).slice(0, 2),
      optionLabel(profile.educationLevel, EDUCATION, ""),
      optionLabel(profile.activityLevel, ACTIVITY_LEVELS, ""),
      profile.heightCm ? `${profile.heightCm} cm` : null,
    ]),
  ]
    .filter(
      (chip): chip is string =>
        Boolean(chip) &&
        chip !== "Prefer not to say" &&
        chip !== "Not specified",
    )
    .slice(0, 3);

  return (
    <View
      style={[
        styles.cardInner,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      {profile.photoUrl && failedPhoto !== profile.photoUrl ? (
        <Image
          source={{ uri: profile.photoUrl }}
          style={styles.cardPhoto}
          contentFit="cover"
          onError={() => setFailedPhoto(profile.photoUrl)}
          transition={180}
          cachePolicy="memory-disk"
          accessibilityLabel={`${profile.displayName} profile photo`}
        />
      ) : (
        <View
          style={[
            styles.cardPhoto,
            styles.photoFallback,
            { backgroundColor: theme.primarySurface },
          ]}
          accessibilityLabel={`${profile.displayName} photo hidden`}
        >
          <View
            style={[
              styles.fallbackIcon,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <Ionicons name="person" size={72} color={theme.primary} />
          </View>
          <ThemedText themeColor="textSecondary">Photo kept private</ThemedText>
        </View>
      )}
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.48)", "rgba(0,0,0,0.94)"]}
        locations={[0, 0.5, 1]}
        style={styles.cardScrim}
        pointerEvents="none"
      />
      <View style={styles.cardInfo} pointerEvents="none">
        <View style={styles.nameRow}>
          <ThemedText style={styles.cardName} numberOfLines={1}>
            {profile.displayName}
            {profile.age ? `, ${profile.age}` : ""}
          </ThemedText>
          {profile.verificationStatus === "VERIFIED" ? (
            <Ionicons
              name="checkmark-circle"
              size={23}
              color="#67E8F9"
              accessibilityLabel="Verified"
            />
          ) : null}
        </View>
        {profile.publicLocation ? (
          <View style={styles.locationRow}>
            <Ionicons
              name="location-sharp"
              size={15}
              color="rgba(255,255,255,0.88)"
            />
            <ThemedText style={styles.cardSub} numberOfLines={1}>
              {profile.publicLocation}
            </ThemedText>
          </View>
        ) : null}
        {chips.length ? (
          <View style={styles.chipRow}>
            {chips.map((chip) => (
              <View key={chip} style={styles.chip}>
                <ThemedText style={styles.chipText} numberOfLines={1}>
                  {chip}
                </ThemedText>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function SwipeDeck({
  items,
  acting,
  onSwipe,
  onBlocked,
  empty,
}: {
  items: PublicMatchmakingProfile[];
  acting: boolean;
  onSwipe: (
    profile: PublicMatchmakingProfile,
    action: SwipeAction,
  ) => Promise<void> | void;
  /** Called after a member is blocked so the card leaves the deck. */
  onBlocked?: (profile: PublicMatchmakingProfile) => void;
  empty?: React.ReactNode;
}) {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const [safetyOpen, setSafetyOpen] = React.useState(false);
  const { width, height } = useWindowDimensions();
  const threshold = width * SWIPE_FRACTION;
  const topItem = items[0];
  const nextItem = items[1];
  const cardHeight = Math.min(610, Math.max(430, height * 0.64));
  const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);

  const [position] = React.useState(() => new Animated.ValueXY());
  const flyingRef = React.useRef(false);
  const [flying, setFlying] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      position.stopAnimation();
    };
  }, [position]);
  const latest = React.useRef({ topItem, acting, onSwipe, threshold, width });

  React.useEffect(() => {
    latest.current = { topItem, acting, onSwipe, threshold, width };
  });
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [topItem?.userId]);

  const openProfile = React.useCallback(() => {
    const target = latest.current.topItem;
    if (target) {
      router.push(`/(app)/matchmaking/profile/${target.userId}` as never);
    }
  }, []);

  const fly = React.useCallback(
    (direction: 1 | -1) => {
      const {
        topItem: target,
        acting: busy,
        onSwipe: send,
        width: w,
      } = latest.current;
      if (!target || busy || flyingRef.current) return;
      flyingRef.current = true;
      setFlying(true);
      Animated.timing(position, {
        toValue: { x: direction * (w + 160), y: 24 },
        duration: 230,
        useNativeDriver: true,
      }).start(({ finished }) => {
        void (async () => {
          try {
            if (
              finished &&
              mounted.current &&
              latest.current.topItem?.userId === target.userId
            ) {
              await send(target, direction === 1 ? "LIKE" : "PASS");
            }
          } finally {
            flyingRef.current = false;
            position.setValue({ x: 0, y: 0 });
            if (mounted.current) setFlying(false);
          }
        })();
      });
    },
    [position],
  );

  const shouldMove = React.useCallback(
    (_e: unknown, g: { dx: number; dy: number }) =>
      !latest.current.acting &&
      !flyingRef.current &&
      Math.abs(g.dx) > 10 &&
      Math.abs(g.dx) > Math.abs(g.dy) * 1.3,
    [],
  );
  const onMove = useMemo(
    () =>
      Animated.event([null, { dx: position.x, dy: position.y }], {
        useNativeDriver: false,
      }),
    [position],
  );
  const onRelease = React.useCallback(
    (_e: unknown, g: { dx: number; vx: number }) => {
      const t = latest.current.threshold;
      if (g.dx > t || (g.dx > 20 && g.vx > VELOCITY_FLING)) {
        fly(1);
      } else if (g.dx < -t || (g.dx < -20 && g.vx < -VELOCITY_FLING)) {
        fly(-1);
      } else {
        Animated.spring(position, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
          friction: 6,
          tension: 60,
        }).start();
      }
    },
    [fly, position],
  );

  const responder = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- handlers read latest.current only at event time
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: shouldMove,
        onPanResponderMove: onMove,
        onPanResponderRelease: onRelease,
        onPanResponderTerminate: () => {
          if (!flyingRef.current) position.setValue({ x: 0, y: 0 });
        },
      }),
    [shouldMove, onMove, onRelease, position],
  );

  const rotate = position.x.interpolate({
    inputRange: [-width / 2, 0, width / 2],
    outputRange: ["-10deg", "0deg", "10deg"],
    extrapolate: "clamp",
  });
  const likeOpacity = position.x.interpolate({
    inputRange: [0, threshold * 0.35, threshold],
    outputRange: [0, 0.4, 1],
    extrapolate: "clamp",
  });
  const passOpacity = position.x.interpolate({
    inputRange: [-threshold, -threshold * 0.35, 0],
    outputRange: [1, 0.4, 0],
    extrapolate: "clamp",
  });
  const deckProgress = position.x.interpolate({
    inputRange: [-threshold, 0, threshold],
    outputRange: [1, 0, 1],
    extrapolate: "clamp",
  });
  const nextScale = deckProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1],
  });
  const nextTranslateY = deckProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
  });
  const nextOpacity = deckProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });

  if (!topItem) return <View style={styles.deck}>{empty}</View>;

  return (
    <>
      <ScrollView
      ref={scrollRef}
      style={styles.deck}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.deckArea, { height: cardHeight }]}>
        {nextItem ? (
          <Animated.View
            style={[
              styles.cardSlot,
              {
                opacity: nextOpacity,
                transform: [
                  { scale: nextScale },
                  { translateY: nextTranslateY },
                ],
              },
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <DeckCardContent profile={nextItem} />
          </Animated.View>
        ) : null}
        <Animated.View
          {...responder.panHandlers}
          style={[
            styles.cardSlot,
            {
              transform: [
                { translateX: position.x },
                { translateY: position.y },
                { rotate },
              ],
            },
          ]}
        >
          <Pressable
            style={styles.cardPressable}
            disabled={acting || flying}
            onPress={openProfile}
            accessibilityRole="button"
            accessibilityLabel={`View ${topItem.displayName}'s profile`}
          >
            <DeckCardContent profile={topItem} />
          </Pressable>
          <Pressable
            onPress={() => setSafetyOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Safety options for ${topItem.displayName}`}
            hitSlop={8}
            style={({ pressed }) => [
              styles.cardSafetyButton,
              pressed && { opacity: 0.65 },
            ]}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
          </Pressable>
          <Animated.View
            style={[styles.stamp, styles.stampLike, { opacity: likeOpacity }]}
            pointerEvents="none"
          >
            <ThemedText style={[styles.stampText, { color: "#4ADE80" }]}>
              LIKE
            </ThemedText>
          </Animated.View>
          <Animated.View
            style={[styles.stamp, styles.stampPass, { opacity: passOpacity }]}
            pointerEvents="none"
          >
            <ThemedText style={[styles.stampText, { color: "#FB7185" }]}>
              PASS
            </ThemedText>
          </Animated.View>
        </Animated.View>
        {acting ? (
          <View style={styles.pending} accessibilityLiveRegion="polite">
            <ActivityIndicator color="#fff" size="small" />
            <ThemedText style={styles.pendingText}>Saving decision…</ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.scrollHint} pointerEvents="none">
        <ScrollHintChevron />
      </View>
      <View style={styles.detailsWrap}>
        <ProfileDetails profile={topItem} showHero={false} />
        <Pressable
          onPress={openProfile}
          accessibilityRole="button"
          accessibilityLabel={`Open ${topItem.displayName}'s full profile`}
          style={({ pressed }) => [
            styles.fullProfileButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <ThemedText
            style={[styles.fullProfileText, { color: theme.primary }]}
          >
            View full profile & safety options
          </ThemedText>
          <Ionicons name="arrow-forward" size={18} color={theme.primary} />
        </Pressable>
      </View>
      </ScrollView>
      <SafetySheet
        visible={safetyOpen}
        onClose={() => setSafetyOpen(false)}
        disabled={acting}
        onReport={(reason, details) =>
          api.reportProfile(topItem.userId, reason, details)
        }
        onBlock={async () => {
          await api.block(topItem.userId);
          setSafetyOpen(false);
          onBlocked?.(topItem);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  deck: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.three * 0.3,
    paddingBottom: Spacing.six,
  },
  deckArea: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    marginTop: Spacing.one,
  },
  cardSlot: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cardPressable: { flex: 1 },
  cardSafetyButton: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.48)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.24)",
  },
  cardInner: {
    flex: 1,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardPhoto: { flex: 1, width: "100%" },
  photoFallback: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
  },
  fallbackIcon: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: "center",
    justifyContent: "center",
  },
  cardScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 260,
  },
  cardInfo: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardName: {
    color: "#fff",
    fontSize: 29,
    lineHeight: 35,
    fontWeight: "800",
    flexShrink: 1,
  },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardSub: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontWeight: "500" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 3 },
  chip: {
    backgroundColor: "rgba(255,255,255,0.17)",
    borderRadius: BorderRadius.full,
    paddingHorizontal: 11,
    paddingVertical: 6,
    maxWidth: "82%",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.2)",
  },
  chipText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  stamp: {
    position: "absolute",
    top: 38,
    borderWidth: 3,
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 6,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  stampLike: {
    left: 20,
    borderColor: "#4ADE80",
    transform: [{ rotate: "-14deg" }],
  },
  stampPass: {
    right: 20,
    borderColor: "#FB7185",
    transform: [{ rotate: "14deg" }],
  },
  stampText: { fontSize: 27, fontWeight: "900", letterSpacing: 2 },
  pending: {
    position: "absolute",
    top: 18,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  pendingText: { color: "#fff", fontSize: 12 },
  scrollHint: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
  },
  detailsWrap: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    gap: Spacing.three,
  },
  fullProfileButton: {
    minHeight: 52,
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  fullProfileText: { fontSize: 14, fontWeight: "700" },
});
