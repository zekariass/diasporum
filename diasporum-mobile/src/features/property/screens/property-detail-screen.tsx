import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { createURL } from "expo-linking";
import { useTheme } from "@/hooks/use-theme";
import { Sheet } from "@/shared/components/sheet";
import { PrimaryButton } from "@/shared/components/primary-button";
import { ChoiceChip } from "@/shared/components/form-controls";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { Avatar } from "@/features/feed/components/avatar";
import { BusinessImage } from "@/features/business-directory/components/business-image";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createPropertyApi } from "../services/property-api";
import type { PropertyDetail } from "../types/property-types";
import { PropertyGallery } from "../components/property-gallery";
import { PropertyLocationMap } from "../components/property-location-map";
import {
  HeaderAction,
  PropertyHeader,
  PropertyHighlights,
  PurposeBadge,
} from "../components/property-marketplace-ui";
import { usePropertySave } from "../hooks/use-property-save";
import { ActionButton, PropertyScreen } from "../components/property-controls";
import {
  formatMoney,
  formatPrice,
  locationLabel,
  publishedLabel,
} from "../utils/property-format";

const REPORT_REASONS = [
  "SPAM",
  "SCAM",
  "MISINFORMATION",
  "IMPERSONATION",
  "PRIVACY",
  "OTHER",
] as const;

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const { session } = useSession();
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
    return (
      <PropertyScreen title="Property">
        <ErrorState message="Invalid property link." />
      </PropertyScreen>
    );
  return (
    <PropertyDetails
      key={`${session?.me.id}:${session?.profile?.currentCountryId}:${session?.activeCommunityId}:${id}`}
      id={id}
    />
  );
}

