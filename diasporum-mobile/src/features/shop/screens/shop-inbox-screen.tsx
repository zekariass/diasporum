/**
 * Shop marketplace Inbox tab — conversation inbox scoped to shop contexts
 * (SHOP, SHOP_PRODUCT, SHOP_ORDER): buyer↔seller chats about shops,
 * products and orders. Incoming message requests for shop conversations
 * show accept/decline above the list, same as the main Messages tab.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { useSession } from "@/core/session/session-provider";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createMessagingApi } from "@/features/messaging/services/messaging-api";
import { useConversations } from "@/features/messaging/hooks/use-conversations";
import { timeAgo } from "@/features/feed/utils/time-ago";
import { SHOP_CONTEXT_TYPES } from "../types/shop-types";
import type {
  ConversationView,
  MessageRequestView,
} from "@/features/messaging/types/messaging-types";

function Avatar({ name, business }: { name: string; business: boolean }) {
  const theme = useTheme();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <View style={[styles.avatar, { backgroundColor: business ? theme.primarySurface : theme.backgroundElement }]}>
      {business ? (
        <Ionicons name="storefront-outline" size={20} color={theme.primary} />
      ) : (
        <ThemedText style={[styles.avatarText, { color: theme.textSecondary }]}>
          {initial}
        </ThemedText>
      )}
    </View>
  );
}

function ConversationRow({ item }: { item: ConversationView }) {
  const theme = useTheme();
  const pending = item.status === "REQUESTED";
  const label = pending
    ? item.pendingRequestDirection === "OUTGOING" ? "Request sent" : "Message request"
    : item.lastMessagePreview ?? "No messages yet";
  const when = item.lastMessageAt ?? item.createdAt;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.border },
        pressed && { backgroundColor: theme.backgroundElement },
      ]}
      onPress={() => router.push(`/(app)/messages/${item.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${item.other.displayName}`}
    >
      <Avatar name={item.other.displayName} business={item.other.business} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <ThemedText style={styles.rowName} numberOfLines={1}>
            {item.other.displayName}
          </ThemedText>
          <ThemedText style={styles.rowTime} themeColor="textSecondary">
            {timeAgo(when)}
          </ThemedText>
        </View>
        <View style={styles.rowTop}>
          <ThemedText
            style={[styles.rowPreview, pending && { fontStyle: "italic" }]}
            themeColor={pending ? "textSecondary" : undefined}
            numberOfLines={1}
          >
            {label}
          </ThemedText>
          {item.unreadCount > 0 && (
            <View style={[styles.badge, { backgroundColor: theme.primary }]}>
              <ThemedText style={styles.badgeText}>
                {item.unreadCount > 99 ? "99+" : item.unreadCount}
              </ThemedText>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function RequestRow({ item, acting, onRespond }: {
  item: MessageRequestView;
  acting: boolean;
  onRespond: (accept: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.requestRow, { borderBottomColor: theme.border }]}>
      <Avatar name={item.sender.displayName} business={item.sender.business} />
      <View style={styles.rowBody}>
        <ThemedText style={styles.rowName} numberOfLines={1}>
          {item.sender.displayName}
        </ThemedText>
        {!!item.initialMessage && (
          <ThemedText style={styles.rowPreview} themeColor="textSecondary" numberOfLines={2}>
            {item.initialMessage}
          </ThemedText>
        )}
        <View style={styles.requestActions}>
          <Pressable
            style={[styles.requestBtn, { backgroundColor: theme.primary }]}
            onPress={() => onRespond(true)}
            disabled={acting}
            accessibilityRole="button"
            accessibilityLabel={`Accept request from ${item.sender.displayName}`}
          >
            <ThemedText style={styles.requestBtnTextAccept}>Accept</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.requestBtn, { backgroundColor: theme.backgroundElement }]}
            onPress={() => onRespond(false)}
            disabled={acting}
            accessibilityRole="button"
            accessibilityLabel={`Decline request from ${item.sender.displayName}`}
          >
            <ThemedText style={{ color: theme.text, fontWeight: "700", fontSize: 13 }}>
              Decline
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Keeps only message requests whose conversation is a shop context. The
 * request payload carries no contextType, so look the conversation up in the
 * loaded list first and fall back to fetching its detail. */
