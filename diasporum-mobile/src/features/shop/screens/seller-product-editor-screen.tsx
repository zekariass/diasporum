import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { KeyboardAwareScrollView } from "@/shared/components/keyboard-aware-scroll-view";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createShopApi } from "../services/shop-api";
import { Chip } from "../components/shop-ui";
import type { AttributeDefinition, Category, Market } from "../types/shop-types";

// Must match products.condition CHECK in V28.
const CONDITIONS = ["NEW", "LIKE_NEW", "USED_GOOD", "USED_FAIR", "REFURBISHED", "OTHER"];
const MAX_PHOTOS = 8;

interface VariantDraft {
  key: number;
  label: string;
  sku: string;
  barcode: string;
  price: string;
  compareAt: string;
  stock: string;
  weightGrams: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  /** definitionId -> optionId (ENUM) or raw value (TEXT/NUMBER/DATE) */
  attrs: Record<string, string>;
}

interface PhotoDraft {
  uri: string;
  mediaId: string | null;
  uploading: boolean;
}

let variantSeq = 1;
const newVariant = (): VariantDraft => ({
  key: variantSeq++, label: "", sku: "", barcode: "", price: "", compareAt: "",
  stock: "1", weightGrams: "", lengthMm: "", widthMm: "", heightMm: "", attrs: {},
});