function PropertyDetails({ id }: { id: string }) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"menu" | "report" | "contact" | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const expiresAt = detail?.item.property.expiresAt;
  useEffect(() => {
    const expiry = expiresAt ? new Date(expiresAt).getTime() : NaN;
    if (!Number.isFinite(expiry) || expiry <= now) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(expiry - Date.now(), 0), 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  const generation = useRef(0);
  const actionBusy = useRef(false);
  const save = usePropertySave(id, detail?.item.saved ?? false);

  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await api.detail(id);
      if (request === generation.current) {
        setDetail(result);
        setNow(Date.now());
        setError(null);
      }
    } catch (cause) {
      if (request === generation.current) {
        setDetail(null);
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not load this property.",
        );
      }
    } finally {
      if (request === generation.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [api, id]);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );

  const share = useCallback(async () => {
    if (!detail) return;
    try {
      await Share.share({
        message: `${detail.item.property.title}\n${formatPrice(detail.item)}\n${createURL(`/properties/${id}`)}`,
      });
    } catch {
      setActionError("Could not share this property.");
    }
  }, [detail, id]);

  const lifecycle = useCallback(
    async (
      action: "publish" | "pause" | "reopen" | "close" | "sold" | "rented",
    ) => {
      if (actionBusy.current) return;
      actionBusy.current = true;
      setBusy(true);
      setActionError(null);
      try {
        setDetail(await api[action](id));
        setNow(Date.now());
      } catch (cause) {
        setActionError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : `Could not ${action} the property.`,
        );
      } finally {
        actionBusy.current = false;
        setBusy(false);
      }
    },
    [api, id],
  );

  const confirmClose = useCallback(() => {
    Alert.alert(
      "Close property?",
      "Closing is terminal. This listing cannot be edited or reopened.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Close listing",
          style: "destructive",
          onPress: () => void lifecycle("close"),
        },
      ],
    );
  }, [lifecycle]);

  const enquire = useCallback(async () => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.enquiry(id);
      router.push(`/messages/${result.conversationId}` as never);
    } catch (cause) {
      setActionError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not start a property enquiry.",
      );
    } finally {
      actionBusy.current = false;
      setBusy(false);
    }
  }, [api, id, router]);

  const report = useCallback(
    async (reason: string) => {
      if (actionBusy.current) return;
      actionBusy.current = true;
      setBusy(true);
      setActionError(null);
      try {
        await api.report(id, reason);
        setNotice("Report submitted. Our moderation team will review it.");
        setSheet(null);
      } catch (cause) {
        setActionError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not report this property.",
        );
      } finally {
        actionBusy.current = false;
        setBusy(false);
      }
    },
    [api, id],
  );

  const openContact = useCallback(
    async (kind: "phone" | "whatsapp" | "email", value: string) => {
      const url =
        kind === "email"
          ? `mailto:${value}`
          : kind === "whatsapp"
            ? `https://wa.me/${value.replace(/[^0-9]/g, "")}`
            : `tel:${value}`;
      try {
        await Linking.openURL(url);
      } catch {
        setActionError(
          "Could not open this contact method. You can use Message instead.",
        );
      }
    },
    [],
  );

  if (loading)
    return (
      <PropertyScreen title="Property">
        <LoadingScreen />
      </PropertyScreen>
    );
  if (error || !detail)
    return (
      <PropertyScreen title="Property">
        <ErrorState message={error ?? "Property not found."} onRetry={load} />
      </PropertyScreen>
    );

  const item = detail.item;
  const property = item.property;
  const published = publishedLabel(property.publishedAt);
  const available =
    property.status === "PUBLISHED" &&
    (!property.expiresAt || new Date(property.expiresAt).getTime() > now);
  const contactEnabled = !item.canManage && available;
  const contacts = [
    {
      kind: "whatsapp" as const,
      label: "WhatsApp",
      icon: "logo-whatsapp" as const,
      value: detail.contact?.whatsapp,
    },
    {
      kind: "phone" as const,
      label: "Phone",
      icon: "call-outline" as const,
      value: detail.contact?.phone,
    },
    {
      kind: "email" as const,
      label: "Email",
      icon: "mail-outline" as const,
      value: detail.contact?.email,
    },
  ].filter((contact) => Boolean(contact.value));
  const terminal = ["SOLD", "RENTED", "CLOSED", "REMOVED"].includes(
    property.status,
  );
  const openListing =
    property.status === "PUBLISHED" || property.status === "PAUSED";

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <SafeAreaView
        edges={["top"]}
        style={{ backgroundColor: BrandColors.primaryDark }}
      >
        <PropertyHeader>
          <HeaderAction
            label="Share property"
            icon="share-outline"
            onPress={() => void share()}
          />
          {available || save.saved ? (
            <HeaderAction
              label={
                save.saved ? "Remove from saved properties" : "Save property"
              }
              icon={save.saved ? "bookmark" : "bookmark-outline"}
              disabled={save.pending}
              onPress={() => void save.toggle()}
            />
          ) : null}
          <HeaderAction
            label="More property options"
            icon="ellipsis-vertical"
            onPress={() => setSheet("menu")}
          />
        </PropertyHeader>
      </SafeAreaView>
      <SafeAreaView edges={["left", "right"]} style={styles.root}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={BrandColors.primary}
            />
          }
        >
          <PropertyGallery propertyId={id} media={detail.media} api={api} />
          <View style={styles.body}>
            <View style={styles.statusRow}>
              <PurposeBadge purpose={property.listingPurpose} />
              {published ? (
                <ThemedText themeColor="textSecondary" style={styles.published}>
                  {published}
                </ThemedText>
              ) : null}
            </View>
            {!available ? (
              <ThemedText style={styles.status}>
                {property.status.replaceAll("_", " ")} · Not available for
                enquiries
              </ThemedText>
            ) : null}
            <ThemedText style={styles.title}>{property.title}</ThemedText>
            <ThemedText style={[styles.price, { color: theme.primary }]}>
              {formatPrice(item)}
            </ThemedText>
            <View style={styles.location}>
              <Ionicons
                name="location-outline"
                size={18}
                color={BrandColors.primary}
              />
              <ThemedText style={styles.locationText}>
                {locationLabel(item.location)}
              </ThemedText>
            </View>
            <ThemedText themeColor="textSecondary" style={styles.privacy}>
              Only an approximate location is shown. The exact address remains
              private.
            </ThemedText>

            <PropertyHighlights item={item} />
            <Section title="About this property">
              <ThemedText
                style={styles.description}
                numberOfLines={expanded ? undefined : 4}
              >
                {property.description}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpanded((value) => !value)}
                style={styles.readMore}
              >
                <ThemedText style={{ color: theme.primary, fontWeight: "700" }}>
                  {expanded ? "Read less" : "Read more"}⌄
                </ThemedText>
              </Pressable>
            </Section>
            <Section title="Property information">
              {item.propertyType ? (
                <DetailRow
                  label="Property type"
                  value={item.propertyType.displayName}
                />
              ) : null}
              {property.receptionRooms != null ? (
                <DetailRow
                  label="Reception rooms"
                  value={String(property.receptionRooms)}
                />
              ) : null}
              {property.conditionKey &&
              property.conditionKey !== "UNSPECIFIED" ? (
                <DetailRow
                  label="Condition"
                  value={property.conditionKey
                    .toLowerCase()
                    .replaceAll("_", " ")}
                />
              ) : null}
              {property.listingPurpose === "SALE" && property.tenure ? (
                <DetailRow label="Tenure" value={property.tenure} />
              ) : null}
              {property.furnishedStatus &&
              property.furnishedStatus !== "UNSPECIFIED" ? (
                <DetailRow
                  label="Furnishing"
                  value={property.furnishedStatus
                    .toLowerCase()
                    .replaceAll("_", " ")}
                />
              ) : null}
              {property.availabilityDate ? (
                <DetailRow
                  label="Available from"
                  value={property.availabilityDate}
                />
              ) : null}
              {property.listingPurpose === "RENT" ? (
                <>
                  {property.rentalDeposit != null ? (
                    <DetailRow
                      label="Deposit"
                      value={formatMoney(
                        property.rentalDeposit,
                        property.currencyCode,
                      )}
                    />
                  ) : null}
                  {property.billsIncluded != null ? (
                    <DetailRow
                      label="Bills included"
                      value={property.billsIncluded ? "Yes" : "No"}
                    />
                  ) : null}
                  {property.minimumTenancyMonths != null ? (
                    <DetailRow
                      label="Minimum tenancy"
                      value={`${property.minimumTenancyMonths} months`}
                    />
                  ) : null}
                </>
              ) : null}
              {Object.entries(property.additionalAttributes ?? {}).map(
                ([key, value]) => (
                  <DetailRow
                    key={key}
                    label={key
                      .replace(/([A-Z])/g, " $1")
                      .replace(/^./, (letter) => letter.toUpperCase())}
                    value={
                      Array.isArray(value)
                        ? value.join(", ")
                        : typeof value === "boolean"
                          ? value
                            ? "Yes"
                            : "No"
                          : String(value)
                    }
                  />
                ),
              )}
            </Section>
            {detail.amenities.length ? (
              <Section title="Amenities">
                <View style={styles.amenities}>
                  {detail.amenities.map((amenity) => (
                    <View
                      key={amenity.id}
                      style={[
                        styles.amenityTile,
                        { backgroundColor: theme.backgroundElement },
                      ]}
                    >
                      <Ionicons
                        name={
                          AMENITY_ICONS[amenity.amenityKey] ??
                          "checkmark-circle-outline"
                        }
                        size={25}
                        color={theme.primary}
                      />
                      <ThemedText style={styles.amenityLabel}>
                        {amenity.displayName}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </Section>
            ) : null}
            <Section title="Location">
              <View style={styles.location}>
                <Ionicons name="location" size={18} color={theme.text} />
                <ThemedText style={styles.locationText}>
                  {locationLabel(item.location)}
                </ThemedText>
              </View>
              <PropertyLocationMap location={item.location} />
            </Section>
            <Section title="About the advertiser">
              {detail.listedBy ? (
                <Pressable
                  onPress={() =>
                    router.push(
                      `/(app)/businesses/${detail.listedBy?.businessId}` as never,
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`View ${detail.listedBy.name}`}
                  style={[
                    styles.listedByCard,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <BusinessImage
                    key={`${detail.listedBy.businessId}:${detail.listedBy.logoMediaId}`}
                    businessId={detail.listedBy.businessId}
                    mediaId={detail.listedBy.logoMediaId ?? null}
                    label={`${detail.listedBy.name} logo`}
                    style={styles.advertiserImage}
                  />
                  <View style={styles.listedByCopy}>
                    <View style={styles.listedByNameRow}>
                      <ThemedText style={styles.owner}>
                        {detail.listedBy.name}
                      </ThemedText>
                      {detail.listedBy.verificationStatus === "VERIFIED" ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={16}
                          color={BrandColors.primary}
                        />
                      ) : null}
                    </View>
                    <ThemedText
                      themeColor="textSecondary"
                      style={styles.listedByMeta}
                    >
                      {detail.listedBy.categoryName ?? "Business Profile"}
                      {detail.owner?.businessAccountName
                        ? ` · owned by ${detail.owner.businessAccountName}`
                        : ""}
                    </ThemedText>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={BrandColors.primaryDark}
                  />
                </Pressable>
              ) : (
                <View
                  style={[
                    styles.listedByCard,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  {property.businessAccountId ? (
                    <View style={styles.advertiserIcon}>
                      <Ionicons
                        name="storefront-outline"
                        size={29}
                        color={theme.primary}
                      />
                    </View>
                  ) : (
                    <Avatar
                      key={`${property.ownerUserId}:${detail.owner?.avatarMediaId}`}
                      name={detail.owner?.displayName}
                      mediaId={detail.owner?.avatarMediaId}
                      userId={property.ownerUserId}
                      size={48}
                    />
                  )}
                  <View style={styles.listedByCopy}>
                    <ThemedText style={styles.owner}>
                      {detail.owner?.businessAccountName ??
                        detail.owner?.displayName ??
                        "Diasporum member"}
                    </ThemedText>
                    <ThemedText
                      themeColor="textSecondary"
                      style={styles.listedByMeta}
                    >
                      {property.businessAccountId
                        ? "Business advertiser"
                        : "Individual advertiser"}
                    </ThemedText>
                  </View>
                </View>
              )}
            </Section>

            {contactEnabled && contacts.length ? (
              <Section title="Contact options">
                <View style={styles.contactButtons}>
                  {contacts.map((contact) => (
                    <Pressable
                      key={contact.kind}
                      accessibilityRole="button"
                      accessibilityLabel={contact.label}
                      onPress={() =>
                        void openContact(contact.kind, contact.value!)
                      }
                      style={styles.contactOption}
                    >
                      <Ionicons
                        name={contact.icon}
                        size={28}
                        color={
                          contact.kind === "whatsapp"
                            ? BrandColors.success
                            : theme.primary
                        }
                      />
                      <ThemedText style={styles.amenityLabel}>
                        {contact.label}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </Section>
            ) : null}

            {item.canManage ? (
              <Section title="Manage listing">
                {property.businessAccountId ? (
                  <View
                    style={[
                      styles.ownershipCard,
                      { backgroundColor: theme.primarySurface },
                    ]}
                  >
                    <Ionicons
                      name="briefcase-outline"
                      size={18}
                      color={BrandColors.primary}
                    />
                    <ThemedText style={styles.ownershipText}>
                      Owned by{" "}
                      {detail.owner?.businessAccountName ??
                        "your Business Account"}
                      {detail.listedBy
                        ? ` · published under ${detail.listedBy.name}`
                        : " · no public profile"}
                    </ThemedText>
                  </View>
                ) : null}
                {!terminal ? (
                  <ActionButton
                    label="Edit property"
                    onPress={() =>
                      router.push(`/(app)/properties/edit/${id}` as never)
                    }
                    disabled={busy}
                  />
                ) : null}
                {property.status === "DRAFT" ? (
                  <ActionButton
                    label="Publish property"
                    onPress={() => void lifecycle("publish")}
                    loading={busy}
                  />
                ) : null}
                {property.status === "PUBLISHED" ? (
                  <ActionButton
                    label="Pause property"
                    onPress={() => void lifecycle("pause")}
                    loading={busy}
                  />
                ) : null}
                {property.status === "PAUSED" ||
                property.status === "EXPIRED" ? (
                  <ActionButton
                    label="Reopen property"
                    onPress={() => void lifecycle("reopen")}
                    loading={busy}
                  />
                ) : null}
                {openListing && property.listingPurpose === "SALE" ? (
                  <ActionButton
                    label="Mark as sold"
                    onPress={() => void lifecycle("sold")}
                    disabled={busy}
                  />
                ) : null}
                {openListing && property.listingPurpose === "RENT" ? (
                  <ActionButton
                    label="Mark as rented"
                    onPress={() => void lifecycle("rented")}
                    disabled={busy}
                  />
                ) : null}
                {!terminal ? (
                  <ActionButton
                    label="Close property"
                    onPress={confirmClose}
                    disabled={busy}
                    danger
                  />
                ) : null}
              </Section>
            ) : null}
            {contactEnabled ? (
              <Pressable
                onPress={() => setSheet("report")}
                accessibilityRole="button"
                accessibilityLabel="Report property"
                style={styles.report}
              >
                <Ionicons
                  name="flag-outline"
                  size={15}
                  color={BrandColors.error}
                />
                <ThemedText style={styles.reportText}>
                  Report this property
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
        {actionError || save.error ? (
          <ThemedText accessibilityRole="alert" style={styles.error}>
            {actionError ?? save.error}
          </ThemedText>
        ) : null}
        {notice ? (
          <ThemedText accessibilityLiveRegion="polite" style={styles.notice}>
            {notice}
          </ThemedText>
        ) : null}
        {contactEnabled ? (
          <View
            style={[
              styles.bottomBar,
              {
                paddingBottom: Math.max(insets.bottom, Spacing.two),
                borderTopColor: theme.border,
                backgroundColor: theme.background,
              },
            ]}
          >
            <View style={styles.barPrice}>
              <ThemedText style={styles.published}>Asking price</ThemedText>
              <ThemedText style={styles.barAmount}>
                {formatPrice(item)}
              </ThemedText>
            </View>
            <PrimaryButton
              label="Message"
              variant="secondary"
              loading={busy}
              onPress={() => void enquire()}
              style={styles.barButton}
            />
            <PrimaryButton
              label="Contact"
              disabled={!contacts.length}
              onPress={() => setSheet("contact")}
              style={styles.barButton}
            />
          </View>
        ) : (
          <View style={{ height: insets.bottom }} />
        )}
      </SafeAreaView>
      <Sheet
        visible={sheet !== null}
        title={
          sheet === "report"
            ? "Report Listing"
            : sheet === "contact"
              ? "Contact options"
              : "Property options"
        }
        onClose={() => setSheet(null)}
      >
        {sheet === "menu" ? (
          <>
            <ChoiceChip
              label="Share property"
              selected={false}
              onPress={() => {
                setSheet(null);
                void share();
              }}
            />
            {contactEnabled ? (
              <ChoiceChip
                label="Report Listing"
                selected={false}
                onPress={() => setSheet("report")}
              />
            ) : null}
          </>
        ) : null}
        {sheet === "report" && contactEnabled
          ? REPORT_REASONS.map((reason) => (
              <PrimaryButton
                key={reason}
                variant="ghost"
                label={reason.toLowerCase().replaceAll("_", " ")}
                disabled={busy}
                onPress={() => void report(reason)}
              />
            ))
          : null}
        {sheet === "contact" && contactEnabled
          ? contacts.map((contact) => (
              <PrimaryButton
                key={contact.kind}
                label={contact.label}
                variant="secondary"
                onPress={() => void openContact(contact.kind, contact.value!)}
              />
            ))
          : null}
        {actionError ? (
          <ThemedText accessibilityRole="alert" style={styles.error}>
            {actionError}
          </ThemedText>
        ) : null}
      </Sheet>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.section,
        { borderColor: theme.border, backgroundColor: theme.background },
      ]}
    >
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {children}
    </View>
  );
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText themeColor="textSecondary" style={styles.detailLabel}>
        {label}
      </ThemedText>
      <ThemedText style={styles.detailValue}>{value}</ThemedText>
    </View>
  );
}

const AMENITY_ICONS: Record<
  string,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  PARKING: "car-outline",
  GARDEN: "leaf-outline",
  BALCONY: "sunny-outline",
  INTERNET: "wifi-outline",
  CENTRAL_HEATING: "flame-outline",
  SECURITY: "shield-checkmark-outline",
  SWIMMING_POOL: "water-outline",
  ELEVATOR: "swap-vertical-outline",
  PET_FRIENDLY: "paw-outline",
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  bottomBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
  },
  barPrice: { flexGrow: 1, flexBasis: 100, minWidth: 90 },
  barAmount: { fontSize: 15, lineHeight: 21, fontWeight: "800" },
  barButton: { flexGrow: 1, flexBasis: 85, minWidth: 85 },
  published: { fontSize: 11, lineHeight: 17, flexShrink: 1 },
  readMore: { minHeight: 44, justifyContent: "center" },
  advertiserIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.full,
  },
  advertiserImage: { width: 48, height: 48, borderRadius: BorderRadius.full },
  amenityTile: {
    width: "31%",
    minHeight: 78,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.md,
    padding: Spacing.two,
    gap: Spacing.one,
  },
  amenityLabel: { fontSize: 12, lineHeight: 18, textAlign: "center" },
  contactOption: {
    flex: 1,
    minHeight: 65,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  notice: { padding: Spacing.two, color: BrandColors.success, fontSize: 13 },
  content: { paddingBottom: Spacing.five },
  body: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  statusRow: { flexDirection: "row", justifyContent: "space-between" },
  status: { fontSize: 12, fontWeight: "800", color: BrandColors.primary },
  price: { fontSize: 30, lineHeight: 39, fontWeight: "800" },
  title: { fontSize: 22, lineHeight: 29, fontWeight: "800" },
  location: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  locationText: { flex: 1, fontSize: 15 },
  privacy: { fontSize: 12, lineHeight: 18 },
  section: {
    gap: Spacing.two,
    marginTop: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  sectionTitle: { fontSize: 17, fontWeight: "800" },
  description: { fontSize: 15, lineHeight: 23 },
  amenities: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  owner: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  listedByCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    backgroundColor: BrandColors.primarySurface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  listedByCopy: { flex: 1 },
  listedByNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  listedByMeta: { fontSize: 12, lineHeight: 17 },
  ownershipCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    backgroundColor: BrandColors.primarySurface,
    borderRadius: BorderRadius.md,
    padding: Spacing.two,
  },
  ownershipText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  detailLabel: { flex: 1, fontSize: 14 },
  detailValue: { flex: 1, fontSize: 14, fontWeight: "600", textAlign: "right" },
  contactButtons: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  error: { color: BrandColors.error, fontSize: 13, lineHeight: 19 },
  report: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
    padding: Spacing.three,
  },
  reportText: { color: BrandColors.error, fontSize: 13, fontWeight: "600" },
});
