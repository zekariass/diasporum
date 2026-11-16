import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { openBrowserAsync, WebBrowserPresentationStyle } from "expo-web-browser";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { KeyboardAwareScrollView } from "@/shared/components/keyboard-aware-scroll-view";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createTaxonomyApi } from "@/features/onboarding/services/taxonomy-api";
import type { CountryView } from "@/features/communities/types/community-types";
import { createShopApi } from "../services/shop-api";
import { Chip, formatMoney, SegmentedTabs, StatusPill } from "../components/shop-ui";
import {
  AddressFields,
  FieldCell,
  FieldRow,
  FormInput,
  addressDraftToInput,
  emptyAddressDraft,
  type AddressDraft,
} from "../components/shop-forms";
import type {
  DiscountCode,
  Earnings,
  InventoryLocation,
  InventoryRow,
  PaymentAccount,
  ShippingConfig,
} from "../types/shop-types";

const TABS = ["inventory", "shipping", "earnings", "discounts"] as const;

export default function SellerManageScreen() {
  const { shopId, tab } = useLocalSearchParams<{ shopId: string; tab?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const taxonomy = useMemo(() => createTaxonomyApi(apiClient), [apiClient]);
  const [active, setActive] = useState<(typeof TABS)[number]>(
    (tab as (typeof TABS)[number]) ?? "inventory");
  const [inventory, setInventory] = useState<InventoryRow[] | null>(null);
  const [locations, setLocations] = useState<InventoryLocation[] | null>(null);
  const [countries, setCountries] = useState<CountryView[]>([]);
  const [shipping, setShipping] = useState<ShippingConfig | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [paymentAccount, setPaymentAccount] = useState<PaymentAccount | null>(null);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [discounts, setDiscounts] = useState<DiscountCode[] | null>(null);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState("PERCENTAGE");
  const [value, setValue] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [saving, setSaving] = useState(false);

  // Stock adjustment state — the row whose editor is open.
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustType, setAdjustType] = useState("RECEIPT");
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustThreshold, setAdjustThreshold] = useState("");

  // New-location form state.
  const [locationFormOpen, setLocationFormOpen] = useState(false);
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState<AddressDraft>(emptyAddressDraft());

  const load = useCallback(async () => {
    if (!shopId) return;
    if (active === "inventory") {
      const [rows, locs] = await Promise.all([
        api.inventory(shopId).catch(() => []),
        api.locations(shopId).catch(() => []),
      ]);
      setInventory(rows);
      setLocations(locs);
      if (!countries.length) {
        void taxonomy.activeCountries()
          .then((page) => setCountries(page.items ?? []))
          .catch(() => {});
      }
    }
    if (active === "shipping") setShipping(await api.shippingConfig(shopId).catch(() => null));
    if (active === "earnings") {
      const [earn, account] = await Promise.all([
        api.earnings(shopId).catch(() => null),
        api.paymentAccount(shopId).catch(() => null),
      ]);
      setEarnings(earn);
      setPaymentAccount(account);
    }
    if (active === "discounts") setDiscounts(await api.discounts(shopId).catch(() => []));
  }, [api, taxonomy, shopId, active, countries.length]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const refreshPaymentAccount = useCallback(async () => {
    if (!shopId) return;
    setPaymentAccount(await api.paymentAccount(shopId).catch(() => null));
  }, [api, shopId]);

  const payoutLink = async () => {
    if (!shopId) return;
    setPayoutBusy(true);
    try {
      const link = await api.paymentOnboardingLink(shopId);
      if (link.url) {
        // Hosted Stripe onboarding in an in-app browser — resolves when the
        // seller returns, then we re-sync account status from the provider.
        await openBrowserAsync(link.url, {
          presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
        });
        await refreshPaymentAccount();
      }
    } catch (cause) {
      Alert.alert("Payouts", cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setPayoutBusy(false);
    }
  };

  const openAdjust = (row: InventoryRow) => {
    setAdjustingId(row.inventoryItemId);
    setAdjustType("RECEIPT");
    setAdjustDelta("");
    setAdjustReason("");
    setAdjustThreshold(String(row.lowStockThreshold ?? ""));
  };

  const saveAdjust = async (row: InventoryRow) => {
    const delta = parseInt(adjustDelta, 10);
    const threshold = adjustThreshold.trim() ? parseInt(adjustThreshold, 10) : null;
    const hasDelta = Number.isFinite(delta) && delta !== 0;
    if (!hasDelta && threshold == null) {
      Alert.alert("Adjustment", "Enter a quantity change (+/-) or a low-stock threshold.");
      return;
    }
    if (hasDelta && !adjustReason.trim()) {
      Alert.alert("Adjustment", "A reason is required for stock changes.");
      return;
    }
    if ((adjustType === "DAMAGE" || adjustType === "WRITE_OFF") && hasDelta && delta > 0) {
      Alert.alert("Adjustment", "Damage and write-offs must decrease stock.");
      return;
    }
    setSaving(true);
    try {
      await api.adjustInventory(shopId!, {
        variantId: row.variantId,
        locationId: row.locationId,
        delta: hasDelta ? delta : 0,
        movementType: adjustType,
        reason: adjustReason.trim() || undefined,
        lowStockThreshold: threshold ?? undefined,
      });
      setAdjustingId(null);
      await load();
    } catch (cause) {
      Alert.alert("Could not adjust stock",
        ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const saveLocation = async () => {
    const address = addressDraftToInput(locationAddress);
    if (!locationName.trim() || !address) {
      Alert.alert("Location", "Name the location and complete its address.");
      return;
    }
    setSaving(true);
    try {
      await api.createLocation(shopId!, locationName.trim(), address);
      setLocationFormOpen(false);
      setLocationName("");
      setLocationAddress(emptyAddressDraft());
      await load();
    } catch (cause) {
      Alert.alert("Could not add location",
        ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const card = { backgroundColor: theme.backgroundElement, borderRadius: 12, padding: 12, gap: 6 };

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color={theme.text} /></Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>Manage</ThemedText>
        </View>
        <View style={{ paddingBottom: 8 }}>
          <SegmentedTabs
            tabs={TABS.map((t) => ({ key: t, label: t[0].toUpperCase() + t.slice(1) }))}
            active={active}
            onChange={setActive}
          />
        </View>
        <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 24 }}>
          {active === "inventory" && (inventory === null ? <LoadingScreen /> : (
            <View style={{ gap: 10 }}>
              {/* ---------- locations ---------- */}
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <ThemedText type="smallBold" style={{ color: theme.text, flex: 1 }}>
                  Locations
                </ThemedText>
                <Pressable onPress={() => setLocationFormOpen((o) => !o)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="add-circle-outline" size={18} color={theme.primary} />
                  <ThemedText type="smallBold" style={{ color: theme.primary }}>Add</ThemedText>
                </Pressable>
              </View>
              {(locations ?? []).map((loc) => (
                <View key={loc.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="business-outline" size={16} color={theme.textSecondary} />
                  <ThemedText type="small" style={{ color: theme.text, flex: 1 }}>{loc.name}</ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    {loc.address.city}, {loc.address.countryCode}
                  </ThemedText>
                </View>
              ))}
              {locationFormOpen ? (
                <View style={[card, { borderWidth: 1, borderColor: theme.primary, gap: 8 }]}>
                  <FormInput label="Location name" value={locationName}
                    onChangeText={setLocationName} placeholder="e.g. Home, Studio, Warehouse" />
                  <AddressFields draft={locationAddress} countries={countries}
                    onChange={(patch) => setLocationAddress((a) => ({ ...a, ...patch }))} />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <PrimaryButton label="Add location" loading={saving}
                        onPress={() => void saveLocation()} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <PrimaryButton label="Cancel" variant="secondary"
                        onPress={() => setLocationFormOpen(false)} />
                    </View>
                  </View>
                </View>
              ) : null}

              {/* ---------- stock rows ---------- */}
              <ThemedText type="smallBold" style={{ color: theme.text, marginTop: 6 }}>
                Stock
              </ThemedText>
              {inventory.length === 0 ? (
                <ThemedText style={{ color: theme.textSecondary }}>No inventory items yet.</ThemedText>
              ) : inventory.map((row) => (
                <View key={row.inventoryItemId} style={card}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ color: theme.text }} numberOfLines={1}>
                        {row.productName} — {row.variantLabel}
                      </ThemedText>
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>
                        {row.locationName}{row.low ? " · low stock" : ""}
                      </ThemedText>
                    </View>
                    <ThemedText type="smallBold"
                      style={{ color: row.available < 3 ? theme.error : theme.text }}>
                      {row.available} in stock
                    </ThemedText>
                    <Pressable onPress={() => adjustingId === row.inventoryItemId
                      ? setAdjustingId(null) : openAdjust(row)}
                      accessibilityLabel={`Adjust ${row.productName}`} hitSlop={6}>
                      <Ionicons name="create-outline" size={18} color={theme.primary} />
                    </Pressable>
                  </View>
                  {adjustingId === row.inventoryItemId ? (
                    <View style={{ borderTopWidth: 1, borderTopColor: theme.border,
                      paddingTop: 10, gap: 8 }}>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {([
                          ["RECEIPT", "Restock"], ["ADJUSTMENT", "Correction"],
                          ["DAMAGE", "Damage"], ["WRITE_OFF", "Write-off"],
                        ] as const).map(([key, label]) => (
                          <Chip key={key} label={label}
                            selected={adjustType === key} onPress={() => setAdjustType(key)} />
                        ))}
                      </View>
                      <FieldRow>
                        <FieldCell>
                          <FormInput label="Change (+/-)" value={adjustDelta}
                            onChangeText={setAdjustDelta} keyboardType="numbers-and-punctuation"
                            placeholder="e.g. 10 or -2" />
                        </FieldCell>
                        <FieldCell>
                          <FormInput label="Low-stock alert at" value={adjustThreshold}
                            onChangeText={setAdjustThreshold} keyboardType="number-pad" />
                        </FieldCell>
                      </FieldRow>
                      <FormInput label="Reason (required for stock change)" value={adjustReason}
                        onChangeText={setAdjustReason} placeholder="e.g. Restock, damaged in storage" />
                      <PrimaryButton label="Apply adjustment" loading={saving}
                        onPress={() => void saveAdjust(row)} />
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
          {active === "shipping" && (shipping === null ? <LoadingScreen /> : (
            <View style={{ gap: 10 }}>
              {shipping.profile ? (
                <View style={card}>
                  <ThemedText type="smallBold" style={{ color: theme.text }}>Dispatch from</ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    {shipping.profile.origin.formatted}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    Ships in {shipping.profile.handlingMinDays}–{shipping.profile.handlingMaxDays} days
                  </ThemedText>
                </View>
              ) : (
                <View style={card}>
                  <ThemedText type="small" style={{ color: theme.warning }}>
                    No dispatch address or handling time set — required before publishing.
                  </ThemedText>
                </View>
              )}
              <ThemedText type="smallBold" style={{ color: theme.text }}>Shipping zones</ThemedText>
              {shipping.zones.length === 0 ? (
                <ThemedText style={{ color: theme.textSecondary }}>
                  No zones configured yet.
                </ThemedText>
              ) : shipping.zones.map((zone) => (
                <View key={zone.id} style={card}>
                  <ThemedText type="smallBold" style={{ color: theme.text }}>{zone.name}</ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    {zone.countries.map((c) => c.name).join(" · ")}
                  </ThemedText>
                  {zone.methods.map((m) => (
                    <View key={m.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>{m.name}</ThemedText>
                      <ThemedText type="small" style={{ color: theme.text }}>
                        {m.rules.baseRateMinor != null
                          ? `${(m.rules.baseRateMinor / 100).toFixed(2)} ${m.currencyCode ?? ""}`
                          : m.methodType.replaceAll("_", " ")}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              ))}
              <PrimaryButton label="Edit shipping & returns"
                onPress={() => router.push(`/(app)/shop/seller/shipping?shopId=${shopId}` as never)} />
            </View>
          ))}
          {active === "earnings" && (earnings === null && paymentAccount === null ? <LoadingScreen /> : (
            <View style={{ gap: 10 }}>
              {/* Payout account card — status drives the CTA label */}
              <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 12,
                padding: 14, gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="card-outline" size={16} color={theme.textSecondary} />
                  <ThemedText type="smallBold" style={{ color: theme.text, flex: 1 }}>
                    Payout account
                  </ThemedText>
                  {paymentAccount ? <StatusPill status={paymentAccount.onboardingStatus} /> : null}
                </View>
                {paymentAccount ? (
                  <>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      {paymentAccount.onboardingStatus === "COMPLETE"
                        ? "Your account is verified — payouts go to your linked bank."
                        : paymentAccount.detailsSubmitted
                          ? "Stripe is reviewing your details."
                          : "Finish Stripe onboarding to receive payouts."}
                    </ThemedText>
                    {paymentAccount.requirementsDue.length > 0 ? (
                      <View style={{ gap: 4 }}>
                        {paymentAccount.requirementsDue.slice(0, 4).map((req) => (
                          <View key={req} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                            <Ionicons name="alert-circle" size={13} color={theme.warning} />
                            <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
                              {req.replaceAll("_", " ").replaceAll(".", " › ")}
                            </ThemedText>
                          </View>
                        ))}
                        {paymentAccount.requirementsDue.length > 4 ? (
                          <ThemedText type="small" style={{ color: theme.textMuted }}>
                            +{paymentAccount.requirementsDue.length - 4} more
                          </ThemedText>
                        ) : null}
                      </View>
                    ) : null}
                  </>
                ) : (
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    Connect a payout account to get paid for your sales.
                  </ThemedText>
                )}
                {paymentAccount?.onboardingStatus !== "COMPLETE" ? (
                  <PrimaryButton
                    label={paymentAccount ? "Continue payout setup" : "Set up payouts"}
                    variant="secondary" loading={payoutBusy}
                    onPress={() => void payoutLink()} />
                ) : (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Ionicons name={paymentAccount.chargesEnabled ? "checkmark-circle" : "close-circle"}
                        size={14} color={paymentAccount.chargesEnabled ? theme.success : theme.textMuted} />
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>Charges</ThemedText>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Ionicons name={paymentAccount.payoutsEnabled ? "checkmark-circle" : "close-circle"}
                        size={14} color={paymentAccount.payoutsEnabled ? theme.success : theme.textMuted} />
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>Payouts</ThemedText>
                    </View>
                  </View>
                )}
              </View>

              {earnings ? (["availableBalance", "pendingBalance", "lifetimeEarnings"] as const).map((key) => (
                <View key={key} style={{ flexDirection: "row", justifyContent: "space-between",
                  backgroundColor: theme.backgroundElement, borderRadius: 12, padding: 14 }}>
                  <ThemedText style={{ color: theme.textSecondary }}>
                    {key === "availableBalance" ? "Available" : key === "pendingBalance" ? "Pending" : "Lifetime"}
                  </ThemedText>
                  <ThemedText type="smallBold" style={{ color: theme.text }}>
                    {formatMoney(earnings.totals[0] ? earnings.totals[0][key === "availableBalance" ? "sellerNet" : key === "pendingBalance" ? "pendingTransfers" : "grossSales"] : null)}
                  </ThemedText>
                </View>
              )) : null}
            </View>
          ))}
          {active === "discounts" && (
            <View style={{ gap: 10 }}>
              <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 12,
                padding: 12, gap: 8 }}>
                <ThemedText type="smallBold" style={{ color: theme.text }}>New discount code</ThemedText>
                <TextInput value={code} onChangeText={setCode} placeholder="Code (e.g. SAVE10)"
                  autoCapitalize="characters" placeholderTextColor={theme.textMuted}
                  style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10,
                    paddingHorizontal: 12, paddingVertical: 10, color: theme.text }} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {(["PERCENTAGE", "FIXED", "FREE_SHIPPING"] as const).map((t) => (
                    <Chip key={t} label={t.replaceAll("_", " ").toLowerCase()}
                      selected={discountType === t} onPress={() => setDiscountType(t)} />
                  ))}
                </View>
                {discountType !== "FREE_SHIPPING" ? (
                  <TextInput value={value} onChangeText={setValue}
                    placeholder={discountType === "PERCENTAGE" ? "Percent off (e.g. 10)" : "Amount off (e.g. 5.00)"}
                    keyboardType="decimal-pad" placeholderTextColor={theme.textMuted}
                    style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10,
                      paddingHorizontal: 12, paddingVertical: 10, color: theme.text }} />
                ) : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput value={minOrder} onChangeText={setMinOrder} placeholder="Min order (optional)"
                    keyboardType="decimal-pad" placeholderTextColor={theme.textMuted}
                    style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10,
                      paddingHorizontal: 12, paddingVertical: 10, color: theme.text }} />
                  <TextInput value={usageLimit} onChangeText={setUsageLimit} placeholder="Usage limit"
                    keyboardType="number-pad" placeholderTextColor={theme.textMuted}
                    style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10,
                      paddingHorizontal: 12, paddingVertical: 10, color: theme.text }} />
                </View>
                <PrimaryButton label="Create code" loading={saving}
                  onPress={() => {
                    setSaving(true);
                    void (async () => {
                      try {
                        const minMinor = minOrder.trim()
                          ? Math.round(parseFloat(minOrder.replace(",", ".")) * 100) : null;
                        await api.createDiscount(shopId!, {
                          code: code.trim().toUpperCase(),
                          discountType,
                          discountValue: discountType === "FREE_SHIPPING" ? 0
                            : discountType === "PERCENTAGE" ? parseFloat(value) || 0
                            : Math.round((parseFloat(value.replace(",", ".")) || 0) * 100),
                          minimumOrderAmountMinor: Number.isFinite(minMinor) ? minMinor : null,
                          totalUsageLimit: usageLimit ? parseInt(usageLimit, 10) : null,
                        });
                        setCode(""); setValue(""); setMinOrder(""); setUsageLimit("");
                        setDiscounts(await api.discounts(shopId!));
                      } catch (cause) {
                        Alert.alert("Could not create code",
                          cause instanceof Error ? cause.message : "Try again.");
                      } finally {
                        setSaving(false);
                      }
                    })();
                  }} />
              </View>
              {(discounts ?? []).map((d) => (
                <View key={d.id} style={{ backgroundColor: theme.backgroundElement,
                  borderRadius: 12, padding: 12, gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ThemedText type="smallBold" style={{ color: theme.text, flex: 1 }}>{d.code}</ThemedText>
                    <StatusPill status={d.status} />
                  </View>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    {d.discountType === "PERCENTAGE" ? `${d.discountValue}% off`
                      : d.discountType === "FREE_SHIPPING" ? "Free shipping"
                      : `${(d.discountValue / 100).toFixed(2)} ${d.currencyCode ?? ""} off`}
                    {d.minimumOrderAmountMinor ? ` · min ${(d.minimumOrderAmountMinor / 100).toFixed(2)}` : ""}
                    {d.endsAt ? ` · ends ${d.endsAt.slice(0, 10)}` : ""}
                  </ThemedText>
                  {d.status === "ACTIVE" || d.status === "PAUSED" ? (
                    <PrimaryButton
                      label={d.status === "ACTIVE" ? "Pause" : "Activate"}
                      variant="secondary"
                      onPress={() => void api
                        .setDiscountStatus(shopId!, d.id, d.status === "ACTIVE" ? "PAUSED" : "ACTIVE")
                        .then(() => api.discounts(shopId!)).then(setDiscounts)
                        .catch(() => Alert.alert("Could not update", "Try again."))} />
                  ) : null}
                </View>
              ))}
              {discounts && discounts.length === 0 ? (
                <ThemedText style={{ color: theme.textSecondary }}>No discount codes yet.</ThemedText>
              ) : null}
            </View>
          )}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
