import React, { useCallback, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { BusinessImage } from "../components/business-image";
import { BusinessReviews } from "../components/business-reviews";
import {
  DirectoryHeader,
  DirectoryMessage,
} from "../components/directory-ui";
import { ReportForm } from "../components/report-form";
import { createDirectoryApi } from "../services/directory-api";
import { createPropertyApi } from "@/features/property/services/property-api";
import { createVehicleApi } from "@/features/vehicles/services/vehicle-api";
import type { PropertyItem } from "@/features/property/types/property-types";
import type { VehicleView } from "@/features/vehicles/types/vehicle-types";
import type {
  BusinessDetail,
  OpeningHour,
} from "../types/directory-types";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function formatHour(hour: OpeningHour): string {
  if (hour.closed) return "Closed";
  return `${hour.openTime?.slice(0, 5) ?? ""}–${hour.closeTime?.slice(0, 5) ?? ""}`;
}

export default function BusinessDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createDirectoryApi(apiClient), [apiClient]);
  const propertyApi = React.useMemo(
    () => createPropertyApi(apiClient),
    [apiClient],
  );
  const vehicleApi = React.useMemo(
    () => createVehicleApi(apiClient),
    [apiClient],
  );
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [profileProperties, setProfileProperties] = useState<PropertyItem[]>([]);
  const [profileVehicles, setProfileVehicles] = useState<VehicleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const result = await api.detail(businessId);
      setDetail(result);
      setError(null);
      if (result.business.status === "PUBLISHED" && result.business.listingCount > 0) {
        Promise.all([
          propertyApi
            .discover({ businessListingId: businessId }, undefined, 6)
            .catch(() => ({ items: [], nextCursor: null })),
          vehicleApi
            .discover({ businessListingId: businessId }, undefined, 6)
            .catch(() => ({ items: [], nextCursor: null })),
        ]).then(([propertyPage, vehiclePage]) => {
          setProfileProperties(propertyPage.items);
          setProfileVehicles(vehiclePage.items);
        });
      } else {
        setProfileProperties([]);
        setProfileVehicles([]);
      }
    } catch (cause) {
      setDetail(null);
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "This business is unavailable or not visible to you.",
      );
    } finally {
      setLoading(false);
    }
  }, [api, businessId, propertyApi, vehicleApi]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = async (key: string, operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await operation();
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "The operation could not be completed.",
      );
      throw cause;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  if (loading) return <LoadingScreen />;

  if (!detail) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
          <DirectoryHeader title="Business" />
          <View style={styles.unavailable}>
            <Ionicons name="storefront-outline" size={44} color={theme.textSecondary} />
            <ThemedText style={styles.unavailableTitle}>Business unavailable</ThemedText>
            <DirectoryMessage error>
              {error ?? "This profile could not be found."}
            </DirectoryMessage>
            <PrimaryButton label="Try again" onPress={() => void load()} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const { business, locations, media } = detail;
  const gallery = media.filter((item) => item.role === "GALLERY");

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <DirectoryHeader
          title="Business"
          action={
            business.canManage ? (
              <Pressable
                onPress={() =>
                  router.push(`/(app)/businesses/${businessId}/manage` as never)
                }
                accessibilityLabel="Manage this business"
              >
                <Ionicons name="settings-outline" size={23} color={theme.text} />
              </Pressable>
            ) : undefined
          }
        />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.cover}>
            <BusinessImage
              businessId={businessId}
              mediaId={business.coverMediaId}
              label={`${business.name} cover`}
            />
            <View style={[styles.logo, { borderColor: theme.background }]}>
              <BusinessImage
                businessId={businessId}
                mediaId={business.logoMediaId}
                label={`${business.name} logo`}
              />
            </View>
          </View>

          <View style={styles.identity}>
            <View style={styles.nameRow}>
              <ThemedText style={styles.name}>{business.name}</ThemedText>
              {business.verificationStatus === "VERIFIED" ? (
                <Ionicons
                  name="checkmark-circle"
                  size={23}
                  color={BrandColors.primary}
                  accessibilityLabel="Verified business"
                />
              ) : null}
            </View>
            <ThemedText style={styles.category} themeColor="textSecondary">
              {business.category?.name ?? "Business"}
              {business.businessAccountName ? ` · ${business.businessAccountName}` : ""}
            </ThemedText>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={17} color={BrandColors.warning} />
              <ThemedText style={styles.ratingText}>
                {business.reviewCount > 0
                  ? `${Number(business.averageRating ?? 0).toFixed(1)} · ${business.reviewCount} reviews`
                  : "No reviews yet"}
              </ThemedText>
            </View>
            {business.status === "DRAFT" ? (
              <ThemedText style={styles.draft}>DRAFT · Managers only</ThemedText>
            ) : null}
          </View>

          {error ? <DirectoryMessage error>{error}</DirectoryMessage> : null}
          {notice ? <DirectoryMessage>{notice}</DirectoryMessage> : null}

          {business.status === "PUBLISHED" ? (
            <View style={styles.primaryActions}>
              <View style={styles.actionButton}>
                <PrimaryButton
                  label={business.saved ? "Unsave business" : "Save business"}
                  variant="secondary"
                  loading={busy === "save"}
                  onPress={() =>
                    void run("save", async () => {
                      if (business.saved) await api.unsave(businessId);
                      else await api.save(businessId);
                      setDetail((previous) =>
                        previous
                          ? {
                              ...previous,
                              business: {
                                ...previous.business,
                                saved: !business.saved,
                              },
                            }
                          : previous,
                      );
                    }).catch(() => undefined)
                  }
                />
              </View>
              {!business.canManage ? (
                <View style={styles.actionButton}>
                  <PrimaryButton
                    label="Contact business"
                    loading={busy === "contact"}
                    onPress={() =>
                      void run("contact", async () => {
                        const result = await api.contact(businessId);
                        router.push(`/(app)/messages/${result.conversationId}` as never);
                      }).catch(() => undefined)
                    }
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          <Section title="About">
            <ThemedText style={styles.body}>{business.description}</ThemedText>
          </Section>

          {business.status === "PUBLISHED" && business.listingCount > 0 ? (
            <Section title={`Listings (${business.listingCount})`}>
              {!profileProperties.length && !profileVehicles.length ? (
                <ThemedText style={styles.meta} themeColor="textSecondary">
                  Loading listings…
                </ThemedText>
              ) : null}
              {profileProperties.map((item) => (
                <PublicListingRow
                  key={item.property.id}
                  title={item.property.title}
                  meta={`${item.property.currencyCode} ${item.property.priceAmount.toLocaleString()} · ${item.property.listingPurpose === "RENT" ? "For rent" : "For sale"}`}
                  icon="home-outline"
                  onPress={() =>
                    router.push(
                      `/(app)/properties/${item.property.id}` as never,
                    )
                  }
                />
              ))}
              {profileVehicles.map((item) => (
                <PublicListingRow
                  key={item.listing.id}
                  title={item.listing.title}
                  meta={`${item.listing.currencyCode ?? ""} ${(item.listing.priceAmount ?? 0).toLocaleString()} · Vehicle`}
                  icon="car-outline"
                  onPress={() =>
                    router.push(`/(app)/vehicles/${item.listing.id}` as never)
                  }
                />
              ))}
            </Section>
          ) : null}

          {business.phone || business.email || business.websiteUrl ? (
            <Section title="Contact details">
              {business.phone ? (
                <ContactRow
                  icon="call-outline"
                  value={business.phone}
                  onPress={() => void Linking.openURL(`tel:${business.phone}`)}
                />
              ) : null}
              {business.email ? (
                <ContactRow
                  icon="mail-outline"
                  value={business.email}
                  onPress={() => void Linking.openURL(`mailto:${business.email}`)}
                />
              ) : null}
              {business.websiteUrl ? (
                <ContactRow
                  icon="globe-outline"
                  value={business.websiteUrl}
                  onPress={() => void Linking.openURL(business.websiteUrl as string)}
                />
              ) : null}
            </Section>
          ) : null}

          <Section title={`Branches and opening hours (${locations.length})`}>
            {locations.length === 0 ? (
              <DirectoryMessage>No public branch information is available.</DirectoryMessage>
            ) : null}
            {locations.map((branch) => (
              <View key={branch.id} style={styles.branch}>
                <View style={styles.branchTitleRow}>
                  <ThemedText style={styles.branchName}>
                    {branch.locationName || "Branch"}
                  </ThemedText>
                  {branch.primary ? (
                    <ThemedText style={styles.primaryBadge}>Primary</ThemedText>
                  ) : null}
                </View>
                <ThemedText style={styles.body}>
                  {branch.address.formattedAddress ||
                    [
                      branch.address.addressLine1,
                      branch.address.addressLine2,
                      branch.address.city,
                      branch.address.region,
                      branch.address.postalCode,
                    ]
                      .filter(Boolean)
                      .join(", ") ||
                    "Address not provided"}
                </ThemedText>
                {branch.phone ? (
                  <ThemedText style={styles.meta} themeColor="textSecondary">
                    {branch.phone}
                  </ThemedText>
                ) : null}
                <ThemedText style={styles.meta} themeColor="textSecondary">
                  Hours in {branch.timezone}
                </ThemedText>
                {branch.hours.map((hour) => (
                  <View key={hour.dayOfWeek} style={styles.hourRow}>
                    <ThemedText style={styles.hourDay}>
                      {WEEKDAYS[hour.dayOfWeek - 1]}
                    </ThemedText>
                    <ThemedText style={styles.hourValue}>{formatHour(hour)}</ThemedText>
                  </View>
                ))}
              </View>
            ))}
          </Section>

          {gallery.length > 0 ? (
            <Section title="Gallery">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.gallery}>
                  {gallery.map((item) => (
                    <View key={item.mediaId} style={styles.galleryImage}>
                      <BusinessImage
                        businessId={businessId}
                        mediaId={item.mediaId}
                        label={`${business.name} gallery image`}
                      />
                    </View>
                  ))}
                </View>
              </ScrollView>
            </Section>
          ) : null}

          {business.status === "PUBLISHED" ? (
            <BusinessReviews
              businessId={businessId}
              canManage={business.canManage}
              onChanged={() => void load()}
            />
          ) : null}

          {!business.canManage && business.status === "PUBLISHED" ? (
            <View style={styles.reportSection}>
              <PrimaryButton
                label={reporting ? "Close report form" : "Report business"}
                variant="ghost"
                onPress={() => setReporting((value) => !value)}
              />
              {reporting ? (
                <ReportForm
                  busy={busy === "report"}
                  onCancel={() => setReporting(false)}
                  onSubmit={async (reason, details) => {
                    await run("report", async () => {
                      await api.reportBusiness(businessId, reason, details);
                      setReporting(false);
                      setNotice("Business reported to platform moderators.");
                    });
                  }}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {children}
    </View>
  );
}

function PublicListingRow({
  title,
  meta,
  icon,
  onPress,
}: {
  title: string;
  meta: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[styles.listingRow, { borderColor: theme.border }]}
    >
      <Ionicons name={icon} size={20} color={BrandColors.primary} />
      <View style={styles.listingCopy}>
        <ThemedText style={styles.listingTitle} numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText style={styles.meta} themeColor="textSecondary">
          {meta}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

function ContactRow({
  icon,
  value,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.contactRow} accessibilityLabel={value}>
      <Ionicons name={icon} size={19} color={BrandColors.primary} />
      <ThemedText style={styles.contactText}>{value}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  content: { paddingBottom: Spacing.six, gap: Spacing.four },
  unavailable: { alignItems: "center", padding: Spacing.five, gap: Spacing.three },
  unavailableTitle: { fontSize: 20, fontWeight: "800" },
  cover: { height: 230, marginBottom: 34 },
  logo: {
    position: "absolute",
    width: 82,
    height: 82,
    borderRadius: 20,
    borderWidth: 3,
    overflow: "hidden",
    left: Spacing.four,
    bottom: -30,
  },
  identity: { paddingHorizontal: Spacing.four, gap: 5 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  name: { flexShrink: 1, fontSize: 27, lineHeight: 34, fontWeight: "800" },
  category: { fontSize: 13, lineHeight: 19 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  ratingText: { fontSize: 13, fontWeight: "700" },
  draft: { color: BrandColors.warning, fontSize: 12, fontWeight: "800" },
  primaryActions: { paddingHorizontal: Spacing.four, flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  actionButton: { flexGrow: 1 },
  section: { paddingHorizontal: Spacing.four, gap: Spacing.three },
  sectionTitle: { fontSize: 20, lineHeight: 27, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 21 },
  meta: { fontSize: 12, lineHeight: 18 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  contactText: { flex: 1, color: BrandColors.primary, fontSize: 14 },
  branch: { gap: 6, paddingBottom: Spacing.three },
  branchTitleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  branchName: { fontSize: 16, fontWeight: "800" },
  primaryBadge: { color: BrandColors.primary, fontSize: 11, fontWeight: "800" },
  hourRow: { flexDirection: "row", justifyContent: "space-between", gap: Spacing.three },
  hourDay: { fontSize: 13 },
  hourValue: { fontSize: 13, fontWeight: "600" },
  listingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  listingCopy: { flex: 1 },
  listingTitle: { fontSize: 14, fontWeight: "700" },
  gallery: { flexDirection: "row", gap: Spacing.three },
  galleryImage: { width: 250, height: 170, borderRadius: BorderRadius.lg, overflow: "hidden" },
  reportSection: { paddingHorizontal: Spacing.four, gap: Spacing.three },
});
