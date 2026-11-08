import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { createBusinessApi } from "@/features/business/services/business-api";
import type { BusinessAccount } from "@/features/business/types/business-types";
import { useTheme } from "@/hooks/use-theme";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PhotoViewerModal } from "@/shared/components/photo-viewer-modal";
import { PrimaryButton } from "@/shared/components/primary-button";
import { Sheet } from "@/shared/components/sheet";
import {
  PropertyHeader as MarketplaceHeader,
  HeaderAction,
  PurposeBadge,
} from "@/features/property/components/property-marketplace-ui";
import { VehicleHighlights, VehicleImage } from "../components/vehicle-card";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createVehicleApi } from "../services/vehicle-api";
import type { VehicleView } from "../types/vehicle-types";
import { vehicleErrorMessage } from "../utils/vehicle-error";
import {
  formatVehicleDistance,
  formatVehicleLocation,
  formatVehiclePrice,
  formatVehiclePublished,
  formatVehicleMileage,
  vehicleLabel,
} from "../utils/vehicle-format";

const REPORT_REASONS = [
  "SCAM",
  "SPAM",
  "MISINFORMATION",
  "IMPERSONATION",
  "OTHER",
];
const MANAGER_ROLES = new Set([
  "OWNER",
  "ADMINISTRATOR",
  "EDITOR",
  "LISTING_MANAGER",
]);

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const windowWidth = useWindowDimensions().width;
  const [galleryWidth, setGalleryWidth] = useState(Math.min(windowWidth, 720));
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createVehicleApi(apiClient), [apiClient]);
  const [detail, setDetail] = useState<VehicleView | null>(null);
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [activeSheet, setActiveSheet] = useState<
    "message" | "contact" | "more" | "report" | null
  >(null);
  const savePending = useRef(false);
  const resolveMedia = useCallback(
    (mediaId: string) =>
      api.mediaDownloadUrl(id, mediaId).then((result) => result.downloadUrl),
    [api, id],
  );

  const load = useCallback(
    () =>
      api
        .detail(id)
        .then((result) => {
          setDetail(result);
          setError(null);
        })
        .catch((cause: unknown) =>
          setError(vehicleErrorMessage(cause, "Failed to load vehicle.")),
        )
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        }),
    [api, id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    createBusinessApi(apiClient)
      .accounts()
      .then((result) =>
        setAccounts(
          result.items.filter(
            (account) =>
              account.status === "ACTIVE" && MANAGER_ROLES.has(account.role),
          ),
        ),
      )
      .catch(() => setAccounts([]));
  }, [apiClient]);

  const run = useCallback(
    async (action: () => Promise<unknown>, reload = true) => {
      if (busy) return;
      setBusy(true);
      setActionError(null);
      try {
        await action();
        if (reload) await load();
      } catch (cause) {
        setActionError(
          vehicleErrorMessage(cause, "The action could not be completed."),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  async function toggleSave() {
    if (!detail || savePending.current) return;
    savePending.current = true;
    const saved = !detail.listing.saved;
    setDetail({ ...detail, listing: { ...detail.listing, saved } });
    try {
      if (saved) await api.save(id);
      else await api.unsave(id);
    } catch (cause) {
      setDetail((previous) =>
        previous
          ? { ...previous, listing: { ...previous.listing, saved: !saved } }
          : previous,
      );
      setActionError(
        vehicleErrorMessage(cause, "Could not update saved vehicles."),
      );
    } finally {
      savePending.current = false;
    }
  }

  function contact() {
    setActiveSheet("message");
  }

  async function openConversation(actingBusinessAccountId?: string) {
    await run(async () => {
      const result = await api.contact(id, actingBusinessAccountId);
      setActiveSheet(null);
      router.push(`/messages/${result.conversationId}` as never);
    }, false);
  }

  function share() {
    if (!detail) return;
    const listing = detail.listing;
    void Share.share({
      message: `${listing.title} — ${formatVehiclePrice(listing)} on Diasporum Vehicles`,
    }).catch(() => undefined);
  }

  function openChannel(kind: "phone" | "whatsapp" | "email", value: string) {
    const url =
      kind === "phone"
        ? `tel:${value.replace(/[^+\d]/g, "")}`
        : kind === "whatsapp"
          ? `https://wa.me/${value.replace(/\D/g, "")}`
          : `mailto:${value}`;
    Linking.openURL(url).catch(() =>
      setActionError(
        `Could not open ${kind === "whatsapp" ? "WhatsApp" : kind} on this device.`,
      ),
    );
  }

  function remove() {
    Alert.alert(
      "Remove vehicle?",
      "The listing will no longer appear in discovery or owner collections.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            void run(async () => {
              await api.remove(id);
              router.replace("/(app)/vehicles/my" as never);
            }, false),
        },
      ],
    );
  }

  if (loading) return <LoadingScreen message="Loading vehicle…" />;
  if (error || !detail)
    return (
      <ErrorState message={error ?? "Vehicle not found."} onRetry={load} />
    );

  const vehicle = detail.listing;
  const media = [...detail.media].sort(
    (a, b) => Number(b.cover) - Number(a.cover) || a.sortOrder - b.sortOrder,
  );
  const published = formatVehiclePublished(vehicle.publishedAt);
  const canContact = !detail.canManage && vehicle.status === "PUBLISHED";
  const channels = (
    detail.contact
      ? [
          {
            kind: "whatsapp" as const,
            label: "WhatsApp",
            icon: "logo-whatsapp" as const,
            value: detail.contact.whatsapp,
          },
          {
            kind: "phone" as const,
            label: "Phone",
            icon: "call-outline" as const,
            value: detail.contact.phone,
          },
          {
            kind: "email" as const,
            label: "Email",
            icon: "mail-outline" as const,
            value: detail.contact.email,
          },
        ]
      : []
  ).filter((channel) => channel.value);
  const advertiserName =
    detail.listedBy?.name ??
    detail.seller?.businessName ??
    detail.seller?.displayName ??
    (detail.seller?.username
      ? `@${detail.seller.username}`
      : "Vehicle advertiser");
  const advertiserRoute = detail.listedBy
    ? `/(app)/businesses/${detail.listedBy.businessId}`
    : null;
  const editable = ["DRAFT", "PUBLISHED", "PAUSED", "EXPIRED"].includes(
    vehicle.status,
  );
  const completable = ["PUBLISHED", "PAUSED"].includes(vehicle.status);
  const distance = formatVehicleDistance(vehicle.distanceMeters);
  const specifications: [string, string | number | null][] = [
    ["Category", vehicle.categoryName],
    ["Make", vehicle.makeName],
    ["Model", vehicle.modelName],
    ["Variant", vehicle.variantName],
    ["Model year", vehicle.modelYear],
    ["Registration year", vehicle.registrationYear],
    ["Mileage", formatVehicleMileage(vehicle)],
    ["Fuel", vehicleLabel(vehicle.fuelType)],
    ["Transmission", vehicleLabel(vehicle.transmission)],
    ["Drive", vehicleLabel(vehicle.driveType)],
    ["Body", vehicleLabel(vehicle.bodyType)],
    [
      "Engine",
      vehicle.engineSizeCc === null ? null : `${vehicle.engineSizeCc} cc`,
    ],
    ["Colour", vehicle.colour],
    ["Doors", vehicle.doors],
    ["Seats", vehicle.seats],
    [
      "Condition",
      vehicle.conditionKey ? vehicleLabel(vehicle.conditionKey) : null,
    ],
    ["Previous owners", vehicle.previousOwners],
    ["MOT expiry", vehicle.motExpiry],
    [
      "Service history",
      vehicle.serviceHistory ? vehicleLabel(vehicle.serviceHistory) : null,
    ],
    [
      "Rental deposit",
      vehicle.rentalDeposit === null
        ? null
        : `${vehicle.currencyCode} ${vehicle.rentalDeposit}`,
    ],
    [
      "Mileage allowance",
      vehicle.mileageAllowance == null
        ? null
        : `${vehicle.mileageAllowance.toLocaleString()}${vehicle.mileageUnit === "KM" ? " km" : vehicle.mileageUnit === "MILES" ? " mi" : ""}`,
    ],
    ...Object.entries(vehicle.additionalAttributes).map(
      ([key, value]) => [key, String(value)] as [string, string],
    ),
  ];

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView
        style={[styles.root, { backgroundColor: BrandColors.primaryDark }]}
        edges={["top", "left", "right"]}
      >
        <MarketplaceHeader>
          <HeaderAction
            label="Share vehicle"
            icon="share-outline"
            onPress={share}
          />
          <HeaderAction
            label={vehicle.saved ? "Unsave vehicle" : "Save vehicle"}
            icon={vehicle.saved ? "bookmark" : "bookmark-outline"}
            onPress={() => void toggleSave()}
          />
          <HeaderAction
            label="More vehicle options"
            icon="ellipsis-vertical"
            onPress={() => setActiveSheet("more")}
          />
        </MarketplaceHeader>
        <View style={[styles.body, { backgroundColor: theme.background }]}>
          <ScrollView
            contentContainerStyle={{
              paddingBottom: canContact ? 16 : insets.bottom + 24,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={BrandColors.primary}
                onRefresh={() => {
                  setRefreshing(true);
                  void load();
                }}
              />
            }
          >
            <View
              onLayout={(event) =>
                setGalleryWidth(event.nativeEvent.layout.width)
              }
            >
              {media.length ? (
                <FlatList
                  key={`${id}:${galleryWidth}`}
                  testID="vehicle-gallery"
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  data={media}
                  keyExtractor={(item) => item.id}
                  initialScrollIndex={Math.min(galleryIndex, media.length - 1)}
                  getItemLayout={(_, index) => ({
                    length: galleryWidth,
                    offset: galleryWidth * index,
                    index,
                  })}
                  onMomentumScrollEnd={(event) =>
                    setGalleryIndex(
                      Math.max(
                        0,
                        Math.min(
                          media.length - 1,
                          Math.round(
                            event.nativeEvent.contentOffset.x / galleryWidth,
                          ),
                        ),
                      ),
                    )
                  }
                  renderItem={({ item, index }) => (
                    <Pressable
                      onPress={() => setViewerIndex(index)}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${vehicle.title} image ${index + 1} full screen`}
                    >
                      <VehicleImage
                        key={`${item.id}:${item.downloadUrl}`}
                        vehicleId={id}
                        media={item}
                        label={`${vehicle.title} photo ${index + 1}`}
                        style={{
                          width: galleryWidth,
                          height: Math.min(galleryWidth * 0.64, 400),
                        }}
                      />
                    </Pressable>
                  )}
                />
              ) : (
                <VehicleImage
                  vehicleId={id}
                  label="No vehicle image"
                  style={{
                    width: galleryWidth,
                    height: Math.min(galleryWidth * 0.64, 400),
                  }}
                />
              )}
              {media.length ? (
                <>
                  <View pointerEvents="none" style={styles.galleryCounter}>
                    <Ionicons
                      name="images-outline"
                      size={14}
                      color={BrandColors.white}
                    />
                    <ThemedText style={styles.counterText}>
                      {Math.min(galleryIndex + 1, media.length)} /{" "}
                      {media.length}
                    </ThemedText>
                  </View>
                  <View pointerEvents="none" style={styles.dots}>
                    {media.length <= 8
                      ? media.map((item, index) => (
                          <View
                            key={item.id}
                            style={[
                              styles.dot,
                              { opacity: index === galleryIndex ? 1 : 0.45 },
                            ]}
                          />
                        ))
                      : null}
                  </View>
                </>
              ) : null}
            </View>
            <View style={styles.content}>
              <View style={styles.summaryMeta}>
                <PurposeBadge purpose={vehicle.listingPurpose} />
                {published ? (
                  <ThemedText style={styles.hint} themeColor="textSecondary">
                    {published}
                  </ThemedText>
                ) : null}
              </View>
              <View style={styles.titleRow}>
                <View style={styles.titleBlock}>
                  <ThemedText type="title" style={styles.title}>
                    {vehicle.title}
                  </ThemedText>
                  <ThemedText style={styles.price}>
                    {formatVehiclePrice(vehicle)}
                  </ThemedText>
                </View>
                {vehicle.status !== "PUBLISHED" ? (
                  <View
                    style={[
                      styles.status,
                      { backgroundColor: theme.backgroundElement },
                    ]}
                  >
                    <ThemedText style={styles.statusText}>
                      {vehicleLabel(vehicle.status)}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              <InfoRow
                icon="location-outline"
                text={`${formatVehicleLocation(detail.location)}${distance ? ` · ${distance}` : ""}`}
              />
              <InfoRow
                icon="car-outline"
                text={`${vehicle.listingPurpose === "SALE" ? "For sale" : "For rent"} · ${vehicleLabel(vehicle.visibilityScope)}`}
              />
              <VehicleHighlights vehicle={vehicle} />
              <Section title="About this vehicle">
                <ThemedText
                  style={styles.description}
                  numberOfLines={
                    expanded ||
                    (vehicle.description.length <= 180 &&
                      vehicle.description.split("\n").length <= 4)
                      ? undefined
                      : 4
                  }
                >
                  {vehicle.description}
                </ThemedText>
                {vehicle.description.length > 180 ||
                vehicle.description.split("\n").length > 4 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    onPress={() => setExpanded((value) => !value)}
                    style={styles.readMore}
                  >
                    <ThemedText style={styles.readMoreText}>
                      {expanded ? "Read less" : "Read more"}
                    </ThemedText>
                    <Ionicons
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={theme.primary}
                    />
                  </Pressable>
                ) : null}
              </Section>
              {[
                {
                  title: "Vehicle information",
                  rows: specifications.slice(0, 7),
                },
                { title: "Specifications", rows: specifications.slice(7) },
              ].map((section) => (
                <Section key={section.title} title={section.title}>
                  {section.rows
                    .filter(
                      ([, value]) =>
                        value != null &&
                        value !== "" &&
                        value !== "Not specified",
                    )
                    .map(([label, value]) => (
                      <View
                        key={label}
                        style={[
                          styles.specRow,
                          { borderBottomColor: theme.border },
                        ]}
                      >
                        <ThemedText style={styles.specLabel}>
                          {vehicleLabel(label)}
                        </ThemedText>
                        <ThemedText style={styles.specValue}>
                          {value}
                        </ThemedText>
                      </View>
                    ))}
                </Section>
              ))}
              {vehicle.rentalConditions ? (
                <Section title="Rental conditions">
                  <ThemedText style={styles.description}>
                    {vehicle.rentalConditions}
                  </ThemedText>
                </Section>
              ) : null}
              {detail.features.length ? (
                <Section title="Features">
                  <View style={styles.features}>
                    {detail.features.map((feature) => (
                      <View
                        key={feature.id}
                        style={[
                          styles.feature,
                          { backgroundColor: theme.backgroundElement },
                        ]}
                      >
                        <Ionicons
                          name={featureIcon(feature.featureKey)}
                          size={27}
                          color={theme.primary}
                        />
                        <ThemedText style={styles.featureText}>
                          {feature.displayName}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                </Section>
              ) : null}
              <Section title="Location">
                <InfoRow
                  icon="location"
                  text={formatVehicleLocation(detail.location)}
                />
                <ThemedText style={styles.hint} themeColor="textSecondary">
                  Public area only. The advertiser’s exact address is not shown.
                </ThemedText>
              </Section>
              {detail.seller || detail.listedBy ? (
                <Section title="About the advertiser">
                  <Pressable
                    disabled={!advertiserRoute}
                    accessibilityRole={advertiserRoute ? "button" : undefined}
                    accessibilityLabel={`Listed by ${advertiserName}`}
                    onPress={() => {
                      if (advertiserRoute)
                        router.push(advertiserRoute as never);
                    }}
                    style={styles.advertiser}
                  >
                    <View
                      style={[
                        styles.avatar,
                        { backgroundColor: theme.primarySurface },
                      ]}
                    >
                      <Ionicons
                        name={
                          detail.listedBy || detail.seller?.businessAccountId
                            ? "storefront-outline"
                            : "person-outline"
                        }
                        size={28}
                        color={theme.primary}
                      />
                    </View>
                    <View style={styles.listedByCopy}>
                      <View style={styles.listedByNameRow}>
                        <ThemedText style={styles.listedByName}>
                          {advertiserName}
                        </ThemedText>
                        {detail.listedBy?.verificationStatus === "VERIFIED" ? (
                          <Ionicons
                            name="checkmark-circle"
                            size={16}
                            color={theme.primary}
                          />
                        ) : null}
                      </View>
                      <ThemedText
                        style={styles.hint}
                        themeColor="textSecondary"
                      >
                        {detail.listedBy || detail.seller?.businessAccountId
                          ? "Business advertiser"
                          : "Individual advertiser"}
                      </ThemedText>
                    </View>
                    {advertiserRoute ? (
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={theme.textSecondary}
                      />
                    ) : null}
                  </Pressable>
                </Section>
              ) : null}
              {vehicle.expiresAt ? (
                <InfoRow
                  icon="time-outline"
                  text={`Listing expires ${vehicle.expiresAt.slice(0, 10)}`}
                />
              ) : null}
              {!detail.canManage &&
              detail.contact &&
              (detail.contact.phone ||
                detail.contact.whatsapp ||
                detail.contact.email) ? (
                <Section title="Contact">
                  <View style={styles.contactRow}>
                    {detail.contact.phone ? (
                      <Pressable
                        style={[
                          styles.contactChip,
                          { borderColor: theme.border },
                        ]}
                        onPress={() =>
                          openChannel("phone", detail.contact!.phone!)
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Call seller${detail.contact.preferredMethod === "PHONE" ? " (preferred)" : ""}`}
                      >
                        <Ionicons
                          name="call-outline"
                          size={16}
                          color={BrandColors.primary}
                        />
                        <ThemedText style={styles.contactText}>
                          {detail.contact.phone}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {detail.contact.whatsapp ? (
                      <Pressable
                        style={[
                          styles.contactChip,
                          { borderColor: theme.border },
                        ]}
                        onPress={() =>
                          openChannel("whatsapp", detail.contact!.whatsapp!)
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`WhatsApp seller${detail.contact.preferredMethod === "WHATSAPP" ? " (preferred)" : ""}`}
                      >
                        <Ionicons
                          name="logo-whatsapp"
                          size={16}
                          color={BrandColors.primary}
                        />
                        <ThemedText style={styles.contactText}>
                          {detail.contact.whatsapp}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {detail.contact.email ? (
                      <Pressable
                        style={[
                          styles.contactChip,
                          { borderColor: theme.border },
                        ]}
                        onPress={() =>
                          openChannel("email", detail.contact!.email!)
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Email seller${detail.contact.preferredMethod === "EMAIL" ? " (preferred)" : ""}`}
                      >
                        <Ionicons
                          name="mail-outline"
                          size={16}
                          color={BrandColors.primary}
                        />
                        <ThemedText style={styles.contactText}>
                          {detail.contact.email}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                  {detail.contact.preferredMethod &&
                  detail.contact.preferredMethod !== "MESSAGING" ? (
                    <ThemedText style={styles.hint} themeColor="textSecondary">
                      Seller prefers{" "}
                      {vehicleLabel(
                        detail.contact.preferredMethod,
                      ).toLowerCase()}
                      .
                    </ThemedText>
                  ) : null}
                </Section>
              ) : null}
              {actionError ? (
                <ThemedText style={styles.error} accessibilityRole="alert">
                  {actionError}
                </ThemedText>
              ) : null}
              <View style={styles.actions}>
                {detail.canManage && editable ? (
                  <PrimaryButton
                    label="Edit vehicle"
                    variant="secondary"
                    onPress={() =>
                      router.push(`/(app)/vehicles/edit/${id}` as never)
                    }
                  />
                ) : null}
                {detail.canManage &&
                ["DRAFT", "PAUSED", "EXPIRED"].includes(vehicle.status) ? (
                  <PrimaryButton
                    label={
                      vehicle.status === "DRAFT"
                        ? "Publish vehicle"
                        : "Publish again"
                    }
                    disabled={busy}
                    onPress={() => void run(() => api.publish(id))}
                  />
                ) : null}
                {detail.canManage && vehicle.status === "PUBLISHED" ? (
                  <PrimaryButton
                    label="Pause listing"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => void run(() => api.pause(id))}
                  />
                ) : null}
                {detail.canManage && completable ? (
                  <PrimaryButton
                    label={
                      vehicle.listingPurpose === "SALE"
                        ? "Mark as sold"
                        : "Mark as rented"
                    }
                    variant="secondary"
                    disabled={busy}
                    onPress={() =>
                      void run(() =>
                        vehicle.listingPurpose === "SALE"
                          ? api.sold(id)
                          : api.rented(id),
                      )
                    }
                  />
                ) : null}
                {detail.canManage &&
                !["SOLD", "RENTED", "REMOVED"].includes(vehicle.status) ? (
                  <PrimaryButton
                    label="Remove vehicle"
                    variant="danger"
                    disabled={busy}
                    onPress={remove}
                  />
                ) : null}
              </View>
            </View>
          </ScrollView>
          {canContact ? (
            <View
              testID="vehicle-contact-bar"
              style={[
                styles.contactBar,
                {
                  borderTopColor: theme.border,
                  backgroundColor: theme.background,
                  paddingBottom: Math.max(insets.bottom, 12),
                },
              ]}
            >
              <View style={styles.barPrice}>
                <ThemedText style={styles.hint} themeColor="textSecondary">
                  Price
                </ThemedText>
                <ThemedText style={styles.barPriceText}>
                  {formatVehiclePrice(vehicle)}
                </ThemedText>
              </View>
              <Pressable
                onPress={contact}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Message seller"
                accessibilityState={{ disabled: busy }}
                style={[
                  styles.barButton,
                  {
                    backgroundColor: theme.primarySurface,
                    opacity: busy ? 0.5 : 1,
                  },
                ]}
              >
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={19}
                  color={theme.primary}
                />
                <ThemedText
                  style={[styles.barButtonText, { color: theme.primary }]}
                >
                  Message
                </ThemedText>
              </Pressable>
              {channels.length ? (
                <Pressable
                  onPress={() => setActiveSheet("contact")}
                  accessibilityRole="button"
                  accessibilityLabel="Contact seller"
                  style={[
                    styles.barButton,
                    { backgroundColor: BrandColors.primaryDark },
                  ]}
                >
                  <Ionicons
                    name="call-outline"
                    size={18}
                    color={BrandColors.white}
                  />
                  <ThemedText
                    style={[styles.barButtonText, { color: BrandColors.white }]}
                  >
                    Contact
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
        <Sheet
          visible={activeSheet !== null}
          title={
            activeSheet === "report"
              ? "Report vehicle"
              : activeSheet === "message"
                ? "Message seller"
                : activeSheet === "contact"
                  ? "Contact seller"
                  : "Vehicle options"
          }
          onClose={() => setActiveSheet(null)}
        >
          {activeSheet === "more" ? (
            <>
              <PrimaryButton
                label="Share vehicle"
                variant="secondary"
                onPress={share}
              />
              <PrimaryButton
                label={vehicle.saved ? "Unsave vehicle" : "Save vehicle"}
                variant="secondary"
                onPress={() => void toggleSave()}
              />
              {!detail.canManage ? (
                <PrimaryButton
                  label="Report vehicle"
                  variant="secondary"
                  onPress={() => setActiveSheet("report")}
                />
              ) : null}
            </>
          ) : null}
          {activeSheet === "report" ? (
            <>
              <ThemedText>Why are you reporting this listing?</ThemedText>
              {REPORT_REASONS.map((reason) => (
                <PrimaryButton
                  key={reason}
                  label={vehicleLabel(reason)}
                  variant="secondary"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await api.report(id, reason);
                      setActiveSheet(null);
                    }, false)
                  }
                />
              ))}
            </>
          ) : null}
          {activeSheet === "message" ? (
            <>
              <ThemedText style={styles.description}>
                Choose the account for this conversation.
              </ThemedText>
              <PrimaryButton
                label="Contact as personal account"
                disabled={busy}
                onPress={() => void openConversation()}
              />
              {accounts.map((account) => (
                <PrimaryButton
                  key={account.id}
                  label={`Contact as ${account.accountName}`}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void openConversation(account.id)}
                />
              ))}
            </>
          ) : null}
          {activeSheet === "contact"
            ? channels.map((channel) => (
                <Pressable
                  key={channel.kind}
                  accessibilityRole="button"
                  accessibilityLabel={`Contact via ${channel.label}`}
                  onPress={() => openChannel(channel.kind, channel.value!)}
                  style={[styles.channel, { borderColor: theme.border }]}
                >
                  <Ionicons
                    name={channel.icon}
                    size={24}
                    color={theme.primary}
                  />
                  <View style={styles.listedByCopy}>
                    <ThemedText style={styles.listedByName}>
                      {channel.label}
                      {detail.contact?.preferredMethod?.toLowerCase() ===
                      channel.kind
                        ? " · Preferred"
                        : ""}
                    </ThemedText>
                    <ThemedText style={styles.hint}>{channel.value}</ThemedText>
                  </View>
                  <Ionicons
                    name="open-outline"
                    size={18}
                    color={theme.textSecondary}
                  />
                </Pressable>
              ))
            : null}
          {actionError ? (
            <ThemedText style={styles.error} accessibilityRole="alert">
              {actionError}
            </ThemedText>
          ) : null}
        </Sheet>
        <PhotoViewerModal
          visible={viewerIndex !== null}
          mediaIds={media.map((item) => item.id)}
          resolve={resolveMedia}
          refresh={resolveMedia}
          initialIndex={viewerIndex ?? 0}
          onClose={() => setViewerIndex(null)}
        />
      </SafeAreaView>
    </ThemedView>
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
        { backgroundColor: theme.background, borderColor: theme.border },
      ]}
    >
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {children}
    </View>
  );
}

function InfoRow({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={theme.textSecondary} />
      <ThemedText style={styles.infoText}>{text}</ThemedText>
    </View>
  );
}

function featureIcon(
  key: string,
): React.ComponentProps<typeof Ionicons>["name"] {
  const icons: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
    AIR_CONDITIONING: "snow-outline",
    NAVIGATION: "navigate-outline",
    SAT_NAV: "navigate-outline",
    BLUETOOTH: "bluetooth-outline",
    PARKING_SENSORS: "radio-outline",
    CRUISE_CONTROL: "speedometer-outline",
    ALLOY_WHEELS: "aperture-outline",
    HEATED_SEATS: "flame-outline",
    REVERSE_CAMERA: "videocam-outline",
    REVERSING_CAMERA: "videocam-outline",
  };
  return icons[key] ?? "checkmark-circle-outline";
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  summaryMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  galleryCounter: {
    position: "absolute",
    right: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: BrandColors.black,
    opacity: 0.8,
  },
  counterText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    color: BrandColors.white,
  },
  dots: {
    position: "absolute",
    bottom: 18,
    alignSelf: "center",
    flexDirection: "row",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BrandColors.white,
  },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: "800" },
  readMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
  },
  readMoreText: { fontSize: 14, fontWeight: "700", color: BrandColors.primary },
  advertiser: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  contactBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  barPrice: { flex: 1, minWidth: 90 },
  barPriceText: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  barButton: {
    flex: 1,
    minWidth: 100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 8,
  },
  barButtonText: { fontSize: 13, fontWeight: "700" },
  channel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 21 },
  headerActions: { flexDirection: "row", gap: Spacing.three },
  hero: { height: 260 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  content: { padding: Spacing.four, gap: Spacing.three },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  titleBlock: { flex: 1 },
  title: { fontSize: 26, lineHeight: 32 },
  price: {
    fontSize: 32,
    lineHeight: 40,
    color: BrandColors.primary,
    fontWeight: "800",
    marginTop: 2,
  },
  status: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusText: { fontSize: 11, fontWeight: "700" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20 },
  section: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: BrandColors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  description: { fontSize: 15, lineHeight: 23 },
  specRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
  },
  specLabel: { flex: 1, fontSize: 13 },
  specValue: { flex: 1, fontSize: 13, fontWeight: "600", textAlign: "right" },
  features: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  feature: {
    width: "30%",
    flexGrow: 1,
    borderRadius: 12,
    padding: 10,
    minHeight: 84,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  featureText: { fontSize: 11, lineHeight: 16, textAlign: "center" },
  actions: { gap: Spacing.three, paddingBottom: Spacing.five },
  error: { color: BrandColors.error, textAlign: "center" },
  listedByCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    backgroundColor: BrandColors.primarySurface,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    marginTop: Spacing.two,
  },
  listedByCopy: { flex: 1 },
  listedByMeta: {
    fontSize: 10,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  listedByNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  listedByName: { fontSize: 14, fontWeight: "700" },
  hint: { fontSize: 12, lineHeight: 18 },
  contactRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  contactChip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 11,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  contactText: { fontSize: 13, fontWeight: "600" },
});
