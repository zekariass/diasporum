/**
 * ProfileIdentity — name + verification badge, username, location metadata
 * and an expandable bio. Fields that aren't set simply don't render.
 */

import React, { useCallback, useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type TextLayoutEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";

const BIO_LINES = 3;

interface Props {
  displayName: string | null;
  username: string | null;
  bio: string | null;
  city: string | null;
  verified: boolean;
}

export function ProfileIdentity({
  displayName,
  username,
  bio,
  city,
  verified,
}: Props) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  // Only offer "more" when the bio actually overflows the line limit.
  const onBioLayout = useCallback(
    (e: TextLayoutEvent) => {
      if (!canExpand && e.nativeEvent.lines.length > BIO_LINES) {
        setCanExpand(true);
      }
    },
    [canExpand],
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.nameRow}>
        <ThemedText style={styles.name} numberOfLines={1}>
          {displayName ?? "Diasporum member"}
        </ThemedText>
        {verified ? (
          <Ionicons
            name="checkmark-circle"
            size={19}
            color={theme.primary}
            accessibilityLabel="Verified profile"
          />
        ) : null}
      </View>

      {username ? (
        <ThemedText style={styles.username} themeColor="textSecondary">
          @{username}
        </ThemedText>
      ) : null}

      {city ? (
        <View style={styles.metaRow}>
          <Ionicons
            name="location-outline"
            size={14}
            color={theme.textSecondary}
          />
          <ThemedText style={styles.meta} themeColor="textSecondary">
            {city}
          </ThemedText>
        </View>
      ) : null}

      {bio ? (
        <View>
          <ThemedText
            style={styles.bio}
            numberOfLines={expanded ? undefined : BIO_LINES}
            onTextLayout={onBioLayout}
          >
            {bio}
          </ThemedText>
          {canExpand ? (
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={expanded ? "Show less bio" : "Show full bio"}
            >
              <ThemedText style={[styles.more, { color: theme.primary }]}>
                {expanded ? "Show less" : "more"}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.three,
    gap: 3,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  name: { fontSize: 21, fontWeight: "800", lineHeight: 26, flexShrink: 1 },
  username: { fontSize: 14, lineHeight: 19 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 3,
  },
  meta: { fontSize: 13, lineHeight: 18 },
  bio: { fontSize: 14, lineHeight: 20, marginTop: Spacing.one },
  more: { fontSize: 13, fontWeight: "600", marginTop: 2 },
});
