import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { usePropertyPage } from "../hooks/use-property-page";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import { createPropertyApi } from "../services/property-api";
import type { PropertyStatus } from "../types/property-types";
import { statusLabel } from "../utils/property-format";
import { PropertyCard } from "../components/property-card";
import {
  PropertiesEmpty,
  PropertiesSkeleton,
  PropertyListError,
} from "../components/property-states";
import { Chip, PropertyScreen } from "../components/property-controls";

const PAGE_SIZE = 20;
const STATUSES: (PropertyStatus | "ALL")[] = [
  "ALL",
  "DRAFT",
  "PENDING_REVIEW",
  "PUBLISHED",
  "PAUSED",
  "SOLD",
  "RENTED",
  "EXPIRED",
  "REJECTED",
  "CLOSED",
];

export default function PropertyCollectionScreen({
  mode,
}: {
  mode: "mine" | "saved";
}) {
  const theme = useTheme();
  const accent = theme.info;
  const router = useRouter();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const [status, setStatus] = useState<PropertyStatus | "ALL">("ALL");
  const fetchPage = useCallback(
    (cursor?: string) =>
      mode === "mine"
        ? api.mine(
            status === "ALL" ? undefined : status,
            undefined,
            cursor,
            PAGE_SIZE,
          )
        : api.saved(cursor, PAGE_SIZE),
    [api, mode, status],
  );
  const results = usePropertyPage(fetchPage);
  const { loading, refreshing, loadingMore, error } = results;
  const items = loading && !refreshing ? [] : results.page.items;

  const openDetail = useCallback(
    (id: string) => router.push(`/(app)/properties/${id}` as never),
    [router],
  );
  const total = results.page.totalCount;
  const count =
    total == null
      ? `${items.length}${results.page.nextCursor ? "+" : ""} ${items.length === 1 && !results.page.nextCursor ? "property" : "properties"}`
      : `${total} ${total === 1 ? "property" : "properties"}`;
  const empty =
    mode === "mine"
      ? {
          title:
            status === "ALL"
              ? "No property listings yet"
              : `No ${statusLabel(status).toLowerCase()} properties`,
          message: "Personal and business properties you manage appear here.",
          actionLabel: "Create property",
          onAction: () => router.push("/(app)/properties/create" as never),
        }
      : {
          title: "No saved properties yet",
          message: "Bookmark properties you want to revisit.",
          actionLabel: "Browse properties",
          onAction: () => router.push("/(app)/properties" as never),
        };

  return (
    <PropertyScreen
      title={mode === "mine" ? "My properties" : "Saved properties"}
      actions={
        mode === "mine" ? (
          <Pressable
            onPress={() => router.push("/(app)/properties/create" as never)}
            accessibilityRole="button"
            accessibilityLabel="Create property"
            hitSlop={8}
            style={({ pressed }) => pressed && { opacity: 0.7 }}
          >
            <Ionicons name="add" size={26} color={accent} />
          </Pressable>
        ) : undefined
      }
    >
      {mode === "mine" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {STATUSES.map((value) => (
            <Chip
              key={value}
              label={value === "ALL" ? "All" : statusLabel(value)}
              active={status === value}
              onPress={() => setStatus(value)}
              accessibilityLabel={
                value === "ALL"
                  ? "All my properties"
                  : `${statusLabel(value)} properties`
              }
            />
          ))}
        </ScrollView>
      ) : null}
      {!loading && !error && items.length > 0 ? (
        <ThemedText themeColor="textSecondary" style={styles.count}>
          {count}
        </ThemedText>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.property.id}
        renderItem={({ item }) => (
          <PropertyCard
            item={item}
            onPress={openDetail}
            onUnsave={mode === "saved" ? results.refresh : undefined}
            managed={mode === "mine"}
          />
        )}
        onEndReached={results.more}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={results.refresh}
            tintColor={accent}
          />
        }
        ListHeaderComponent={
          loading && !refreshing ? (
            <PropertiesSkeleton />
          ) : error ? (
            <PropertyListError message={error} onRetry={results.retry} />
          ) : undefined
        }
        ListEmptyComponent={
          !loading && !error ? <PropertiesEmpty {...empty} /> : undefined
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator
              style={styles.footer}
              color={accent}
              accessibilityLabel="Loading more properties"
            />
          ) : undefined
        }
        contentContainerStyle={
          items.length === 0 ? styles.emptyContent : styles.listContent
        }
        showsVerticalScrollIndicator={false}
      />
    </PropertyScreen>
  );
}

const styles = StyleSheet.create({
  tabs: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  count: {
    fontSize: 12,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.half,
    paddingBottom: Spacing.half,
  },
  footer: { padding: Spacing.three },
  listContent: { paddingBottom: Spacing.four },
  emptyContent: { flexGrow: 1 },
});
