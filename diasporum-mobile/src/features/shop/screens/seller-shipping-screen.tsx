/**
 * Seller shipping & returns setup — the three readiness checks the seller must
 * complete before publishing: dispatch profile (origin address + handling
 * days), at least one active shipping zone with a method, and a published
 * returns policy. Zones carry per-method pricing rules; SHIPPO_CALCULATED
 * methods quote live carrier rates server-side and are only offered when the
 * backend provider is configured (providerCalculatedAvailable).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { Chip, formatMoney } from "../components/shop-ui";
import {
  AddressFields,
  CountryPickerModal,
  FieldCell,
  FieldRow,
  FormInput,
  addressDraftToInput,
  emptyAddressDraft,
  type AddressDraft,
} from "../components/shop-forms";
import type {
  ShippingConfig,
  ShippingMethodInput,
  ShippingMethodView,
  ShippingZoneView,
} from "../types/shop-types";

const METHOD_TYPES: { key: string; label: string }[] = [
  { key: "FLAT_RATE", label: "Flat rate" },
  { key: "WEIGHT_BASED", label: "By weight" },
  { key: "FREE_ABOVE_THRESHOLD", label: "Free over amount" },
  { key: "FREE", label: "Free" },
  { key: "EXTERNAL_CARRIER", label: "Own courier" },
  { key: "SHIPPO_CALCULATED", label: "Live rates" },
];

function minorOf(text: string): number | null {
  const parsed = parseFloat(text.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function intOf(text: string): number | null {
  const parsed = parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function methodSummary(m: ShippingMethodView, fallbackCurrency: string): string {
  const money = (minor: number) =>
    formatMoney({ amountMinor: minor, currencyCode: m.currencyCode ?? fallbackCurrency, exponent: 2 });
  if (m.methodType === "FREE") return "Free";
  if (m.methodType === "SHIPPO_CALCULATED") return "Live carrier rates";
  const parts: string[] = [];
  if (m.rules.baseRateMinor != null) parts.push(money(m.rules.baseRateMinor));
  if (m.rules.perKgRateMinor != null) parts.push(`+ ${money(m.rules.perKgRateMinor)}/kg`);
  if (m.rules.freeAboveMinor != null) parts.push(`free over ${money(m.rules.freeAboveMinor)}`);
  if (m.rules.transitMinDays != null) {
    parts.push(`${m.rules.transitMinDays}–${m.rules.transitMaxDays ?? m.rules.transitMinDays}d`);
  }
  return parts.join("  ·  ") || m.methodType.replaceAll("_", " ").toLowerCase();
}

export default function SellerShippingScreen() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const taxonomy = useMemo(() => createTaxonomyApi(apiClient), [apiClient]);

  const [config, setConfig] = useState<ShippingConfig | null>(null);
  const [countries, setCountries] = useState<CountryView[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [returnsText, setReturnsText] = useState("");
  const [policyExists, setPolicyExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [profileEditing, setProfileEditing] = useState(false);
  const [address, setAddress] = useState<AddressDraft>(emptyAddressDraft());
  const [handlingMin, setHandlingMin] = useState("1");
  const [handlingMax, setHandlingMax] = useState("3");
  const [weightG, setWeightG] = useState("");
  const [lenMm, setLenMm] = useState("");
  const [widMm, setWidMm] = useState("");
  const [hgtMm, setHgtMm] = useState("");

  const [zoneFormOpen, setZoneFormOpen] = useState(false);
  const [zoneEditing, setZoneEditing] = useState<ShippingZoneView | null>(null);
  const [zoneName, setZoneName] = useState("");
  const [zoneCountryIds, setZoneCountryIds] = useState<string[]>([]);
  const [zonePickerOpen, setZonePickerOpen] = useState(false);

  const [methodZoneId, setMethodZoneId] = useState<string | null>(null);
  const [methodEditing, setMethodEditing] = useState<ShippingMethodView | null>(null);
  const [methodName, setMethodName] = useState("");
  const [methodType, setMethodType] = useState("FLAT_RATE");
  const [baseRate, setBaseRate] = useState("");
  const [perKg, setPerKg] = useState("");
  const [freeAbove, setFreeAbove] = useState("");
  const [maxWeight, setMaxWeight] = useState("");
  const [transitMin, setTransitMin] = useState("");
  const [transitMax, setTransitMax] = useState("");

  const [policyEditing, setPolicyEditing] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) return;
    try {
      const [cfg, detail, marketList, countryPage] = await Promise.all([
        api.shippingConfig(shopId),
        api.shopDetail(shopId).catch(() => null),
        api.markets().catch(() => []),
        taxonomy.activeCountries().catch(() => ({ items: [] as CountryView[] })),
      ]);
      setConfig(cfg);
      setCountries(countryPage.items ?? []);
      const market = marketList.find((m) => m.countryId === detail?.shop.primaryMarketCountryId);
      if (market) setCurrency(market.defaultCurrency);
      const policy = detail?.policies.find((p) => p.policyType === "RETURNS");
      setReturnsText(policy?.text ?? "");
      setPolicyExists(!!policy);
      if (cfg.profile) {
        setAddress({
          countryId: cfg.profile.origin.countryId,
          line1: cfg.profile.origin.line1,
          line2: cfg.profile.origin.line2 ?? "",
          city: cfg.profile.origin.city,
          region: cfg.profile.origin.region ?? "",
          postalCode: cfg.profile.origin.postalCode,
        });
        setHandlingMin(String(cfg.profile.handlingMinDays));
        setHandlingMax(String(cfg.profile.handlingMaxDays));
        setWeightG(cfg.profile.defaultWeightGrams?.toString() ?? "");
        setLenMm(cfg.profile.defaultLengthMm?.toString() ?? "");
        setWidMm(cfg.profile.defaultWidthMm?.toString() ?? "");
        setHgtMm(cfg.profile.defaultHeightMm?.toString() ?? "");
      } else {
        setProfileEditing(true);
      }
      if (!policy) setPolicyEditing(true);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load shipping.");
    } finally {
      setLoading(false);
    }
  }, [api, taxonomy, shopId]);

  useEffect(() => { queueMicrotask(() => { setLoading(true); void load(); }); }, [load]);

  const run = useCallback(async (action: () => Promise<unknown>, fail: string) => {
    setSaving(true);
    try {
      await action();
      await load();
      return true;
    } catch (cause) {
      Alert.alert(fail, ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [load]);

  // ---------------------------------------------------------------- handlers

  const saveProfile = async () => {
    const ok = await run(async () => {
      const origin = addressDraftToInput(address);
      const min = intOf(handlingMin);
      const max = intOf(handlingMax);
      if (!origin || min == null || max == null || max < min) {
        throw new Error("Complete the address and a valid handling range.");
      }
      await api.updateShippingProfile(shopId!, {
        origin,
        handlingMinDays: min,
        handlingMaxDays: max,
        defaultWeightGrams: intOf(weightG),
        defaultLengthMm: intOf(lenMm),
        defaultWidthMm: intOf(widMm),
        defaultHeightMm: intOf(hgtMm),
      });
    }, "Could not save dispatch settings");
    if (ok) setProfileEditing(false);
  };

  const openZoneForm = (zone?: ShippingZoneView) => {
    setZoneEditing(zone ?? null);
    setZoneName(zone?.name ?? "");
    setZoneCountryIds(zone?.countries.map((c) => c.id) ?? []);
    setZoneFormOpen(true);
  };

  const saveZone = async () => {
    const ok = await run(async () => {
      if (!zoneName.trim() || zoneCountryIds.length === 0) {
        throw new Error("Name the zone and pick at least one country.");
      }
      if (zoneEditing) {
        await api.updateZone(shopId!, zoneEditing.id, zoneName.trim(), zoneCountryIds);
      } else {
        await api.createZone(shopId!, zoneName.trim(), zoneCountryIds);
      }
    }, "Could not save the zone");
    if (ok) {
      setZoneFormOpen(false);
      setZoneEditing(null);
    }
  };

  const removeZone = (zone: ShippingZoneView) => {
    Alert.alert("Delete zone", `“${zone.name}” and its methods will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive",
        onPress: () => void run(() => api.deleteZone(shopId!, zone.id), "Could not delete the zone") },
    ]);
  };

  const openMethodForm = (zoneId: string, method?: ShippingMethodView) => {
    setMethodZoneId(zoneId);
    setMethodEditing(method ?? null);
    setMethodName(method?.name ?? "");
    setMethodType(method?.methodType ?? "FLAT_RATE");
    setBaseRate(method?.rules.baseRateMinor != null ? (method.rules.baseRateMinor / 100).toString() : "");
    setPerKg(method?.rules.perKgRateMinor != null ? (method.rules.perKgRateMinor / 100).toString() : "");
    setFreeAbove(method?.rules.freeAboveMinor != null ? (method.rules.freeAboveMinor / 100).toString() : "");
    setMaxWeight(method?.rules.maxWeightGrams?.toString() ?? "");
    setTransitMin(method?.rules.transitMinDays?.toString() ?? "");
    setTransitMax(method?.rules.transitMaxDays?.toString() ?? "");
  };

  const closeMethodForm = () => {
    setMethodZoneId(null);
    setMethodEditing(null);
  };

  const saveMethod = async () => {
    const ok = await run(async () => {
      if (!methodName.trim() || !methodZoneId) throw new Error("Name the shipping method.");
      const priced = methodType !== "FREE" && methodType !== "SHIPPO_CALCULATED";
      const base = minorOf(baseRate);
      if (priced && base == null) throw new Error(`Set a base price in ${currency}.`);
      if (methodType === "WEIGHT_BASED" && minorOf(perKg) == null) {
        throw new Error(`Set a per-kg rate in ${currency}.`);
      }
      if (methodType === "FREE_ABOVE_THRESHOLD" && minorOf(freeAbove) == null) {
        throw new Error(`Set the free-shipping threshold in ${currency}.`);
      }
      const input: ShippingMethodInput = {
        name: methodName.trim(),
        methodType,
        currencyCode: priced ? currency : null,
        rules: {
          baseRateMinor: base,
          perKgRateMinor: methodType === "WEIGHT_BASED" ? minorOf(perKg) : null,
          freeAboveMinor: methodType === "FREE_ABOVE_THRESHOLD" ? minorOf(freeAbove) : null,
          maxWeightGrams: intOf(maxWeight),
          transitMinDays: intOf(transitMin),
          transitMaxDays: intOf(transitMax),
        },
      };
      if (methodEditing) {
        await api.updateMethod(shopId!, methodEditing.id, input);
      } else {
        await api.createMethod(shopId!, methodZoneId, input);
      }
    }, "Could not save the method");
    if (ok) closeMethodForm();
  };

  const removeMethod = (method: ShippingMethodView) => {
    Alert.alert("Delete method", `“${method.name}” will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive",
        onPress: () => void run(() => api.deleteMethod(shopId!, method.id), "Could not delete the method") },
    ]);
  };

  const savePolicy = async () => {
    const ok = await run(async () => {
      if (!returnsText.trim()) throw new Error("Write a short returns policy first.");
      await api.updatePolicy(shopId!, "RETURNS", returnsText.trim());
    }, "Could not publish the policy");
    if (ok) setPolicyEditing(false);
  };

  // ---------------------------------------------------------------- render

  if (loading) return <LoadingScreen />;
  if (error || !config) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ErrorState message={error ?? "Shipping unavailable"} onRetry={() => void load()} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const steps = [
    { label: "Dispatch", done: config.profile != null },
    { label: "Zone + method", done: config.zones.some((z) => z.methods.length > 0) },
    { label: "Returns policy", done: policyExists },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const hairline = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border };
  const group = { backgroundColor: theme.backgroundElement, borderRadius: 14, overflow: "hidden" as const };

  const methodForm = (
    <View style={[hairline, { padding: 14, gap: 10 }]}>
      <FormInput label="Name" value={methodName} onChangeText={setMethodName}
        placeholder="Standard, Express…" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {METHOD_TYPES
          .filter((t) => t.key !== "SHIPPO_CALCULATED" || config.providerCalculatedAvailable)
          .map((t) => (
            <Chip key={t.key} label={t.label} selected={methodType === t.key}
              onPress={() => setMethodType(t.key)} />
          ))}
      </View>
      {methodType === "SHIPPO_CALCULATED" ? (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Buyers get real carrier quotes at checkout — no price needed here.
        </ThemedText>
      ) : methodType === "FREE" ? null : (
        <FieldRow>
          <FieldCell>
            <FormInput label={`Price (${currency})`} value={baseRate}
              onChangeText={setBaseRate} keyboardType="decimal-pad" placeholder="4.99" />
          </FieldCell>
          {methodType === "WEIGHT_BASED" ? (
            <FieldCell>
              <FormInput label={`+ per kg (${currency})`} value={perKg}
                onChangeText={setPerKg} keyboardType="decimal-pad" placeholder="1.50" />
            </FieldCell>
          ) : null}
          {methodType === "FREE_ABOVE_THRESHOLD" ? (
            <FieldCell>
              <FormInput label={`Free over (${currency})`} value={freeAbove}
                onChangeText={setFreeAbove} keyboardType="decimal-pad" placeholder="50.00" />
            </FieldCell>
          ) : null}
        </FieldRow>
      )}
      {methodType === "WEIGHT_BASED" ? (
        <FormInput label="Max weight (g, optional)" value={maxWeight}
          onChangeText={setMaxWeight} keyboardType="number-pad" />
      ) : null}
      <FieldRow>
        <FieldCell>
          <FormInput label="Delivery min (days)" value={transitMin}
            onChangeText={setTransitMin} keyboardType="number-pad" placeholder="3" />
        </FieldCell>
        <FieldCell>
          <FormInput label="Delivery max (days)" value={transitMax}
            onChangeText={setTransitMax} keyboardType="number-pad" placeholder="7" />
        </FieldCell>
      </FieldRow>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton label={methodEditing ? "Save" : "Add method"}
            loading={saving} onPress={() => void saveMethod()} />
        </View>
        <Pressable onPress={closeMethodForm}
          style={({ pressed }) => [styles.textBtn, pressed && { opacity: 0.6 }]}>
          <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>Cancel</ThemedText>
        </Pressable>
      </View>
    </View>
  );

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back" hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, flex: 1, fontSize: 20, fontWeight: "700" }}>
            Shipping & returns
          </ThemedText>
        </View>
        <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: insets.bottom + 32 }}>

          {/* ---------- setup progress ---------- */}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <ThemedText type="smallBold" style={{ color: theme.text, flex: 1 }}>
                Setup progress
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {doneCount} of {steps.length} done
              </ThemedText>
            </View>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.backgroundElement,
              overflow: "hidden" }}>
              <View style={{ width: `${(doneCount / steps.length) * 100}%`, height: "100%",
                backgroundColor: doneCount === steps.length ? theme.success : theme.primary,
                borderRadius: 2 }} />
            </View>
            <View style={{ flexDirection: "row", gap: 14 }}>
              {steps.map((s) => (
                <View key={s.label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name={s.done ? "checkmark-circle" : "ellipse-outline"}
                    size={14} color={s.done ? theme.success : theme.textMuted} />
                  <ThemedText type="small"
                    style={{ color: s.done ? theme.text : theme.textSecondary }}>
                    {s.label}
                  </ThemedText>
                </View>
              ))}
            </View>
          </View>

          {/* ---------- dispatch ---------- */}
          <View style={{ gap: 8 }}>
            <ThemedText type="smallBold" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              SHIPS FROM
            </ThemedText>
            {config.profile && !profileEditing ? (
              <Pressable onPress={() => setProfileEditing(true)}
                style={({ pressed }) => [group, styles.summaryRow, pressed && { opacity: 0.75 }]}>
                <Ionicons name="send-outline" size={18} color={theme.primary} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ color: theme.text }} numberOfLines={1}>
                    {config.profile.origin.city}, {config.profile.origin.countryCode}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    Ships in {config.profile.handlingMinDays}–{config.profile.handlingMaxDays} days
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </Pressable>
            ) : (
              <View style={[group, { padding: 14, gap: 10 }]}>
                {!config.profile ? (
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    Where parcels leave from — buyers see this as the dispatch window.
                  </ThemedText>
                ) : null}
                <AddressFields draft={address} countries={countries}
                  onChange={(patch) => setAddress((a) => ({ ...a, ...patch }))} />
                <FieldRow>
                  <FieldCell>
                    <FormInput label="Handling (min days)" value={handlingMin}
                      onChangeText={setHandlingMin} keyboardType="number-pad" />
                  </FieldCell>
                  <FieldCell>
                    <FormInput label="Handling (max days)" value={handlingMax}
                      onChangeText={setHandlingMax} keyboardType="number-pad" />
                  </FieldCell>
                </FieldRow>
                <FormInput label="Default parcel — weight g, L×W×H mm (optional)"
                  value={weightG} onChangeText={setWeightG} keyboardType="number-pad"
                  placeholder="Weight in grams" />
                <FieldRow>
                  <FieldCell><FormInput value={lenMm} onChangeText={setLenMm} keyboardType="number-pad" placeholder="L mm" /></FieldCell>
                  <FieldCell><FormInput value={widMm} onChangeText={setWidMm} keyboardType="number-pad" placeholder="W mm" /></FieldCell>
                  <FieldCell><FormInput value={hgtMm} onChangeText={setHgtMm} keyboardType="number-pad" placeholder="H mm" /></FieldCell>
                </FieldRow>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label="Save" loading={saving}
                      onPress={() => void saveProfile()} />
                  </View>
                  {config.profile ? (
                    <Pressable onPress={() => setProfileEditing(false)}
                      style={({ pressed }) => [styles.textBtn, pressed && { opacity: 0.6 }]}>
                      <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>Cancel</ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            )}
          </View>

          {/* ---------- zones ---------- */}
          <View style={{ gap: 8 }}>
            <ThemedText type="smallBold" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              SHIPPING ZONES
            </ThemedText>
            {config.zones.map((zone) => (
              <View key={zone.id} style={group}>
                <View style={[styles.summaryRow, { paddingHorizontal: 14, paddingVertical: 12 }]}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" style={{ color: theme.text }}>{zone.name}</ThemedText>
                    <ThemedText type="small" style={{ color: theme.textSecondary }} numberOfLines={1}>
                      {zone.countries.map((c) => c.name).join(" · ") || "No countries"}
                    </ThemedText>
                  </View>
                  <Pressable onPress={() => openZoneForm(zone)} hitSlop={8}
                    accessibilityLabel={`Edit ${zone.name}`}>
                    <Ionicons name="pencil-outline" size={17} color={theme.primary} />
                  </Pressable>
                  <Pressable onPress={() => removeZone(zone)} hitSlop={8}
                    accessibilityLabel={`Delete ${zone.name}`}>
                    <Ionicons name="trash-outline" size={17} color={theme.error} />
                  </Pressable>
                </View>
                {zone.methods.map((m) => (
                  <Pressable key={m.id} onPress={() => openMethodForm(zone.id, m)}
                    style={({ pressed }) => [
                      hairline,
                      { flexDirection: "row", alignItems: "center", gap: 10,
                        paddingHorizontal: 14, paddingVertical: 11 },
                      pressed && { opacity: 0.7 },
                    ]}>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="small" style={{ color: theme.text }}>{m.name}</ThemedText>
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>
                        {methodSummary(m, currency)}
                      </ThemedText>
                    </View>
                    <Pressable onPress={() => removeMethod(m)} hitSlop={8}
                      accessibilityLabel={`Delete ${m.name}`}>
                      <Ionicons name="trash-outline" size={15} color={theme.error} />
                    </Pressable>
                  </Pressable>
                ))}
                {methodZoneId === zone.id ? methodForm : (
                  <Pressable onPress={() => openMethodForm(zone.id)}
                    style={({ pressed }) => [
                      hairline,
                      { flexDirection: "row", alignItems: "center", gap: 6,
                        paddingHorizontal: 14, paddingVertical: 11 },
                      pressed && { opacity: 0.7 },
                    ]}>
                    <Ionicons name="add" size={16} color={theme.primary} />
                    <ThemedText type="small" style={{ color: theme.primary }}>
                      Add shipping method
                    </ThemedText>
                  </Pressable>
                )}
              </View>
            ))}
            {zoneFormOpen ? (
              <View style={[group, { padding: 14, gap: 10, borderWidth: 1, borderColor: theme.primary }]}>
                <ThemedText type="smallBold" style={{ color: theme.text }}>
                  {zoneEditing ? `Edit ${zoneEditing.name}` : "New zone"}
                </ThemedText>
                <FormInput label="Name" value={zoneName} onChangeText={setZoneName}
                  placeholder="Domestic, Europe, Worldwide…" />
                <Pressable onPress={() => setZonePickerOpen(true)}
                  style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10,
                    paddingHorizontal: 12, paddingVertical: 12,
                    flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="earth-outline" size={18} color={theme.primary} />
                  <ThemedText style={{ color: zoneCountryIds.length ? theme.text : theme.textMuted, flex: 1 }}>
                    {zoneCountryIds.length
                      ? `${zoneCountryIds.length} ${zoneCountryIds.length === 1 ? "country" : "countries"}`
                      : "Choose countries"}
                  </ThemedText>
                  <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                </Pressable>
                {zoneCountryIds.length > 0 ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {zoneCountryIds.map((id) => {
                      const c = countries.find((x) => x.id === id);
                      return (
                        <Pressable key={id}
                          onPress={() => setZoneCountryIds((ids) => ids.filter((x) => x !== id))}
                          style={{ flexDirection: "row", alignItems: "center", gap: 4,
                            backgroundColor: theme.background, borderRadius: 999,
                            paddingHorizontal: 10, paddingVertical: 5 }}>
                          <ThemedText type="small" style={{ color: theme.text }}>
                            {c ? `${c.flagEmoji ? c.flagEmoji + " " : ""}${c.name}` : id.slice(0, 8)}
                          </ThemedText>
                          <Ionicons name="close" size={13} color={theme.textMuted} />
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label={zoneEditing ? "Save" : "Create zone"}
                      loading={saving} onPress={() => void saveZone()} />
                  </View>
                  <Pressable onPress={() => { setZoneFormOpen(false); setZoneEditing(null); }}
                    style={({ pressed }) => [styles.textBtn, pressed && { opacity: 0.6 }]}>
                    <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>Cancel</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable onPress={() => openZoneForm()}
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", justifyContent: "center",
                    gap: 6, paddingVertical: 13, borderRadius: 14,
                    borderWidth: 1, borderStyle: "dashed", borderColor: theme.border },
                  pressed && { opacity: 0.7 },
                ]}>
                <Ionicons name="add" size={16} color={theme.textSecondary} />
                <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
                  Add shipping zone
                </ThemedText>
              </Pressable>
            )}
            {config.zones.length === 0 && !zoneFormOpen ? (
              <ThemedText type="small" style={{ color: theme.textMuted, paddingHorizontal: 4 }}>
                Group the countries you ship to — e.g. “Domestic”, “Europe”, “Worldwide”.
              </ThemedText>
            ) : null}
          </View>

          {/* ---------- returns ---------- */}
          <View style={{ gap: 8 }}>
            <ThemedText type="smallBold" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              RETURNS POLICY
            </ThemedText>
            {policyExists && !policyEditing ? (
              <Pressable onPress={() => setPolicyEditing(true)}
                style={({ pressed }) => [group, styles.summaryRow, pressed && { opacity: 0.75 }]}>
                <Ionicons name="return-down-back-outline" size={18} color={theme.primary} />
                <ThemedText type="small" style={{ color: theme.text, flex: 1 }} numberOfLines={2}>
                  {returnsText}
                </ThemedText>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </Pressable>
            ) : (
              <View style={[group, { padding: 14, gap: 10 }]}>
                <FormInput value={returnsText} onChangeText={setReturnsText} multiline
                  placeholder="e.g. Returns accepted within 14 days of delivery, items unused. Buyer pays return shipping." />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label="Publish policy" loading={saving}
                      onPress={() => void savePolicy()} />
                  </View>
                  {policyExists ? (
                    <Pressable onPress={() => setPolicyEditing(false)}
                      style={({ pressed }) => [styles.textBtn, pressed && { opacity: 0.6 }]}>
                      <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>Cancel</ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            )}
          </View>
        </KeyboardAwareScrollView>

        <CountryPickerModal
          visible={zonePickerOpen}
          countries={countries}
          selected={zoneCountryIds}
          multiple
          onToggle={(id) => setZoneCountryIds((ids) =>
            ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])}
          onClose={() => setZonePickerOpen(false)}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: 12, letterSpacing: 0.5 },
  summaryRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  textBtn: { alignSelf: "center", paddingHorizontal: 10, paddingVertical: 10 },
});
