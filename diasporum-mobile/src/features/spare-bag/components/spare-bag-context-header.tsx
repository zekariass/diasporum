import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { ApiClient } from "@/core/api/api-client";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { ContactRequest } from "../types/spare-bag-types";
import { StatusBadge } from "./spare-bag-ui";

/** Compact context for the existing direct-message thread; never a separate chat. */
export function SpareBagContextHeader({ client, contactId }: { client: ApiClient; contactId: string }) {
  const theme = useTheme();
  const router = useRouter();
  const [contact, setContact] = useState<ContactRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    createSpareBagApi(client).contactDetail(contactId)
      .then((result) => { if (active) setContact(result); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, contactId]);

  if (loading) return <View style={[styles.loading, { borderBottomColor: theme.border }]}><ActivityIndicator size="small" color={theme.primary} accessibilityLabel="Loading Spare Bag context" /></View>;
  if (!contact) return null;
  const listing = contact.senderListing;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Spare Bag listing context"
      onPress={() => router.push(`/(app)/spare-bag/${listing.id}` as never)}
      style={[styles.container, { backgroundColor: theme.primarySurface, borderBottomColor: theme.border }]}
    >
      <View style={[styles.icon, { backgroundColor: theme.background }]}><Ionicons name="briefcase-outline" size={19} color={theme.primary} /></View>
      <View style={styles.copy}>
        <ThemedText type="smallBold" style={{ color: theme.primary }}>Spare Bag contact</ThemedText>
        <ThemedText type="small" numberOfLines={1}>{listing.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{listing.originAirport.iataCode} → {listing.destinationAirport.iataCode} · Sender request reference</ThemedText>
      </View>
      <StatusBadge status={contact.status} />
      <Ionicons name="chevron-forward" size={17} color={theme.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { minHeight: 48, alignItems: "center", justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  container: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 36, height: 36, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
});
