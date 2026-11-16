import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { ApiClient } from "@/core/api/api-client";
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import type {
  ServiceProvider,
  ServiceRequest,
} from "../types/service-marketplace-types";
import { ServicesMenuDrawer } from "./service-drawer";

export function statusTone(status: string): string {
  switch (status) {
    case "ACTIVE":
    case "OPEN":
    case "SENT":
    case "APPROVED":
    case "VERIFIED":
    case "COMPLETED":
    case "ACCEPTED":
    case "IN_PROGRESS":
      return BrandColors.success;
    case "DRAFT":
    case "UNVERIFIED":
    case "PENDING":
    case "SUBMITTED":
    case "PAUSED":
    case "COMPLETION_SUBMITTED":
    case "ISSUE_RAISED":
      return BrandColors.warning;
    case "REMOVED":
    case "REJECTED":
    case "REVOKED":
      return BrandColors.error;
    default:
      return BrandColors.primary;
  }
}

export function formatDistance(meters: number | null): string | null {
  if (meters == null) return null;
  if (meters < 1000) return `${Math.round(meters)} m away`;
  return `${(meters / 1000).toFixed(1)} km away`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ScreenHeader({
  title,
  back = false,
  menu = false,
}: {
  title: string;
  back?: boolean;
  menu?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(app)/services" as never)
          }
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </Pressable>
      ) : null}
      <ThemedText style={styles.headerTitle}>{title}</ThemedText>
      {menu ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open services menu"
          onPress={() => setMenuOpen(true)}
          style={[styles.menuButton, { borderColor: theme.border }]}
        >
          <Ionicons name="menu-outline" size={22} color={theme.text} />
        </Pressable>
      ) : null}
      {menu && menuOpen ? (
        <ServicesMenuDrawer onClose={() => setMenuOpen(false)} />
      ) : null}
    </View>
  );
}

export function SectionLabel({ label }: { label: string }) {
  return (
    <ThemedText type="smallBold" style={styles.sectionLabel}>
      {label}
    </ThemedText>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.sectionCard,
        { backgroundColor: theme.backgroundElement },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function StatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const color = statusTone(status);
  return (
    <View
      style={[styles.badge, { backgroundColor: `${color}22` }]}
      accessibilityLabel={`Status ${label ?? status}`}
    >
      <ThemedText
        type="small"
        style={[styles.badgeText, { color }]}
        numberOfLines={1}
      >
        {label ?? status.replace(/_/g, " ")}
      </ThemedText>
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected
            ? BrandColors.primary
            : theme.backgroundElement,
          borderColor: selected ? BrandColors.primary : theme.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <ThemedText
        type="small"
        style={
          selected ? { color: BrandColors.white, fontWeight: "600" } : null
        }
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function Avatar({
  name,
  business,
  size = 44,
}: {
  name: string;
  business?: boolean;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: BrandColors.primary + "22",
        },
      ]}
    >
      {business ? (
        <Ionicons
          name="briefcase-outline"
          size={size * 0.45}
          color={BrandColors.primary}
        />
      ) : (
        <ThemedText
          type="smallBold"
          style={{ color: BrandColors.primary, fontSize: size * 0.36 }}
        >
          {initials(name) || "?"}
        </ThemedText>
      )}
    </View>
  );
}

export interface SelectOption {
  id: string;
  label: string;
  description?: string | null;
}

