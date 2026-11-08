import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { safeBack } from "@/core/navigation/safe-back";
import { useTheme } from "@/hooks/use-theme";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

type IconName = ComponentProps<typeof Ionicons>["name"];
type ListingKind = "property" | "vehicle";

const OPTIONS: { kind: ListingKind; icon: IconName; title: string; detail: string }[] = [
  {
    kind: "property",
    icon: "home-outline",
    title: "Property Listing",
    detail: "Homes, apartments and commercial spaces for rent or sale.",
  },
  {
    kind: "vehicle",
    icon: "car-outline",
    title: "Vehicle Listing",
    detail: "Cars, vans and other vehicles for sale or hire.",
  },
];

/**
 * Choose a listing type, optionally in the context of a Business Profile.
 * Property and Vehicle are the only modules whose schema supports an optional
 * business_listing_id association; other features stay account-level.
 */
export default function NewListingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { accountId, businessId, profileName, accountName } =
    useLocalSearchParams<{
      accountId: string;
      businessId?: string;
      profileName?: string;
      accountName?: string;
    }>();
  const [selected, setSelected] = useState<ListingKind | null>(null);

  const decodedProfile = profileName ? decodeURIComponent(profileName) : null;
  const decodedAccount = accountName ? decodeURIComponent(accountName) : null;

  function continueFlow() {
    if (!selected || !accountId) return;
    const profileParam =
      businessId && decodedProfile
        ? `&businessListingId=${businessId}&profileName=${encodeURIComponent(decodedProfile)}`
        : "";
    const base = `businessAccountId=${accountId}${profileParam}`;
    router.push(
      (selected === "property"
        ? `/(app)/properties/create?${base}`
        : `/(app)/vehicles/create?${base}`) as never,
    );
  }

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={[styles.nav, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.navTitle}>Add Listing</ThemedText>
          <View style={styles.navSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText style={styles.contextLead}>
            Create a new listing{decodedProfile ? " for" : ""}
          </ThemedText>
          {decodedProfile ? (
            <ThemedText style={styles.contextName}>{decodedProfile}</ThemedText>
          ) : decodedAccount ? (
            <ThemedText style={styles.contextName}>{decodedAccount}</ThemedText>
          ) : null}
          <View style={styles.options}>
            {OPTIONS.map((option) => {
              const active = selected === option.kind;
              return (
                <Pressable
                  key={option.kind}
                  onPress={() => setSelected(option.kind)}
                  accessibilityRole="button"
                  accessibilityLabel={option.title}
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.option,
                    {
                      backgroundColor: active
                        ? BrandColors.primarySurface
                        : theme.backgroundElement,
                      borderColor: active ? BrandColors.primary : theme.border,
                    },
                  ]}
                >
                  <View style={styles.optionIcon}>
                    <Ionicons
                      name={option.icon}
                      size={24}
                      color={BrandColors.primary}
                    />
                  </View>
                  <View style={styles.optionCopy}>
                    <ThemedText style={styles.optionTitle}>
                      {option.title}
                    </ThemedText>
                    <ThemedText
                      style={styles.optionDetail}
                      themeColor="textSecondary"
                    >
                      {option.detail}
                    </ThemedText>
                  </View>
                  <Ionicons
                    name={active ? "radio-button-on" : "radio-button-off"}
                    size={22}
                    color={active ? BrandColors.primary : theme.textSecondary}
                  />
                </Pressable>
              );
            })}
          </View>
          <View
            style={[
              styles.ownership,
              {
                backgroundColor: BrandColors.primarySurface,
                borderColor: theme.border,
              },
            ]}
          >
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={BrandColors.primaryDark}
            />
            <ThemedText style={styles.ownershipText}>
              {decodedProfile
                ? `The listing will be owned by ${decodedAccount ?? "your Business Account"} and published under ${decodedProfile}.`
                : `The listing will be owned by ${decodedAccount ?? "your Business Account"}. You can choose a public Business Profile on the next step, or leave it unassociated.`}
            </ThemedText>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton
            label="Continue"
            onPress={continueFlow}
            disabled={!selected}
          />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  nav: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
  },
  navTitle: { fontSize: 16, fontWeight: "700" },
  navSpacer: { width: 24 },
  content: { padding: Spacing.four, flexGrow: 1 },
  contextLead: { fontSize: 14, lineHeight: 20 },
  contextName: { fontSize: 22, lineHeight: 30, fontWeight: "800" },
  options: { gap: Spacing.three, marginTop: Spacing.four },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    borderWidth: 1.5,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  optionIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.primarySurface,
  },
  optionCopy: { flex: 1 },
  optionTitle: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  optionDetail: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  ownership: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    marginTop: Spacing.four,
  },
  ownershipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: BrandColors.primaryDark,
  },
  footer: { padding: Spacing.four },
});
