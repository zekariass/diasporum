import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { Address, ContactDirection, ContactRequest } from "../types/spare-bag-types";
import { CollectionState, ScreenHeader } from "../components/spare-bag-ui";

export default function ContactRequestsScreen() {
  const router = useRouter();
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const [direction, setDirection] = useState<ContactDirection>("INCOMING");
  const [items, setItems] = useState<ContactRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback((nextCursor?: string) => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    return Promise.resolve()
      .then(() => { if (nextCursor) setLoadingMore(true); })
      .then(() => api.contacts(direction, nextCursor))
      .then((page) => {
        setItems((current) => nextCursor ? [...current, ...page.items] : page.items);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((cause) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load contact requests."))
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      });
  }, [api, direction]);

  const [previousDirection, setPreviousDirection] = useState(direction);
  if (direction !== previousDirection) {
    setPreviousDirection(direction);
    setLoading(true);
  }
  useEffect(() => { void load(); }, [load]);

  async function action(contact: ContactRequest, work: () => Promise<ContactRequest>) {
    setActingId(contact.id);
    setError(null);
    try {
      const updated = await work();
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      return updated;
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "The contact request action failed.");
      return null;
    } finally {
      setActingId(null);
    }
  }

  async function openConversation(contact: ContactRequest) {
    const updated = await action(contact, () => api.conversation(contact.id));
    if (updated?.directConversationId) {
      router.push(`/(app)/messages/${updated.directConversationId}` as never);
    }
  }

  function report(contact: ContactRequest) {
    Alert.alert("Report contact request", "Report this interaction for review?", [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: () => {
        void action(contact, async () => {
          await api.reportContact(contact.id, "OTHER", "Reported from Spare Bag contact requests");
          return contact;
        });
      } },
    ]);
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title="Spare Bag contact requests" />
        <View style={styles.tabs}>
          {(["INCOMING", "OUTGOING"] as ContactDirection[]).map((item) => (
            <Pressable key={item} accessibilityRole="button" accessibilityLabel={item === "INCOMING" ? "Incoming requests" : "Outgoing requests"} accessibilityState={{ selected: direction === item }} onPress={() => setDirection(item)} style={styles.tab}>
              <ThemedText type="smallBold" style={{ color: direction === item ? BrandColors.primary : undefined }}>{item === "INCOMING" ? "Incoming" : "Outgoing"}</ThemedText>
            </Pressable>
          ))}
        </View>
        {error ? <ThemedText accessibilityRole="alert" style={[styles.error, { color: BrandColors.error }]}>{error}</ThemedText> : null}
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ContactCard contact={item} acting={actingId === item.id} onAccept={() => void action(item, () => api.accept(item.id))} onDecline={() => void action(item, () => api.decline(item.id))} onCancel={() => void action(item, () => api.cancel(item.id))} onClose={() => void action(item, () => api.closeContact(item.id))} onConversation={() => void openConversation(item)} onReport={() => report(item)} />}
          contentContainerStyle={styles.content}
          ListEmptyComponent={<CollectionState loading={loading} error={null} empty={!loading} onRetry={() => { setLoading(true); void load(); }} />}
          ListFooterComponent={loadingMore ? <ThemedText style={styles.footer}>Loading more…</ThemedText> : undefined}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function ContactCard({ contact, acting, onAccept, onDecline, onCancel, onClose, onConversation, onReport }: {
  contact: ContactRequest;
  acting: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onClose: () => void;
  onConversation: () => void;
  onReport: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const other = contact.otherOwner?.displayName ?? contact.otherOwner?.username ?? "Spare Bag member";
  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <ThemedText type="smallBold" style={{ color: BrandColors.primary }}>{contact.status} · {contact.incoming ? "Incoming" : "Outgoing"}</ThemedText>
      <ThemedText type="subtitle" style={styles.name}>{other}</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel="Open sender listing" onPress={() => router.push(`/(app)/spare-bag/${contact.senderListingId}` as never)}><ThemedText type="linkPrimary">Sender: {contact.senderListing.title}</ThemedText></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Open passenger listing" onPress={() => router.push(`/(app)/spare-bag/${contact.passengerListingId}` as never)}><ThemedText type="linkPrimary">Passenger: {contact.passengerListing.title}</ThemedText></Pressable>
      {contact.message ? <ThemedText>{contact.message}</ThemedText> : null}
      {contact.proposedPriceAmount != null ? <ThemedText>Proposed: {contact.proposedPriceAmount} {contact.priceCurrency} / {contact.proposedPriceUnit === "PER_KG" ? "kg" : "parcel"}</ThemedText> : null}
      {contact.status === "ACCEPTED" ? <View style={styles.addresses}><ThemedText type="smallBold">Accepted handover details</ThemedText><AddressText address={contact.senderListing.collectionAddress} /><AddressText address={contact.senderListing.handoverAddress} /><AddressText address={contact.passengerListing.collectionAddress} /><AddressText address={contact.passengerListing.handoverAddress} /></View> : null}
      <View style={styles.actions}>
        {contact.status === "PENDING" && contact.incoming ? <><PrimaryButton label="Accept" loading={acting} onPress={onAccept} /><PrimaryButton label="Decline" variant="secondary" loading={acting} onPress={onDecline} /></> : null}
        {contact.status === "PENDING" && !contact.incoming ? <PrimaryButton label="Cancel request" variant="secondary" loading={acting} onPress={onCancel} /> : null}
        {contact.status === "ACCEPTED" ? <><PrimaryButton label="Open conversation" loading={acting} onPress={onConversation} /><PrimaryButton label="Close contact" variant="danger" loading={acting} onPress={onClose} /></> : null}
        <PrimaryButton label="Report" variant="ghost" onPress={onReport} />
      </View>
    </View>
  );
}

function AddressText({ address }: { address: Address | null }) {
  if (!address) return null;
  return <ThemedText type="small">{address.formattedAddress ?? [address.addressLine1, address.addressLine2, address.city, address.region, address.postalCode].filter(Boolean).join(", ")}</ThemedText>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: { flexDirection: "row", justifyContent: "center", gap: Spacing.four, padding: Spacing.three },
  tab: { padding: Spacing.two },
  content: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three, gap: Spacing.two },
  name: { fontSize: 20, lineHeight: 26 },
  addresses: { gap: Spacing.one },
  actions: { gap: Spacing.two },
  error: { paddingHorizontal: Spacing.three },
  footer: { textAlign: "center", padding: Spacing.three },
});