function useShopRequests(
  requests: MessageRequestView[],
  items: ConversationView[],
): { shopRequests: MessageRequestView[]; checking: boolean } {
  const { apiClient } = useSession();
  const api = useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const [shopIds, setShopIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const byId = new Map(items.map((i) => [i.id, i]));
    queueMicrotask(() => void (async () => {
      const verdicts = await Promise.all(requests.map(async (r) => {
        const known = byId.get(r.conversationId);
        if (known) return SHOP_CONTEXT_TYPES.has(known.contextType);
        try {
          const detail = await api.conversationDetail(r.conversationId);
          return SHOP_CONTEXT_TYPES.has(detail.conversation.contextType);
        } catch {
          return false;
        }
      }));
      if (!cancelled) {
        setShopIds(new Set(requests.filter((_, i) => verdicts[i]).map((r) => r.id)));
      }
    })());
    return () => { cancelled = true; };
  }, [api, requests, items]);

  return {
    shopRequests: requests.filter((r) => shopIds?.has(r.id)),
    checking: shopIds === null && requests.length > 0,
  };
}

export default function ShopInboxScreen() {
  const theme = useTheme();
  const {
    items, loading, refreshing, error, requests, actingOnRequest,
    refresh, loadMore, respondToRequest,
  } = useConversations();

  const shopItems = useMemo(
    () => items.filter((i) => SHOP_CONTEXT_TYPES.has(i.contextType)),
    [items],
  );
  const { shopRequests } = useShopRequests(requests, items);

  const empty = !loading && shopItems.length === 0 && shopRequests.length === 0;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Inbox</ThemedText>
        </View>

        {loading && shopItems.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : error && shopItems.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={36} color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary" style={styles.errorText}>
              {error}
            </ThemedText>
            <Pressable
              style={[styles.retryBtn, { backgroundColor: theme.primary }]}
              onPress={refresh}
              accessibilityRole="button"
            >
              <ThemedText style={styles.retryText}>Retry</ThemedText>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={shopItems}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ConversationRow item={item} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={refresh}
                tintColor={theme.primary} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={
              shopRequests.length > 0 ? (
                <View>
                  <ThemedText style={styles.sectionHeader} themeColor="textSecondary">
                    Message requests
                  </ThemedText>
                  {shopRequests.map((r) => (
                    <RequestRow key={r.id} item={r}
                      acting={actingOnRequest === r.id}
                      onRespond={(accept) => respondToRequest(r.id, accept)} />
                  ))}
                  <ThemedText style={styles.sectionHeader} themeColor="textSecondary">
                    Conversations
                  </ThemedText>
                </View>
              ) : undefined
            }
            ListEmptyComponent={
              empty ? (
                <View style={styles.empty}>
                  <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundElement }]}>
                    <Ionicons name="mail-outline" size={28} color={theme.textSecondary} />
                  </View>
                  <ThemedText style={styles.emptyTitle}>No messages yet</ThemedText>
                  <ThemedText style={styles.emptyBody} themeColor="textSecondary">
                    When you message a seller — or a buyer reaches out about
                    your items — the conversation will appear here.
                  </ThemedText>
                </View>
              ) : undefined
            }
            ListFooterComponent={
              shopItems.length > 0 && error ? (
                <ThemedText style={styles.footerError} themeColor="error">
                  {error}
                </ThemedText>
              ) : undefined
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  title: { fontSize: 24, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: Spacing.three, paddingHorizontal: Spacing.five },
  errorText: { textAlign: "center", fontSize: 14, lineHeight: 20 },
  retryBtn: { paddingHorizontal: Spacing.five, paddingVertical: 10, borderRadius: BorderRadius.full },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sectionHeader: {
    paddingHorizontal: Spacing.four, paddingTop: Spacing.three,
    paddingBottom: Spacing.one, fontSize: 13, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.4,
  },
  row: {
    flexDirection: "row", gap: Spacing.three, alignItems: "center",
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  requestRow: {
    flexDirection: "row", gap: Spacing.three,
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "700" },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two },
  rowName: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
  rowTime: { fontSize: 12 },
  rowPreview: { fontSize: 14, flexShrink: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  requestActions: { flexDirection: "row", gap: Spacing.two, marginTop: Spacing.two },
  requestBtn: { paddingHorizontal: Spacing.four, paddingVertical: 8, borderRadius: BorderRadius.full },
  requestBtnTextAccept: { color: "#fff", fontWeight: "700", fontSize: 13 },
  empty: { alignItems: "center", paddingTop: Spacing.six * 2, gap: Spacing.two, paddingHorizontal: Spacing.five },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: Spacing.one },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptyBody: { textAlign: "center", fontSize: 14, lineHeight: 20 },
  footerError: { textAlign: "center", padding: Spacing.three, fontSize: 13 },
});
