import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { Address, ContactDirection, ContactRequest } from "../types/spare-bag-types";
import { CollectionState, DetailRow, formatDate, RouteView, SafetyNotice, ScreenHeader, StatusBadge } from "../components/spare-bag-ui";

export default function ContactRequestsScreen() {
  const theme = useTheme();
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
    if (updated?.directConversationId) router.push(`/(app)/messages/${updated.directConversationId}` as never);
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
        <ScreenHeader back title="Contact Requests" subtitle="Manage Spare Bag introductions" />
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View style={styles.headerContent}>
              <View style={styles.intro}>
                <ThemedText style={styles.introTitle}>Your connections</ThemedText>
                <ThemedText themeColor="textSecondary">Review proposals, respond to requests, and continue accepted introductions in private messaging.</ThemedText>
              </View>
              <View style={[styles.tabs, { backgroundColor: theme.backgroundElement }]}>
                {(["INCOMING", "OUTGOING"] as ContactDirection[]).map((item) => (
                  <Pressable key={item} accessibilityRole="button" accessibilityLabel={item === "INCOMING" ? "Received Requests" : "Sent Requests"} accessibilityState={{ selected: direction === item }} onPress={() => setDirection(item)} style={[styles.tab, direction === item && { backgroundColor: theme.background }]}>
                    <ThemedText type="smallBold" style={{ color: direction === item ? theme.primary : theme.textSecondary }}>{item === "INCOMING" ? "Received" : "Sent"}</ThemedText>
                  </Pressable>
                ))}
              </View>
              {error ? <View style={[styles.error, { backgroundColor: theme.errorSurface }]}><ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText></View> : null}
            </View>
          }
          renderItem={({ item }) => <ContactCard contact={item} acting={actingId === item.id} onAccept={() => void action(item, () => api.accept(item.id))} onDecline={() => void action(item, () => api.decline(item.id))} onCancel={() => void action(item, () => api.cancel(item.id))} onClose={() => void action(item, () => api.closeContact(item.id))} onConversation={() => void openConversation(item)} onReport={() => report(item)} />}
          contentContainerStyle={styles.content}
          ListEmptyComponent={<CollectionState loading={loading} error={null} empty={!loading} onRetry={() => { setLoading(true); void load(); }} emptyTitle={direction === "INCOMING" ? "No received requests" : "No sent requests"} emptyMessage="Compatible contact requests will appear here. An introduction is not a booking or delivery guarantee." />}
          ListFooterComponent={<View style={styles.footer}>{loadingMore ? <ThemedText style={styles.loadingMore}>Loading more…</ThemedText> : <SafetyNotice compact />}</View>}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
          onEndReachedThreshold={0.4}
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
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.background }]}>
      <View style={styles.cardTop}>
        <View style={styles.participant}>
          <View style={[styles.personIcon, { backgroundColor: theme.primarySurface }]}><Ionicons name="person-outline" size={19} color={theme.primary} /></View>
          <View>
            <ThemedText type="smallBold">{other}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{contact.incoming ? "Received" : "Sent"} {formatDate(contact.createdAt)}</ThemedText>
          </View>
        </View>
        <StatusBadge status={contact.status} />
      </View>
      <RouteView listing={contact.senderListing} />
      <View style={styles.listingLinks}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open sender listing" onPress={() => router.push(`/(app)/spare-bag/${contact.senderListingId}` as never)} style={styles.listingLink}>
          <Ionicons name="cube-outline" size={16} color={theme.primary} />
          <ThemedText type="smallBold" numberOfLines={2} style={styles.linkText}>Sender: {contact.senderListing.title}</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open passenger listing" onPress={() => router.push(`/(app)/spare-bag/${contact.passengerListingId}` as never)} style={styles.listingLink}>
          <Ionicons name="airplane-outline" size={16} color={theme.primary} />
          <ThemedText type="smallBold" numberOfLines={2} style={styles.linkText}>Traveller: {contact.passengerListing.title}</ThemedText>
        </Pressable>
      </View>
      {contact.parcelWeightKg != null ? <DetailRow icon="cube-outline" label="Proposed weight" value={`${contact.parcelWeightKg} kg`} /> : null}
      {contact.proposedPriceAmount != null ? <DetailRow icon="pricetag-outline" label="Proposed price" value={`${contact.proposedPriceAmount} ${contact.priceCurrency} / ${contact.proposedPriceUnit === "PER_KG" ? "kg" : "parcel"}`} /> : null}
      {contact.message ? <View style={[styles.message, { backgroundColor: theme.backgroundElement }]}><ThemedText type="small">“{contact.message}”</ThemedText></View> : null}
      {contact.status === "ACCEPTED" ? (
        <View style={[styles.addresses, { backgroundColor: theme.primarySurface }]}>
          <ThemedText type="smallBold">Accepted handover details</ThemedText>
          <AddressText address={contact.senderListing.collectionAddress} />
          <AddressText address={contact.senderListing.handoverAddress} />
          <AddressText address={contact.passengerListing.collectionAddress} />
          <AddressText address={contact.passengerListing.handoverAddress} />
          <ThemedText type="small" themeColor="textSecondary">Only addresses authorised by the backend are shown.</ThemedText>
        </View>
      ) : null}
      <View style={[styles.actions, { borderTopColor: theme.border }]}>
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
  headerContent: { gap: Spacing.three },
  intro: { gap: Spacing.one },
  introTitle: { fontSize: 24, lineHeight: 31, fontWeight: "800" },
  tabs: { flexDirection: "row", borderRadius: BorderRadius.md, padding: Spacing.one, gap: Spacing.one },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: BorderRadius.sm },
  content: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: BorderRadius.xl, padding: Spacing.three, gap: Spacing.three },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two },
  participant: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.two },
  personIcon: { width: 38, height: 38, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center" },
  listingLinks: { gap: Spacing.two },
  listingLink: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two },
  linkText: { flex: 1 },
  message: { borderRadius: BorderRadius.md, padding: Spacing.three },
  addresses: { borderRadius: BorderRadius.md, padding: Spacing.three, gap: Spacing.one },
  actions: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.two },
  error: { padding: Spacing.three, borderRadius: BorderRadius.md },
  footer: { paddingTop: Spacing.two },
  loadingMore: { textAlign: "center", padding: Spacing.three },
});