export function SelectField({
  label,
  placeholder = "Select…",
  value,
  options,
  onSelect,
  disabled,
  required,
  emptyText = "No options available",
}: {
  label: string;
  placeholder?: string;
  value: SelectOption | null;
  options: SelectOption[];
  onSelect: (option: SelectOption) => void;
  disabled?: boolean;
  required?: boolean;
  emptyText?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.selectWrap}>
      <View style={styles.selectLabelRow}>
        <ThemedText style={styles.selectLabel}>
          {label}
          {required ? (
            <ThemedText style={{ color: BrandColors.error }}> *</ThemedText>
          ) : null}
        </ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[
          styles.selectField,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            opacity: disabled ? 0.55 : 1,
          },
        ]}
      >
        <ThemedText
          style={value ? null : { color: theme.textSecondary }}
          numberOfLines={1}
        >
          {value ? value.label : placeholder}
        </ThemedText>
        <Ionicons
          name="chevron-down"
          size={18}
          color={theme.textSecondary}
        />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          accessibilityLabel={`Close ${label}`}
          style={styles.modalBackdrop}
          onPress={() => setOpen(false)}
        >
          <Pressable
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
              },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <ThemedText type="smallBold" style={styles.modalTitle}>
              {label}
            </ThemedText>
            <ScrollView style={styles.modalList} bounces={false}>
              {options.length === 0 ? (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.modalEmpty}
                >
                  {emptyText}
                </ThemedText>
              ) : (
                options.map((option) => {
                  const selected = option.id === value?.id;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        onSelect(option);
                        setOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.modalOption,
                        {
                          backgroundColor: selected
                            ? BrandColors.primary + "18"
                            : pressed
                              ? theme.backgroundElement
                              : "transparent",
                        },
                      ]}
                    >
                      <View style={styles.modalOptionText}>
                        <ThemedText
                          type="smallBold"
                          style={
                            selected ? { color: BrandColors.primary } : null
                          }
                        >
                          {option.label}
                        </ThemedText>
                        {option.description ? (
                          <ThemedText type="small" themeColor="textSecondary">
                            {option.description}
                          </ThemedText>
                        ) : null}
                      </View>
                      {selected ? (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={BrandColors.primary}
                        />
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.searchBar,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <Ionicons name="search" size={18} color={theme.textSecondary} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        style={[styles.searchInput, { color: theme.text }]}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChange("")}
        >
          <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={BrandColors.primary} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.infoLabel}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={styles.infoValue} numberOfLines={2}>
        {value}
      </ThemedText>
    </View>
  );
}

export function ActionRow({
  icon,
  label,
  detail,
  danger,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = danger ? BrandColors.error : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionRow,
        pressed ? { backgroundColor: theme.backgroundElement } : null,
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={danger ? BrandColors.error : BrandColors.primary}
      />
      <View style={styles.actionBody}>
        <ThemedText type="smallBold" style={{ color }}>
          {label}
        </ThemedText>
        {detail ? (
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

export function RatingStars({
  rating,
  size = 14,
}: {
  rating: number;
  size?: number;
}) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={star <= Math.round(rating) ? "star" : "star-outline"}
          size={size}
          color={BrandColors.warning}
        />
      ))}
    </View>
  );
}

export function LeadMarketplaceNotice() {
  const theme = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.noticeRow}>
        <Ionicons
          name="information-circle-outline"
          size={18}
          color={BrandColors.primary}
        />
        <ThemedText type="smallBold">Discovery and contact only</ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        DIASPORUM does not book work, hold payments, or guarantee providers.
        Agree on scope, price, safety, and payment directly. Lead access charges
        unlock contact capabilities, not completed work.
      </ThemedText>
    </View>
  );
}

