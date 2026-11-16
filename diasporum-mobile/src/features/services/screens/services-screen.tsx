import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import type { ServiceCategory } from "../types/service-marketplace-types";
import { categoryVisual, type ServiceIcon } from "../utils/category-visuals";
import {
  isLeafCategory,
  leafDescendants,
  rootCategory,
} from "../utils/category-tree";
import { ServicesMenuDrawer } from "../components/service-drawer";

/** Dark slate brand banner — neutral, works in both schemes. */
const HERO_BG = "#0F172A";
/** Muted copy that sits on the brand banner — readable in both schemes. */
const ON_BRAND_MUTED = "rgba(255,255,255,0.75)";
/** Glass tint behind the menu button on the brand banner. */
const ON_BRAND_GLASS = "rgba(255,255,255,0.14)";

interface CategorySection {
  parent: ServiceCategory;
  services: ServiceCategory[];
}

export function buildCategorySections(
  categories: ServiceCategory[],
  query = "",
): CategorySection[] {
  const normalized = query.trim().toLocaleLowerCase();
  const roots = categories.filter((category) => category.parentId == null);
  return roots
    .map((parent) => {
      const services = leafDescendants(parent, categories);
      const parentMatches =
        !normalized ||
        `${parent.displayName} ${parent.categoryKey}`
          .toLocaleLowerCase()
          .includes(normalized);
      return {
        parent,
        services: parentMatches
          ? services
          : services.filter((service) =>
              `${service.displayName} ${service.categoryKey}`
                .toLocaleLowerCase()
                .includes(normalized),
            ),
      };
    })
    .filter((section) => section.services.length > 0);
}

