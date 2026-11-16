import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { KeyboardAwareScrollView } from "@/shared/components/keyboard-aware-scroll-view";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createBusinessApi } from "@/features/business/services/business-api";
import type { BusinessAccount } from "@/features/business/types/business-types";
import { createShopApi } from "../services/shop-api";

// Mirrors SellerAccessPolicy.SELLER_REGISTRATION_ROLES on the backend — only
// owners/admins of a Business Account can register it as a marketplace seller.
const SELLER_REGISTRATION_ROLES = new Set(["OWNER", "ADMINISTRATOR"]);

/**
 * Opens a new shop. Two distinct paths, chosen by the `type` param:
 *  - "individual" — a lightweight personal listing shop (reuses the user's
 *    one INDIVIDUAL seller record if they already have one).
 *  - "business" (default) — a storefront backed by a Business Account, with
 *    its own team, billing and brand; the user must own/administer that
 *    Business Account.
 */
export default function SellerOnboardingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { type } = useLocalSearchParams<{ type?: string }>();
  const isBusiness = type !== "individual";
  const { apiClient, session } = useSession();
  const shopApi = useMemo(() => createShopApi(apiClient), [apiClient]);
  const businessApi = useMemo(() => createBusinessApi(apiClient), [apiClient]);

  const [accounts, setAccounts] = useState<BusinessAccount[] | null>(null);
  const [individualSellerId, setIndividualSellerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      if (isBusiness) {
        const { items } = await businessApi.accounts();
        const eligible = items.filter(
          (a) => a.status === "ACTIVE" && SELLER_REGISTRATION_ROLES.has(a.role),
        );
        setAccounts(eligible);
        setSelectedAccountId(eligible.length === 1 ? eligible[0].id : null);
      } else {
        const shops = await shopApi.sellerShops();
        setIndividualSellerId(shops.find((s) => s.sellerType === "INDIVIDUAL")?.sellerId ?? null);
      }
      setLoadError(null);
    } catch (cause) {
      setLoadError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load your shops.");
    } finally {
      setLoading(false);
    }
  }, [businessApi, shopApi, isBusiness]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    if (isBusiness && !selectedAccountId) return;
    setBusy(true);
    try {
      const countryId = session?.profile?.currentCountryId ?? session?.profile?.originCountryId;
      if (!countryId) throw new Error("Set your country in your profile first.");
      let sellerId: string;
      if (isBusiness) {
        const account = accounts?.find((a) => a.id === selectedAccountId);
        if (!account) return;
        sellerId = (await shopApi.createSeller({
          sellerType: "BUSINESS", businessAccountId: account.id, legalCountryId: countryId,
          legalName: account.accountName, displayName: account.accountName,
        })).id;
      } else if (individualSellerId) {
        sellerId = individualSellerId;
      } else {
        const displayName = session?.profile?.displayName ?? name.trim();
        sellerId = (await shopApi.createSeller({
          sellerType: "INDIVIDUAL", legalCountryId: countryId,
          legalName: displayName, displayName,
        })).id;
      }
      const shop = await shopApi.createShop({ sellerId, name: name.trim(), marketCountryId: countryId });
      router.replace(`/(app)/shop/seller?shopId=${shop.shop.id}` as never);
    } catch (cause) {
      Alert.alert("Could not create shop", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color={theme.text} /></Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>
            {isBusiness ? "Sell as a business" : "Open a shop"}
          </ThemedText>
        </View>
        <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          {loadError ? (
            <ThemedText style={{ color: theme.error }}>{loadError}</ThemedText>
          ) : isBusiness && (!accounts || accounts.length === 0) ? (
            <View style={{ gap: 14 }}>
              <ThemedText style={{ color: theme.textSecondary, lineHeight: 21 }}>
                A business shop is backed by a Business Account — it gets its own brand,
                team members and billing. You need to own or administer a Business Account
                before opening a business shop.
              </ThemedText>
              <PrimaryButton
                label="Create a Business Account"
                onPress={() => router.push("/(app)/business/create" as never)}
              />
            </View>
          ) : (
            <>
              <ThemedText style={{ color: theme.textSecondary, lineHeight: 21 }}>
                {isBusiness
                  ? "Choose the Business Account this shop belongs to, then name your storefront. You can add a logo, policies and shipping afterwards."
                  : "Name your shop — you can add a logo, policies and shipping afterwards."}
              </ThemedText>
              {isBusiness && accounts && (
                <View style={{ gap: 8 }}>
                  <ThemedText type="smallBold" style={{ color: theme.text }}>Business Account</ThemedText>
                  {accounts.map((a) => (
                    <Pressable
                      key={a.id}
                      onPress={() => setSelectedAccountId(a.id)}
                      accessibilityRole="button"
                      style={({ pressed }) => [{
                        flexDirection: "row", alignItems: "center", gap: 10,
                        borderWidth: 1, borderRadius: 10, padding: 12,
                        borderColor: selectedAccountId === a.id ? theme.primary : theme.border,
                      }, pressed && { opacity: 0.85 }]}
                    >
                      <Ionicons
                        name={selectedAccountId === a.id ? "radio-button-on" : "radio-button-off"}
                        size={20} color={selectedAccountId === a.id ? theme.primary : theme.textMuted}
                      />
                      <ThemedText style={{ color: theme.text, flex: 1 }}>{a.accountName}</ThemedText>
                    </Pressable>
                  ))}
                  <Pressable onPress={() => router.push("/(app)/business/create" as never)}>
                    <ThemedText style={{ color: theme.primary, marginTop: 2 }}>
                      + Create another Business Account
                    </ThemedText>
                  </Pressable>
                </View>
              )}
              <TextInput value={name} onChangeText={setName} placeholder="Shop name"
                placeholderTextColor={theme.textMuted}
                style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, color: theme.text }} />
              <PrimaryButton
                label="Create shop"
                onPress={() => void create()}
                loading={busy}
                disabled={(isBusiness && !selectedAccountId) || !name.trim()}
              />
            </>
          )}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
