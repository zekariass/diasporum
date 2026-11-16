/**
 * Saved shipping addresses — the buyer's address book used at checkout.
 * Create, edit and delete entries; checkout already reuses saved addresses.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { KeyboardAwareScrollView } from "@/shared/components/keyboard-aware-scroll-view";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createTaxonomyApi } from "@/features/onboarding/services/taxonomy-api";
import type { CountryView } from "@/features/communities/types/community-types";
import { createShopApi } from "../services/shop-api";
import { ShopEmpty } from "../components/shop-ui";
import {
  AddressFields,
  addressDraftToInput,
  emptyAddressDraft,
  type AddressDraft,
} from "../components/shop-forms";
import type { AddressView } from "../types/shop-types";

export default function AddressesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const taxonomy = useMemo(() => createTaxonomyApi(apiClient), [apiClient]);

  const [addresses, setAddresses] = useState<AddressView[] | null>(null);
  const [countries, setCountries] = useState<CountryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AddressView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<AddressDraft>(emptyAddressDraft());

  const load = useCallback(async () => {
    try {
      const [list, page] = await Promise.all([
        api.addresses(),
        taxonomy.activeCountries().catch(() => ({ items: [] as CountryView[] })),
      ]);
      setAddresses(list);
      setCountries(page.items ?? []);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load addresses.");
      setAddresses([]);
    }
  }, [api, taxonomy]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const openForm = (address?: AddressView) => {
    setEditing(address ?? null);
    setDraft(address ? {
      countryId: address.countryId,
      line1: address.line1,
      line2: address.line2 ?? "",
      city: address.city,
      region: address.region ?? "",
      postalCode: address.postalCode,
    } : emptyAddressDraft());
    setFormOpen(true);
  };

  const save = async () => {
    const input = addressDraftToInput(draft);
    if (!input) {
      Alert.alert("Address", "Complete country, street, city and postal code.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateAddress(editing.id, input);
      } else {
        await api.createAddress(input);
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (cause) {
      Alert.alert("Could not save", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = (address: AddressView) => {
    Alert.alert("Delete address", address.formatted, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await api.deleteAddress(address.id);
          await load();
        } catch (cause) {
          Alert.alert("Could not delete", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
        }
      } },
    ]);
  };

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700", flex: 1 }}>
            Saved addresses
          </ThemedText>
          <Pressable onPress={() => openForm()} accessibilityLabel="Add address" hitSlop={8}>
            <Ionicons name="add-circle-outline" size={24} color={theme.primary} />
          </Pressable>
        </View>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : addresses === null ? (
          <LoadingScreen />
        ) : (
          <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 24 }}>
            {formOpen ? (
              <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 14,
                padding: 14, gap: 10, borderWidth: 1, borderColor: theme.primary }}>
                <ThemedText type="smallBold" style={{ color: theme.text }}>
                  {editing ? "Edit address" : "New address"}
                </ThemedText>
                <AddressFields draft={draft} countries={countries}
                  onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label={editing ? "Save" : "Add address"}
                      loading={saving} onPress={() => void save()} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label="Cancel" variant="secondary"
                      onPress={() => { setFormOpen(false); setEditing(null); }} />
                  </View>
                </View>
              </View>
            ) : null}
            {addresses.length === 0 && !formOpen ? (
              <ShopEmpty icon="location-outline" title="No saved addresses"
                message="Addresses you save here are one tap at checkout." />
            ) : null}
            {addresses.map((a) => (
              <View key={a.id} style={{ backgroundColor: theme.backgroundElement,
                borderRadius: 14, padding: 14, flexDirection: "row", gap: 10 }}>
                <Ionicons name="location-outline" size={18} color={theme.primary}
                  style={{ marginTop: 2 }} />
                <ThemedText style={{ color: theme.text, flex: 1 }}>{a.formatted}</ThemedText>
                <Pressable onPress={() => openForm(a)} hitSlop={6} accessibilityLabel="Edit address">
                  <Ionicons name="pencil-outline" size={18} color={theme.primary} />
                </Pressable>
                <Pressable onPress={() => remove(a)} hitSlop={6} accessibilityLabel="Delete address">
                  <Ionicons name="trash-outline" size={18} color={theme.error} />
                </Pressable>
              </View>
            ))}
          </KeyboardAwareScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
