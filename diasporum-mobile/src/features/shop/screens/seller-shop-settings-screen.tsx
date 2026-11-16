import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { KeyboardAwareScrollView } from "@/shared/components/keyboard-aware-scroll-view";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createShopApi } from "../services/shop-api";
import { uploadShopImage } from "../services/shop-media";
import { StatusPill } from "../components/shop-ui";
import type { SellerShopDetail } from "../types/shop-types";

/**
 * Edit the shop identity — name, description, logo and cover — plus the shop
 * lifecycle actions (pause an ACTIVE shop, resume a PAUSED one). The individual
 * "Start selling" fast path auto-creates a shop named "{display name}'s shop"
 * with no prompt; this screen is where that gets corrected afterwards.
 */
export default function SellerShopSettingsScreen() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);

  const [detail, setDetail] = useState<SellerShopDetail | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!shopId) return;
    try {
      const d = await api.shopDetail(shopId);
      setDetail(d);
      setName(d.shop.name);
      setDescription(d.shop.description ?? "");
      setLoadError(null);
    } catch (cause) {
      setLoadError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load your shop.");
    } finally {
      setLoading(false);
    }
  }, [api, shopId]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const save = async () => {
    if (!shopId || !name.trim()) return;
    setSaving(true);
    try {
      await api.updateShop(shopId, name.trim(), description.trim() || undefined);
      await load();
    } catch (cause) {
      Alert.alert("Could not save", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const pickImage = async (role: "logo" | "cover") => {
    if (!shopId || !detail) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photos", "Photo library access is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsMultipleSelection: false, quality: 0.9,
      ...(role === "cover" ? { aspect: [16, 9] as [number, number], allowsEditing: true } : {}),
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(role);
    try {
      const mediaId = await uploadShopImage(apiClient, asset.uri,
        (asset.mimeType ?? "image/jpeg").toLowerCase(), "SHOP");
      await api.updateShopMedia(shopId, role === "logo"
        ? { logoMediaId: mediaId }
        : { coverMediaId: mediaId });
      await load();
    } catch (cause) {
      Alert.alert("Upload failed", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setUploading(null);
    }
  };

  const setPaused = (paused: boolean) => {
    const title = paused ? "Pause shop" : "Resume shop";
    const body = paused
      ? "Your items will be hidden from buyers until you resume."
      : "Your shop will go live again if all setup checks pass.";
    Alert.alert(title, body, [
      { text: "Cancel", style: "cancel" },
      { text: title, onPress: async () => {
        setSaving(true);
        try {
          if (paused) {
            await api.pauseShop(shopId!);
          } else {
            await api.submitShop(shopId!);
          }
          await load();
        } catch (cause) {
          Alert.alert("Could not update", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
        } finally {
          setSaving(false);
        }
      } },
    ]);
  };

  if (loading) return <LoadingScreen />;

  const status = detail?.shop.status;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700", flex: 1 }}>Shop settings</ThemedText>
          {status ? <StatusPill status={status} /> : null}
        </View>
        {loadError ? (
          <ErrorState message={loadError} onRetry={() => { setLoading(true); void load(); }} />
        ) : (
          <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }}>
            {/* storefront imagery */}
            <Pressable onPress={() => void pickImage("cover")}
              style={{ height: 120, borderRadius: 14, overflow: "hidden",
                backgroundColor: theme.backgroundElement,
                alignItems: "center", justifyContent: "center", gap: 6 }}>
              {detail?.coverUrl ? (
                <Image source={{ uri: detail.coverUrl }} style={{ width: "100%", height: "100%" }} />
              ) : (
                <>
                  <Ionicons name="image-outline" size={24} color={theme.textMuted} />
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    {uploading === "cover" ? "Uploading…" : "Add a cover photo"}
                  </ThemedText>
                </>
              )}
            </Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable onPress={() => void pickImage("logo")}
                style={{ width: 72, height: 72, borderRadius: 36, overflow: "hidden",
                  backgroundColor: theme.backgroundElement,
                  alignItems: "center", justifyContent: "center" }}>
                {detail?.logoUrl ? (
                  <Image source={{ uri: detail.logoUrl }} style={{ width: "100%", height: "100%" }} />
                ) : (
                  <Ionicons name="storefront-outline" size={24} color={theme.textMuted} />
                )}
              </Pressable>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold" style={{ color: theme.text }}>Shop logo</ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {uploading === "logo" ? "Uploading…" : "Shown next to your shop name and on product pages"}
                </ThemedText>
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <ThemedText type="smallBold" style={{ color: theme.text }}>Shop name</ThemedText>
              <TextInput value={name} onChangeText={setName} placeholder="Shop name"
                placeholderTextColor={theme.textMuted}
                style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, color: theme.text }} />
            </View>
            <View style={{ gap: 6 }}>
              <ThemedText type="smallBold" style={{ color: theme.text }}>Description (optional)</ThemedText>
              <TextInput value={description} onChangeText={setDescription}
                placeholder="Tell buyers what you sell" placeholderTextColor={theme.textMuted}
                multiline numberOfLines={4}
                style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, color: theme.text,
                  minHeight: 96, textAlignVertical: "top" }} />
            </View>
            <PrimaryButton label="Save" onPress={() => void save()} loading={saving} disabled={!name.trim()} />

            {status === "ACTIVE" || status === "PAUSED" ? (
              <View style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 16 }}>
                <PrimaryButton
                  label={status === "ACTIVE" ? "Pause shop" : "Resume shop"}
                  variant="secondary"
                  loading={saving}
                  onPress={() => setPaused(status === "ACTIVE")} />
                <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 8 }}>
                  {status === "ACTIVE"
                    ? "Pausing hides your items from buyers. Orders in progress still need fulfilment."
                    : "Resuming republishes your shop if all setup checks pass."}
                </ThemedText>
              </View>
            ) : null}
          </KeyboardAwareScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
