/**
 * CommunitySelector — quiet context line: community name + member count +
 * chevron. Tapping opens the community switcher. Styled as secondary text so
 * the timeline stays the focus.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import type { CommunityDetail } from "../types/feed-types";
import { createFeedApi } from "../services/feed-api";
import { useSession } from "@/core/session/session-provider";

interface Props {
  onSwitch: () => void;
}

export function CommunitySelector({ onSwitch }: Props) {
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createFeedApi(apiClient), [apiClient]);
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const communityId = session?.activeCommunityId;

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    void api
      .communityDetail(communityId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {});
    void api
      .memberCount(communityId)
      .then((r) => {
        if (!cancelled) setCount(r.total);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [communityId, api]);

  if (!communityId) return null;
  const members =
    count != null
      ? ` · ${count >= 1000 ? `${(count / 1000).toFixed(1)}K` : count} members`
      : "";

  return (
    <Pressable
      onPress={onSwitch}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Community: ${detail?.name ?? ""}. Tap to switch.`}
    >
      <ThemedText style={styles.name} numberOfLines={1}>
        {detail?.name ?? "…"}
        <ThemedText style={styles.count} themeColor="textSecondary">
          {members}
        </ThemedText>
      </ThemedText>
      <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  pressed: { opacity: 0.6 },
  name: { fontSize: 14, fontWeight: "600", lineHeight: 18, flexShrink: 1 },
  count: { fontSize: 13, fontWeight: "400", lineHeight: 18 },
});