export function ProviderCard({ provider }: { provider: ServiceProvider }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${provider.displayName}`}
      onPress={() =>
        router.push(`/(app)/services/providers/${provider.id}` as never)
      }
      style={[
        styles.card,
        {
          borderColor: theme.border,
          backgroundColor: theme.backgroundElement,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <Avatar
          name={provider.displayName}
          business={provider.businessAccountId != null}
        />
        <View style={styles.cardHeaderText}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {provider.displayName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {provider.businessAccountId
              ? "Business provider"
              : "Independent provider"}
          </ThemedText>
        </View>
        <StatusBadge
          status={provider.status}
          label={
            provider.canManage
              ? `${provider.status} · ${provider.onboardingStatus}`
              : provider.status
          }
        />
      </View>
      <ThemedText numberOfLines={2} type="small">
        {provider.description ?? "Service provider"}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {provider.categories.map((item) => item.displayName).join(" · ")}
      </ThemedText>
      {formatDistance(provider.distanceMeters) ? (
        <ThemedText
          type="smallBold"
          style={{ color: BrandColors.primary }}
        >
          {formatDistance(provider.distanceMeters)}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

export function RequestCard({
  request,
  providerId,
}: {
  request: ServiceRequest;
  providerId?: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const budget =
    request.budgetMin != null || request.budgetMax != null
      ? `${request.budgetMin ?? "—"}–${request.budgetMax ?? "—"} ${request.currencyCode}`
      : "Budget not specified";
  const distance = formatDistance(request.distanceMeters);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${request.title}`}
      onPress={() =>
        router.push(
          `/(app)/services/requests/${request.id}${providerId ? `?providerId=${providerId}` : ""}` as never,
        )
      }
      style={[
        styles.card,
        {
          borderColor: theme.border,
          backgroundColor: theme.backgroundElement,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <ThemedText
          type="smallBold"
          style={{ color: BrandColors.primary }}
          numberOfLines={1}
        >
          {request.categoryDisplayName}
        </ThemedText>
        <StatusBadge status={request.status} />
      </View>
      <ThemedText type="subtitle">{request.title}</ThemedText>
      <ThemedText numberOfLines={2} type="small">
        {request.description}
      </ThemedText>
      <View style={styles.cardTop}>
        <ThemedText type="smallBold">{budget}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {request.preferredDate ? `Preferred ${request.preferredDate}` : "Flexible date"}
          {distance ? ` · ${distance}` : ""}
        </ThemedText>
      </View>
    </Pressable>
  );
}

export function CollectionState({
  loading,
  error,
  empty,
  onRetry,
  emptyText = "Nothing here yet",
  emptyIcon = "albums-outline",
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => void;
  emptyText?: string;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  if (loading)
    return (
      <ActivityIndicator
        accessibilityLabel="Loading services"
        style={styles.loading}
      />
    );
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (empty) {
    return (
      <View style={styles.empty}>
        <View
          style={[
            styles.emptyIcon,
            { backgroundColor: theme.backgroundElement },
          ]}
        >
          <Ionicons
            name={emptyIcon}
            size={28}
            color={theme.textSecondary}
          />
        </View>
        <ThemedText type="subtitle">{emptyText}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.emptyHint}>
          Try another filter or check back later.
        </ThemedText>
      </View>
    );
  }
  return null;
}

export function ServiceRequestImage({
  client,
  requestId,
  mediaId,
}: {
  client: ApiClient;
  requestId: string;
  mediaId: string;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    createServiceMarketplaceApi(client)
      .mediaDownloadUrl(requestId, mediaId)
      .then((result) => {
        if (active) setUri(result.downloadUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [client, mediaId, requestId]);
  if (failed) return null;
  if (!uri)
    return <ActivityIndicator accessibilityLabel="Loading request image" />;
  return (
    <Image
      source={{ uri }}
      style={styles.image}
      accessibilityLabel="Service request image"
    />
  );
}

export const serviceStyles = StyleSheet.create({
  root: { flex: 1 },
  keyboard: { flex: 1 },
  content: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.one,
    gap: Spacing.three,
    flexGrow: 1,
    paddingBottom: Spacing.six,
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
    minHeight: 48,
  },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  actions: { gap: Spacing.three },
});

const styles = StyleSheet.create({
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { marginRight: Spacing.two, padding: Spacing.one },
  headerTitle: { fontSize: 22, fontWeight: "700", flex: 1 },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: {
    padding: Spacing.three,
    gap: Spacing.one,
    borderRadius: BorderRadius.md,
  },
  noticeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  cardHeaderText: { flex: 1, gap: 2 },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.two,
  },
  sectionCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  sectionLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    opacity: 0.65,
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: BorderRadius.xl,
  },
  badgeText: { fontSize: 11, fontWeight: "700" },
  chip: {
    borderWidth: 1,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginRight: Spacing.two,
    marginBottom: Spacing.two,
  },
  avatar: { alignItems: "center", justifyContent: "center" },
  selectWrap: { gap: Spacing.one },
  selectLabelRow: { flexDirection: "row", alignItems: "center" },
  selectLabel: { fontSize: 14, fontWeight: "600" },
  selectField: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: Spacing.four,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    maxHeight: "70%",
    gap: Spacing.two,
  },
  modalTitle: { paddingBottom: Spacing.one },
  modalList: { flexGrow: 0 },
  modalEmpty: { padding: Spacing.three },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two + 2,
    borderRadius: BorderRadius.md,
  },
  modalOptionText: { flex: 1, gap: 2 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: Spacing.two },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  infoLabel: { width: 96 },
  infoValue: { flex: 1 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: BorderRadius.md,
  },
  actionBody: { flex: 1, gap: 1 },
  stars: { flexDirection: "row", gap: 2 },
  loading: { margin: Spacing.five },
  empty: { alignItems: "center", padding: Spacing.five, gap: Spacing.two },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.one,
  },
  emptyHint: { textAlign: "center" },
  image: { width: "100%", height: 220, borderRadius: BorderRadius.md },
});