export default function SellerProductEditorScreen() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  useEffect(() => {
    api.categories().then((list) => { setCategories(list); setCategoryId(list[0]?.id ?? null); }).catch(() => {});
    const countryId = session?.profile?.currentCountryId ?? session?.profile?.originCountryId;
    if (countryId) api.market(countryId).then(setMarket).catch(() => {});
  }, [api, session?.profile]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [tags, setTags] = useState("");
  const [condition, setCondition] = useState("LIKE_NEW");
  const [attrDefs, setAttrDefs] = useState<AttributeDefinition[]>([]);
  const [productAttrs, setProductAttrs] = useState<Record<string, string>>({});
  const [variants, setVariants] = useState<VariantDraft[]>([newVariant()]);

  // Category drives which attributes (color, size, material…) exist.
  useEffect(() => {
    queueMicrotask(() => {
      setProductAttrs({});
      if (!categoryId) { setAttrDefs([]); return; }
      void api.attributes(categoryId).then(setAttrDefs).catch(() => setAttrDefs([]));
    });
  }, [api, categoryId]);

  const productDefs = useMemo(
    () => attrDefs.filter((d) => !d.variantLevel).sort((a, b) => a.sortOrder - b.sortOrder),
    [attrDefs]);
  const variantDefs = useMemo(
    () => attrDefs.filter((d) => d.variantLevel).sort((a, b) => a.sortOrder - b.sortOrder),
    [attrDefs]);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const input = { borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: theme.text } as const;

  const uploadPhoto = async (uri: string, mimeType: string): Promise<string> => {
    const file = await (await fetch(uri)).blob();
    const init = await apiClient.post<{ assetId: string; uploadUrl: string }>(
      "/api/v1/media/uploads",
      { purpose: "PRODUCT", mimeType, declaredSizeBytes: file.size },
      { authenticated: true },
    );
    const put = await fetch(init.uploadUrl, {
      method: "PUT", body: file, headers: { "Content-Type": mimeType },
    });
    if (!put.ok) throw new Error("Photo upload failed.");
    await apiClient.post(`/api/v1/media/uploads/${init.assetId}/complete`,
      { declaredSizeBytes: file.size }, { authenticated: true });
    return init.assetId;
  };

  const addPhotos = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photos", "Photo library access is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.9,
      selectionLimit: MAX_PHOTOS - photos.length,
    });
    if (result.canceled) return;
    for (const asset of result.assets.slice(0, MAX_PHOTOS)) {
      const draft: PhotoDraft = { uri: asset.uri, mediaId: null, uploading: true };
      setPhotos((current) => [...current, draft]);
      try {
        const mediaId = await uploadPhoto(asset.uri, (asset.mimeType ?? "image/jpeg").toLowerCase());
        setPhotos((current) => current.map((p) =>
          p.uri === asset.uri ? { ...p, mediaId, uploading: false } : p));
      } catch {
        setPhotos((current) => current.filter((p) => p.uri !== asset.uri));
        Alert.alert("Upload failed", "One photo could not be uploaded.");
      }
    }
  };

  const updateVariant = (key: number, patch: Partial<VariantDraft>) => {
    setVariants((current) => current.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  };

  const save = async () => {
    if (!categoryId || !market) {
      Alert.alert("Check details", "Category is required.");
      return;
    }
    const missing = productDefs.filter((d) => d.required && !productAttrs[d.attributeKey]?.trim());
    if (missing.length) {
      Alert.alert("Missing details", `Required: ${missing.map((d) => d.displayName).join(", ")}`);
      return;
    }
    const built = variants.map((v) => ({
      label: v.label.trim(),
      sku: v.sku.trim() || null,
      barcode: v.barcode.trim() || null,
      weightGrams: v.weightGrams ? parseInt(v.weightGrams, 10) : null,
      lengthMm: v.lengthMm ? parseInt(v.lengthMm, 10) : null,
      widthMm: v.widthMm ? parseInt(v.widthMm, 10) : null,
      heightMm: v.heightMm ? parseInt(v.heightMm, 10) : null,
      // Variant-level attributes — the backend derives the label from these
      // (e.g. "Red / M") when no manual label is given.
      attributes: variantDefs.filter((d) => v.attrs[d.id]?.trim()).map((d) =>
        d.dataType === "ENUM"
          ? { definitionId: d.id, optionId: v.attrs[d.id] }
          : { definitionId: d.id, value: v.attrs[d.id].trim() }),
      prices: [{
        marketCountryId: market.countryId,
        currencyCode: market.defaultCurrency,
        amountMinor: Math.round(parseFloat(v.price.replace(",", ".")) * 100),
        compareAtAmountMinor: v.compareAt.trim()
          ? Math.round(parseFloat(v.compareAt.replace(",", ".")) * 100) : null,
      }],
      initialStock: Math.max(0, parseInt(v.stock, 10) || 0),
    }));
    if (!name.trim() || built.length === 0
        || built.some((v) => !Number.isFinite(v.prices[0].amountMinor) || v.prices[0].amountMinor <= 0)) {
      Alert.alert("Check details", "Name and a valid price for every variant are required.");
      return;
    }
    if (photos.some((p) => p.uploading)) {
      Alert.alert("Photos", "Wait for photos to finish uploading.");
      return;
    }
    setSaving(true);
    try {
      await api.createProduct(shopId!, {
        name: name.trim(),
        description: description.trim() || null,
        brand: brand.trim() || null,
        condition,
        attributes: Object.fromEntries(productDefs
          .filter((d) => productAttrs[d.attributeKey]?.trim())
          .map((d) => [d.attributeKey, productAttrs[d.attributeKey].trim()])),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        categoryId,
        mediaIds: photos.map((p) => p.mediaId!).filter(Boolean),
        marketCountryIds: [market.countryId],
        variants: built,
      });
      router.back();
    } catch (cause) {
      Alert.alert("Could not save", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color={theme.text} /></Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>New product</ThemedText>
        </View>
        <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}>
            {photos.map((p) => (
              <View key={p.uri} style={{ width: 84, height: 84, borderRadius: 10, overflow: "hidden" }}>
                <Image source={{ uri: p.uri }} style={{ width: 84, height: 84 }} />
                {p.uploading ? (
                  <View style={{ position: "absolute", inset: 0, backgroundColor: "#0008",
                    alignItems: "center", justifyContent: "center" }}>
                    <ThemedText type="small" style={{ color: "#fff" }}>…</ThemedText>
                  </View>
                ) : null}
                <Pressable accessibilityLabel="Remove photo"
                  onPress={() => setPhotos((c) => c.filter((x) => x.uri !== p.uri))}
                  style={{ position: "absolute", top: 2, right: 2, backgroundColor: "#000a",
                    borderRadius: 10, padding: 2 }}>
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <Pressable onPress={() => void addPhotos()} accessibilityLabel="Add photos"
                style={{ width: 84, height: 84, borderRadius: 10, borderWidth: 1,
                  borderColor: theme.border, borderStyle: "dashed",
                  alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="camera-outline" size={24} color={theme.textMuted} />
              </Pressable>
            ) : null}
          </ScrollView>

          <TextInput value={name} onChangeText={setName} placeholder="Title" placeholderTextColor={theme.textMuted} style={input} />
          <TextInput value={description} onChangeText={setDescription} placeholder="Description" multiline
            placeholderTextColor={theme.textMuted} style={[input, { minHeight: 90, textAlignVertical: "top" }]} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput value={brand} onChangeText={setBrand} placeholder="Brand (optional)"
              placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
            <TextInput value={tags} onChangeText={setTags} placeholder="Tags, comma-separated"
              placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
          </View>

          <ThemedText type="small" style={{ color: theme.textSecondary }}>Category</ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {categories.map((c) => (
              <Chip key={c.id} label={c.name} selected={categoryId === c.id}
                onPress={() => setCategoryId(c.id)} />
            ))}
          </View>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>Condition</ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CONDITIONS.map((c) => (
              <Chip key={c} label={c.replaceAll("_", " ").toLowerCase()} selected={condition === c}
                onPress={() => setCondition(c)} />
            ))}
          </View>

          {/* Product-level attributes defined by the chosen category (color, material…) */}
          {productDefs.map((d) => (
            <View key={d.id} style={{ gap: 6 }}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {d.displayName}{d.required ? " *" : ""}
              </ThemedText>
              {d.dataType === "ENUM" ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {d.options.map((o) => (
                    <Chip key={o.id} label={o.displayValue}
                      selected={productAttrs[d.attributeKey] === o.optionKey}
                      onPress={() => setProductAttrs((c) => ({
                        ...c,
                        [d.attributeKey]: c[d.attributeKey] === o.optionKey ? "" : o.optionKey,
                      }))} />
                  ))}
                </View>
              ) : d.dataType === "BOOLEAN" ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["true", "false"] as const).map((b) => (
                    <Chip key={b} label={b === "true" ? "Yes" : "No"}
                      selected={productAttrs[d.attributeKey] === b}
                      onPress={() => setProductAttrs((c) => ({ ...c, [d.attributeKey]: b }))} />
                  ))}
                </View>
              ) : (
                <TextInput
                  value={productAttrs[d.attributeKey] ?? ""}
                  onChangeText={(t) => setProductAttrs((c) => ({ ...c, [d.attributeKey]: t }))}
                  placeholder={d.dataType === "DATE" ? "YYYY-MM-DD" : d.displayName}
                  keyboardType={d.dataType === "NUMBER" ? "decimal-pad" : "default"}
                  autoCapitalize="none"
                  placeholderTextColor={theme.textMuted} style={input} />
              )}
            </View>
          ))}

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>Variants</ThemedText>
            <Pressable onPress={() => setVariants((c) => [...c, newVariant()])}>
              <ThemedText type="link" style={{ color: theme.primary }}>+ Add variant</ThemedText>
            </Pressable>
          </View>
          {variants.map((v, i) => (
            <View key={v.key} style={{ backgroundColor: theme.backgroundElement,
              borderRadius: 12, padding: 12, gap: 8 }}>
              {/* Variant-level attributes (Color, Size…) — these name the variant */}
              {variantDefs.map((d) => (
                <View key={d.id} style={{ gap: 4 }}>
                  <ThemedText type="small" style={{ color: theme.textMuted, fontSize: 11 }}>
                    {d.displayName}{d.required ? " *" : ""}
                  </ThemedText>
                  {d.dataType === "ENUM" ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {d.options.map((o) => (
                        <Chip key={o.id} label={o.displayValue}
                          selected={v.attrs[d.id] === o.id}
                          onPress={() => updateVariant(v.key, {
                            attrs: { ...v.attrs, [d.id]: v.attrs[d.id] === o.id ? "" : o.id },
                          })} />
                      ))}
                    </View>
                  ) : (
                    <TextInput value={v.attrs[d.id] ?? ""}
                      onChangeText={(t) => updateVariant(v.key, { attrs: { ...v.attrs, [d.id]: t } })}
                      placeholder={d.dataType === "DATE" ? "YYYY-MM-DD" : d.displayName}
                      keyboardType={d.dataType === "NUMBER" ? "decimal-pad" : "default"}
                      autoCapitalize="none"
                      placeholderTextColor={theme.textMuted} style={input} />
                  )}
                </View>
              ))}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <TextInput value={v.label} onChangeText={(t) => updateVariant(v.key, { label: t })}
                  placeholder={variantDefs.length
                    ? "Variant name (optional — auto from options)"
                    : i === 0 ? "Variant label (e.g. Default)" : `Variant ${i + 1} label`}
                  placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
                {variants.length > 1 ? (
                  <Pressable accessibilityLabel="Remove variant"
                    onPress={() => setVariants((c) => c.filter((x) => x.key !== v.key))}>
                    <Ionicons name="trash-outline" size={18} color={theme.error} />
                  </Pressable>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={v.price} onChangeText={(t) => updateVariant(v.key, { price: t })}
                  placeholder={`Price (${market?.defaultCurrency ?? ""})`} keyboardType="decimal-pad"
                  placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
                <TextInput value={v.compareAt} onChangeText={(t) => updateVariant(v.key, { compareAt: t })}
                  placeholder="Compare-at (optional)" keyboardType="decimal-pad"
                  placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={v.stock} onChangeText={(t) => updateVariant(v.key, { stock: t })}
                  placeholder="Stock" keyboardType="number-pad"
                  placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
                <TextInput value={v.weightGrams} onChangeText={(t) => updateVariant(v.key, { weightGrams: t })}
                  placeholder="Weight g (optional)" keyboardType="number-pad"
                  placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={v.sku} onChangeText={(t) => updateVariant(v.key, { sku: t })}
                  placeholder="SKU (optional)" autoCapitalize="characters"
                  placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
                <TextInput value={v.barcode} onChangeText={(t) => updateVariant(v.key, { barcode: t })}
                  placeholder="Barcode (optional)" autoCapitalize="none"
                  placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
              </View>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <ThemedText type="small" style={{ color: theme.textMuted, fontSize: 11 }}>
                  Parcel mm
                </ThemedText>
                <TextInput value={v.lengthMm} onChangeText={(t) => updateVariant(v.key, { lengthMm: t })}
                  placeholder="L" keyboardType="number-pad"
                  placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
                <TextInput value={v.widthMm} onChangeText={(t) => updateVariant(v.key, { widthMm: t })}
                  placeholder="W" keyboardType="number-pad"
                  placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
                <TextInput value={v.heightMm} onChangeText={(t) => updateVariant(v.key, { heightMm: t })}
                  placeholder="H" keyboardType="number-pad"
                  placeholderTextColor={theme.textMuted} style={[input, { flex: 1 }]} />
              </View>
            </View>
          ))}

          <PrimaryButton label="Save product" onPress={() => void save()} loading={saving} />
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