export default function ServicesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(
    () => createServiceMarketplaceApi(apiClient),
    [apiClient],
  );
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [path, setPath] = useState<ServiceCategory[]>([]);
  const [pickerLevel, setPickerLevel] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setCategories(await api.categories());
      setError(null);
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not load service categories.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const sections = useMemo(
    () => buildCategorySections(categories),
    [categories],
  );

  const childrenMap = useMemo(() => {
    const map = new Map<string, ServiceCategory[]>();
    for (const category of categories) {
      const key = category.parentId ?? "";
      const list = map.get(key) ?? [];
      list.push(category);
      map.set(key, list);
    }
    map.forEach((list) =>
      list.sort((a, b) => a.sortOrder - b.sortOrder),
    );
    return map;
  }, [categories]);

  const lastSelected = path[path.length - 1];
  const leafService =
    lastSelected && !(childrenMap.get(lastSelected.id)?.length ?? 0)
      ? lastSelected
      : null;
  // One dropdown per confirmed selection plus one for the next level.
  const dropdownCount = leafService ? path.length : path.length + 1;

  function optionsForLevel(level: number): ServiceCategory[] {
    const key = level === 0 ? "" : (path[level - 1]?.id ?? "");
    return childrenMap.get(key) ?? [];
  }

  function selectCategory(level: number, category: ServiceCategory) {
    setPath([...path.slice(0, level), category]);
    setPickerLevel(null);
  }

  function requestService(parentId?: string, serviceId?: string) {
    const params: string[] = [];
    if (parentId) params.push(`categoryId=${encodeURIComponent(parentId)}`);
    if (serviceId) params.push(`serviceId=${encodeURIComponent(serviceId)}`);
    const suffix = params.length ? `?${params.join("&")}` : "";
    router.push(`/(app)/services/requests/create${suffix}` as never);
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.hero, { backgroundColor: HERO_BG }]}>
          <View style={styles.headerRow}>
            <View style={styles.brandRow}>
              <View
                style={[
                  styles.brandMark,
                  { borderColor: BrandColors.white },
                ]}
              >
                <View
                  style={[
                    styles.brandMarkInner,
                    { backgroundColor: BrandColors.white },
                  ]}
                />
              </View>
              <ThemedText
                style={[styles.brand, { color: BrandColors.white }]}
              >
                DIASPORUM
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Services menu"
              onPress={() => setMenuOpen(true)}
              hitSlop={8}
              style={[
                styles.menuButton,
                { backgroundColor: ON_BRAND_GLASS },
              ]}
            >
              <Ionicons name="menu" size={24} color={BrandColors.white} />
            </Pressable>
          </View>
          <ThemedText style={[styles.tagline, { color: ON_BRAND_MUTED }]}>
            Find trusted local professionals
          </ThemedText>
          <View
            style={[
              styles.searchCard,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
              },
            ]}
          >
            {Array.from({ length: dropdownCount }, (_, level) => {
              const selected = path[level];
              const placeholder =
                level === 0 ? "Select a category" : "Select a service";
              return (
                <React.Fragment key={level}>
                  {level > 0 ? (
                    <View
                      style={[
                        styles.searchDivider,
                        { backgroundColor: theme.border },
                      ]}
                    />
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      selected ? selected.displayName : placeholder
                    }
                    onPress={() => setPickerLevel(level)}
                    style={styles.searchRow}
                  >
                    <Ionicons
                      name={level === 0 ? "grid" : "construct"}
                      size={23}
                      color={theme.textMuted}
                    />
                    <ThemedText
                      style={[
                        styles.dropdownText,
                        {
                          color: selected
                            ? theme.text
                            : theme.textMuted,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {selected ? selected.displayName : placeholder}
                    </ThemedText>
                    <Ionicons
                      name="chevron-down"
                      size={19}
                      color={theme.primary}
                    />
                  </Pressable>
                </React.Fragment>
              );
            })}
            {leafService ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Get free quotes"
                onPress={() =>
                  requestService(
                    rootCategory(leafService, categories).id,
                    leafService.id,
                  )
                }
                style={({ pressed }) => [
                  styles.goButton,
                  pressed && styles.goButtonPressed,
                ]}
              >
                <ThemedText style={styles.goButtonText}>
                  Get free quotes
                </ThemedText>
                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color={BrandColors.white}
                />
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          style={styles.catalogue}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
        >
          <View
            style={[
              styles.howCard,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <HowStep
              icon="create-outline"
              title="Tell us what you need"
              detail="Answer a few quick questions"
            />
            <View
              style={[
                styles.howDivider,
                { backgroundColor: theme.border },
              ]}
            />
            <HowStep
              icon="chatbubbles-outline"
              title="Get free responses"
              detail="Pros reply with interest and quotes"
            />
            <View
              style={[
                styles.howDivider,
                { backgroundColor: theme.border },
              ]}
            />
            <HowStep
              icon="checkmark-circle-outline"
              title="Choose your pro"
              detail="Compare profiles and reviews"
            />
          </View>

          {loading ? (
            <ActivityIndicator
              accessibilityLabel="Loading services"
              color={theme.primary}
              style={styles.loading}
            />
          ) : null}
          {error ? (
            <ErrorState
              message={error}
              onRetry={() => {
                setLoading(true);
                void load();
              }}
            />
          ) : null}
          {!loading && !error && !sections.length ? (
            <View style={styles.empty}>
              <ThemedText type="subtitle">No services available yet</ThemedText>
              <ThemedText themeColor="textSecondary">
                Check back later.
              </ThemedText>
            </View>
          ) : null}

          {sections.map((section) => (
            <View key={section.parent.id} style={styles.section}>
              <ThemedText
                style={[styles.sectionTitle, { color: theme.text }]}
              >
                Popular in {section.parent.displayName}
              </ThemedText>
              <View style={styles.grid}>
                {section.services.map((service) => (
                  <CategoryTile
                    key={service.id}
                    service={service}
                    categories={categories}
                    onPress={() =>
                      requestService(
                        rootCategory(service, categories).id,
                        service.id,
                      )
                    }
                  />
                ))}
              </View>
            </View>
          ))}

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(app)/services/providers" as never)}
            style={styles.browseProviders}
          >
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              Browse approved service providers
            </ThemedText>
            <Ionicons
              name="arrow-forward"
              size={18}
              color={theme.primary}
            />
          </Pressable>
        </ScrollView>
        {menuOpen ? (
          <ServicesMenuDrawer onClose={() => setMenuOpen(false)} />
        ) : null}
        {pickerLevel !== null ? (
          <CategoryPicker
            title={
              pickerLevel === 0 ? "Select a category" : "Select a service"
            }
            options={optionsForLevel(pickerLevel)}
            categories={categories}
            selectedId={path[pickerLevel]?.id}
            onPick={(item) => selectCategory(pickerLevel, item)}
            onClose={() => setPickerLevel(null)}
          />
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

function CategoryPicker({
  title,
  options,
  categories,
  selectedId,
  onPick,
  onClose,
}: {
  title: string;
  options: ServiceCategory[];
  categories: ServiceCategory[];
  selectedId?: string;
  onPick: (category: ServiceCategory) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.pickerBackdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.pickerSheet,
            {
              backgroundColor: theme.background,
              paddingBottom: insets.bottom + 12,
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <ThemedText
            style={[styles.pickerTitle, { color: theme.text }]}
          >
            {title}
          </ThemedText>
          <FlatList
            data={options}
            keyExtractor={(item) => item.id}
            style={styles.pickerList}
            showsVerticalScrollIndicator
            renderItem={({ item }) => {
              const nested = !isLeafCategory(item, categories);
              const selected = item.id === selectedId;
              const visual = categoryVisual(item, categories);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.displayName}
                  onPress={() => onPick(item)}
                  style={({ pressed }) => [
                    styles.pickerRow,
                    pressed && { backgroundColor: theme.backgroundElement },
                  ]}
                >
                  <Ionicons
                    name={visual.icon}
                    size={20}
                    color={selected ? theme.primary : theme.textMuted}
                  />
                  <ThemedText
                    style={[
                      styles.pickerRowText,
                      { color: selected ? theme.primary : theme.text },
                      selected && styles.pickerRowSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {item.displayName}
                  </ThemedText>
                  {nested ? (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={theme.textMuted}
                    />
                  ) : null}
                  {selected ? (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color={theme.primary}
                    />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HowStep({
  icon,
  title,
  detail,
}: {
  icon: ServiceIcon;
  title: string;
  detail: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.howStep}>
      <View
        style={[styles.howIcon, { backgroundColor: theme.background }]}
      >
        <Ionicons name={icon} size={18} color={theme.primary} />
      </View>
      <View style={styles.howCopy}>
        <ThemedText
          type="smallBold"
          style={[styles.howTitle, { color: theme.text }]}
        >
          {title}
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.howDetail, { color: theme.textSecondary }]}
        >
          {detail}
        </ThemedText>
      </View>
    </View>
  );
}

function CategoryTile({
  service,
  categories,
  onPress,
}: {
  service: ServiceCategory;
  categories: ServiceCategory[];
  onPress: () => void;
}) {
  const theme = useTheme();
  const visual = categoryVisual(service, categories);
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(visual.image) && !failed;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Request ${service.displayName}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.categoryItem,
        pressed && styles.categoryPressed,
      ]}
    >
      <View style={[styles.categoryArt, { backgroundColor: visual.tint }]}>
        {showImage ? (
          <Image
            source={{ uri: visual.image }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Ionicons
            name={visual.icon}
            size={52}
            color={BrandColors.primaryDark}
          />
        )}
      </View>
      <ThemedText
        style={[styles.categoryLabel, { color: theme.textSecondary }]}
        numberOfLines={2}
      >
        {service.displayName}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    paddingHorizontal: 5,
    paddingTop: 12,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brand: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  brandMark: {
    width: 26,
    height: 26,
    borderWidth: 3,
    transform: [{ rotate: "45deg" }],
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkInner: { width: 9, height: 9 },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  tagline: {
    fontSize: 14,
    marginTop: 8,
    marginBottom: 16,
    marginLeft: 2,
  },
  searchCard: {
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 1,
  },
  searchRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dropdownText: { flex: 1, fontSize: 17 },
  searchDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 35,
  },
  goButton: {
    marginVertical: 10,
    backgroundColor: BrandColors.primary,
    borderRadius: 22,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  goButtonPressed: { opacity: 0.85 },
  goButtonText: {
    color: BrandColors.white,
    fontSize: 16,
    fontWeight: "700",
  },
  catalogue: { flex: 1 },
  content: {
    paddingVertical: 20,
    paddingHorizontal: 5,
    paddingBottom: 40,
    gap: 26,
  },
  howCard: {
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  howStep: { flexDirection: "row", alignItems: "center", gap: 12 },
  howIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  howCopy: { flex: 1, gap: 1 },
  howTitle: { fontSize: 13 },
  howDetail: { fontSize: 12 },
  howDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 50,
  },
  section: { gap: 14 },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 22 },
  categoryItem: { width: "47.5%", gap: 10 },
  categoryPressed: { opacity: 0.8 },
  categoryArt: {
    width: "100%",
    aspectRatio: 1.1,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  categoryLabel: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "500",
  },
  browseProviders: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
  },
  loading: { marginVertical: 40 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 40 },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 18,
    maxHeight: "70%",
  },
  pickerList: { flexGrow: 0 },
  pickerTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 10,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  pickerRowText: { flex: 1, fontSize: 16 },
  pickerRowSelected: { fontWeight: "700" },
});
