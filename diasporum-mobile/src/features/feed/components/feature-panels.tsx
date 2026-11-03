/**
 * Feature panels — inline content panels rendered on the home screen when the
 * user selects a feature from FeatureNav. Each panel manages its own data
 * fetching and renders a FlatList without SafeAreaView (the home screen
 * provides the outer chrome).
 *
 * Implemented panels:
 *   dating     → Matchmaking 2-column profile grid
 *   property   → Property listings
 *   vehicle    → Vehicle listings
 *   event      → Event listings
 *   jobs       → Job listings
 *   spare-bag  → Spare-bag listings
 *   business   → Business directory
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

// Feature-specific imports
import { useMatchmakingApi } from "@/features/matchmaking/hooks/use-matchmaking-api";
import { ProfilePhoto } from "@/features/matchmaking/components/matchmaking-ui";
import type { PublicMatchmakingProfile } from "@/features/matchmaking/types/matchmaking-types";

import { createPropertyApi } from "@/features/property/services/property-api";
import { PropertyCard } from "@/features/property/components/property-card";
import type { PropertyItem } from "@/features/property/types/property-types";

import { createVehicleApi } from "@/features/vehicles/services/vehicle-api";
import { VehicleCard } from "@/features/vehicles/components/vehicle-card";
import type { VehicleView } from "@/features/vehicles/types/vehicle-types";

import { createEventApi } from "@/features/events/services/event-api";
import { EventCard } from "@/features/events/components/event-card";
import type { EventItem } from "@/features/events/types/event-types";

import { createJobApi } from "@/features/jobs/services/job-api";
import { JobCard } from "@/features/jobs/components/job-card";
import type { JobItem } from "@/features/jobs/types/job-types";

import { createSpareBagApi } from "@/features/spare-bag/services/spare-bag-api";
import { ListingCard } from "@/features/spare-bag/components/spare-bag-ui";
import type { Listing as SpareBagListing } from "@/features/spare-bag/types/spare-bag-types";

import { createDirectoryApi } from "@/features/business-directory/services/directory-api";
import { BusinessCard } from "@/features/business-directory/components/business-card";
import type { Business } from "@/features/business-directory/types/directory-types";

// ─── shared helpers ───────────────────────────────────────────────────────────

const COLUMN_GAP = Spacing.two;
const SCREEN_WIDTH = Dimensions.get("window").width;
const PANEL_H_PAD = Spacing.three * 2;
const CARD_WIDTH = (SCREEN_WIDTH - PANEL_H_PAD - COLUMN_GAP) / 2;

function PanelHeader({
  title,
  icon,
  route,
  createRoute,
  createLabel = "Create",
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  route: string;
  createRoute?: string;
  createLabel?: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={[panelStyles.header, { borderBottomColor: theme.border }]}>
      <View style={panelStyles.headerLeft}>
        <Ionicons name={icon} size={20} color={theme.primary} />
        <ThemedText type="subtitle" style={panelStyles.headerTitle}>
          {title}
        </ThemedText>
      </View>
      <View style={panelStyles.headerActions}>
        {createRoute ? (
          <Pressable
            onPress={() => router.push(createRoute as never)}
            accessibilityRole="button"
            accessibilityLabel={createLabel}
            style={[panelStyles.actionBtn, { backgroundColor: theme.text }]}
          >
            <Ionicons name="add" size={18} color={theme.background} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.push(route as never)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${title}`}
          style={[panelStyles.actionBtn, { borderColor: theme.border }]}
        >
          <ThemedText style={panelStyles.viewAll}>View all</ThemedText>
          <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

function PanelEmpty({
  icon,
  message,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  message: string;
}) {
  const theme = useTheme();
  return (
    <View style={panelStyles.empty}>
      <Ionicons name={icon} size={40} color={theme.textSecondary} />
      <ThemedText themeColor="textSecondary" style={panelStyles.emptyText}>
        {message}
      </ThemedText>
    </View>
  );
}

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={panelStyles.empty}>
      <ThemedText themeColor="error" style={{ marginBottom: Spacing.two }}>
        {message}
      </ThemedText>
      <Pressable onPress={onRetry} accessibilityRole="button">
        <ThemedText style={{ color: theme.primary, fontWeight: "600" }}>
          Retry
        </ThemedText>
      </Pressable>
    </View>
  );
}

// ─── Matchmaking ─────────────────────────────────────────────────────────────

function MatchmakingGridCard({ profile }: { profile: PublicMatchmakingProfile }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() =>
        router.push(`/(app)/matchmaking/profile/${profile.userId}` as never)
      }
      accessibilityRole="button"
      accessibilityLabel={`View ${profile.displayName}'s profile`}
      style={({ pressed }) => [
        gridCardStyles.card,
        { backgroundColor: theme.backgroundElement, width: CARD_WIDTH },
        pressed && { opacity: 0.78 },
      ]}
    >
      <ProfilePhoto uri={profile.photoUrl} name={profile.displayName} size={80} />
      <ThemedText
        type="subtitle"
        numberOfLines={1}
        style={gridCardStyles.name}
      >
        {profile.displayName}
        {profile.age ? `, ${profile.age}` : ""}
      </ThemedText>
      {profile.verificationStatus === "VERIFIED" ? (
        <View style={gridCardStyles.verified}>
          <Ionicons name="checkmark-circle" size={13} color={theme.primary} />
          <ThemedText style={gridCardStyles.verifiedText}>Verified</ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Shown when the user has no dating profile yet (403 from discover). */
function MatchmakingNoProfile() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={noProfileStyles.wrap}>
      <View
        style={[
          noProfileStyles.iconCircle,
          { backgroundColor: theme.primarySurface },
        ]}
      >
        <Ionicons name="heart" size={40} color={theme.primary} />
      </View>
      <ThemedText type="subtitle" style={noProfileStyles.title}>
        Find your match
      </ThemedText>
      <ThemedText
        themeColor="textSecondary"
        style={noProfileStyles.body}
      >
        You don&apos;t have a dating profile yet. Create one to start
        discovering compatible people.
      </ThemedText>
      <Pressable
        onPress={() => router.push("/(app)/matchmaking/setup" as never)}
        accessibilityRole="button"
        accessibilityLabel="Create dating profile"
        style={({ pressed }) => [
          noProfileStyles.btn,
          { backgroundColor: theme.primary },
          pressed && { opacity: 0.82 },
        ]}
      >
        <Ionicons name="add-circle-outline" size={18} color={BrandColors.white} />
        <ThemedText style={noProfileStyles.btnText}>
          Create dating profile
        </ThemedText>
      </Pressable>
    </View>
  );
}

export function MatchmakingPanel() {
  const api = useMatchmakingApi();
  const router = useRouter();
  const [items, setItems] = useState<PublicMatchmakingProfile[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True when the 403 response indicates no dating profile exists yet. */
  const [noProfile, setNoProfile] = useState(false);
  const loadingRef = useRef(false);
  const theme = useTheme();

  const load = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      return api
        .discover(nextCursor)
        .then((page) => {
          setItems((prev) => {
            if (!nextCursor) return page.items;
            const ids = new Set(prev.map((p) => p.userId));
            return [...prev, ...page.items.filter((p) => !ids.has(p.userId))];
          });
          setCursor(page.nextCursor ?? null);
          setError(null);
          setNoProfile(false);
        })
        .catch((err: unknown) => {
          // 403 from /discover means the user has no active dating profile.
          // Show the create-profile prompt instead of a generic error.
          if (ApiError.isApiError(err) && err.isForbidden) {
            setNoProfile(true);
            setError(null);
          } else {
            setNoProfile(false);
            setError(
              ApiError.isApiError(err)
                ? err.userMessage
                : "Could not load profiles.",
            );
          }
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={panelStyles.root}>
      <PanelHeader
        title="Matchmaking"
        icon="heart-outline"
        route="/(app)/matchmaking"
        createRoute={noProfile ? undefined : "/(app)/matchmaking/setup"}
        createLabel="Set up profile"
      />
      {loading ? (
        <ActivityIndicator style={panelStyles.loader} color={theme.primary} />
      ) : noProfile ? (
        <MatchmakingNoProfile />
      ) : error && items.length === 0 ? (
        <PanelError message={error} onRetry={() => { setLoading(true); void load(); }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.userId}
          numColumns={2}
          columnWrapperStyle={panelStyles.row}
          contentContainerStyle={panelStyles.gridContent}
          renderItem={({ item }) => <MatchmakingGridCard profile={item} />}
          onEndReached={() => {
            if (cursor && !loadingRef.current) {
              setLoadingMore(true);
              void load(cursor);
            }
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={theme.primary}
            />
          }
          ListEmptyComponent={
            <PanelEmpty
              icon="heart-outline"
              message="No discoverable profiles right now. Check your preferences."
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                style={panelStyles.footer}
                color={theme.primary}
              />
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
        />
      )}
      <Pressable
        onPress={() => router.push("/(app)/matchmaking" as never)}
        accessibilityRole="button"
        style={[panelStyles.fullScreenBtn, { borderTopColor: theme.border }]}
      >
        <ThemedText style={[panelStyles.fullScreenText, { color: theme.primary }]}>
          Open Matchmaking hub
        </ThemedText>
        <Ionicons name="arrow-forward-circle-outline" size={18} color={theme.primary} />
      </Pressable>
    </ThemedView>
  );
}

// ─── Property ─────────────────────────────────────────────────────────────────

export function PropertyPanel() {
  const { apiClient, session } = useSession();
  const api = useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const router = useRouter();
  const [items, setItems] = useState<PropertyItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const countryId = session?.profile?.currentCountryId ?? undefined;

  const load = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      return api
        .discover({ countryId }, nextCursor, 10)
        .then((page) => {
          setItems((prev) => {
            if (!nextCursor) return page.items;
            const ids = new Set(prev.map((item) => item.property.id));
            return [
              ...prev,
              ...page.items.filter((item) => !ids.has(item.property.id)),
            ];
          });
          setCursor(page.nextCursor ?? null);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(
            ApiError.isApiError(err)
              ? err.userMessage
              : "Could not load properties.",
          );
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [api, countryId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={panelStyles.root}>
      <PanelHeader
        title="Property"
        icon="business-outline"
        route="/(app)/properties"
        createRoute="/(app)/properties/create"
      />
      {loading ? (
        <ActivityIndicator style={panelStyles.loader} color={BrandColors.primary} />
      ) : error && items.length === 0 ? (
        <PanelError message={error} onRetry={() => { setLoading(true); void load(); }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.property.id}
          contentContainerStyle={panelStyles.listContent}
          renderItem={({ item }) => (
            <PropertyCard
              item={item}
              onPress={(id) => router.push(`/(app)/properties/${id}` as never)}
            />
          )}
          onEndReached={() => {
            if (cursor && !loadingRef.current) {
              setLoadingMore(true);
              void load(cursor);
            }
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={BrandColors.primary}
            />
          }
          ListEmptyComponent={
            <PanelEmpty icon="business-outline" message="No property listings yet." />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={panelStyles.footer} color={BrandColors.primary} />
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </ThemedView>
  );
}

// ─── Vehicles ─────────────────────────────────────────────────────────────────

export function VehiclesPanel() {
  const { apiClient } = useSession();
  const api = useMemo(() => createVehicleApi(apiClient), [apiClient]);
  const router = useRouter();
  const [items, setItems] = useState<VehicleView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      return api
        .discover({ sort: "NEWEST" }, nextCursor)
        .then((page) => {
          setItems((prev) => {
            if (!nextCursor) return page.items;
            const ids = new Set(prev.map((item) => item.listing.id));
            return [
              ...prev,
              ...page.items.filter((item) => !ids.has(item.listing.id)),
            ];
          });
          setCursor(page.nextCursor ?? null);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(
            ApiError.isApiError(err)
              ? err.userMessage
              : "Could not load vehicles.",
          );
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={panelStyles.root}>
      <PanelHeader
        title="Vehicles"
        icon="car-outline"
        route="/(app)/vehicles"
        createRoute="/(app)/vehicles/create"
      />
      {loading ? (
        <ActivityIndicator style={panelStyles.loader} color={BrandColors.primary} />
      ) : error && items.length === 0 ? (
        <PanelError message={error} onRetry={() => { setLoading(true); void load(); }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.listing.id}
          contentContainerStyle={panelStyles.listContent}
          renderItem={({ item }) => (
            <VehicleCard
              item={item}
              onPress={(id) => router.push(`/(app)/vehicles/${id}` as never)}
            />
          )}
          onEndReached={() => {
            if (cursor && !loadingRef.current) {
              setLoadingMore(true);
              void load(cursor);
            }
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={BrandColors.primary}
            />
          }
          ListEmptyComponent={
            <PanelEmpty icon="car-outline" message="No vehicle listings yet." />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={panelStyles.footer} color={BrandColors.primary} />
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </ThemedView>
  );
}

// ─── Events ──────────────────────────────────────────────────────────────────

export function EventsPanel() {
  const { apiClient } = useSession();
  const api = useMemo(() => createEventApi(apiClient), [apiClient]);
  const router = useRouter();
  const [items, setItems] = useState<EventItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      return api
        .discover({}, nextCursor, 10)
        .then((page) => {
          setItems((prev) => {
            if (!nextCursor) return page.items;
            const ids = new Set(prev.map((item) => item.event.id));
            return [
              ...prev,
              ...page.items.filter((item) => !ids.has(item.event.id)),
            ];
          });
          setCursor(page.nextCursor ?? null);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(
            ApiError.isApiError(err)
              ? err.userMessage
              : "Could not load events.",
          );
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={panelStyles.root}>
      <PanelHeader
        title="Events"
        icon="calendar-outline"
        route="/(app)/events"
        createRoute="/(app)/events/create"
      />
      {loading ? (
        <ActivityIndicator style={panelStyles.loader} color={BrandColors.primary} />
      ) : error && items.length === 0 ? (
        <PanelError message={error} onRetry={() => { setLoading(true); void load(); }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.event.id}
          contentContainerStyle={panelStyles.listContent}
          renderItem={({ item }) => (
            <EventCard
              item={item}
              onPress={(id) => router.push(`/(app)/events/${id}` as never)}
            />
          )}
          onEndReached={() => {
            if (cursor && !loadingRef.current) {
              setLoadingMore(true);
              void load(cursor);
            }
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={BrandColors.primary}
            />
          }
          ListEmptyComponent={
            <PanelEmpty icon="calendar-outline" message="No upcoming events." />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={panelStyles.footer} color={BrandColors.primary} />
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </ThemedView>
  );
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export function JobsPanel() {
  const { apiClient } = useSession();
  const api = useMemo(() => createJobApi(apiClient), [apiClient]);
  const router = useRouter();
  const [items, setItems] = useState<JobItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      return api
        .discover({}, nextCursor, 10)
        .then((page) => {
          setItems((prev) => {
            if (!nextCursor) return page.items;
            const ids = new Set(prev.map((item) => item.job.id));
            return [
              ...prev,
              ...page.items.filter((item) => !ids.has(item.job.id)),
            ];
          });
          setCursor(page.nextCursor ?? null);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(
            ApiError.isApiError(err) ? err.userMessage : "Could not load jobs.",
          );
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={panelStyles.root}>
      <PanelHeader
        title="Jobs"
        icon="briefcase-outline"
        route="/(app)/jobs"
        createRoute="/(app)/jobs/create"
      />
      {loading ? (
        <ActivityIndicator style={panelStyles.loader} color={BrandColors.primary} />
      ) : error && items.length === 0 ? (
        <PanelError message={error} onRetry={() => { setLoading(true); void load(); }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.job.id}
          contentContainerStyle={panelStyles.listContent}
          renderItem={({ item }) => (
            <JobCard
              item={item}
              onPress={(id) => router.push(`/(app)/jobs/${id}` as never)}
            />
          )}
          onEndReached={() => {
            if (cursor && !loadingRef.current) {
              setLoadingMore(true);
              void load(cursor);
            }
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={BrandColors.primary}
            />
          }
          ListEmptyComponent={
            <PanelEmpty icon="briefcase-outline" message="No job listings yet." />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={panelStyles.footer} color={BrandColors.primary} />
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </ThemedView>
  );
}

// ─── Spare Bag ────────────────────────────────────────────────────────────────

export function SpareBagPanel() {
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const [items, setItems] = useState<SpareBagListing[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      return api
        .discover({}, nextCursor, 10)
        .then((page) => {
          setItems((prev) => {
            if (!nextCursor) return page.items;
            const ids = new Set(prev.map((item) => item.id));
            return [...prev, ...page.items.filter((item) => !ids.has(item.id))];
          });
          setCursor(page.nextCursor ?? null);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(
            ApiError.isApiError(err)
              ? err.userMessage
              : "Could not load spare bag listings.",
          );
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={panelStyles.root}>
      <PanelHeader
        title="Spare Bag"
        icon="bag-handle-outline"
        route="/(app)/spare-bag"
        createRoute="/(app)/spare-bag/create-sender"
        createLabel="Post listing"
      />
      {loading ? (
        <ActivityIndicator style={panelStyles.loader} color={BrandColors.primary} />
      ) : error && items.length === 0 ? (
        <PanelError message={error} onRetry={() => { setLoading(true); void load(); }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={panelStyles.listContent}
          renderItem={({ item }) => <ListingCard listing={item} />}
          onEndReached={() => {
            if (cursor && !loadingRef.current) {
              setLoadingMore(true);
              void load(cursor);
            }
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={BrandColors.primary}
            />
          }
          ListEmptyComponent={
            <PanelEmpty
              icon="bag-handle-outline"
              message="No spare bag listings yet."
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={panelStyles.footer} color={BrandColors.primary} />
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </ThemedView>
  );
}

// ─── Business Directory ────────────────────────────────────────────────────────

export function BusinessPanel() {
  const { apiClient } = useSession();
  const api = useMemo(() => createDirectoryApi(apiClient), [apiClient]);
  const router = useRouter();
  const [items, setItems] = useState<Business[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      return api
        .discover({}, nextCursor, 10)
        .then((page) => {
          setItems((prev) => {
            if (!nextCursor) return page.items;
            const ids = new Set(prev.map((item) => item.id));
            return [...prev, ...page.items.filter((item) => !ids.has(item.id))];
          });
          setCursor(page.nextCursor ?? null);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(
            ApiError.isApiError(err)
              ? err.userMessage
              : "Could not load businesses.",
          );
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={panelStyles.root}>
      <PanelHeader
        title="Business Directory"
        icon="storefront-outline"
        route="/(app)/businesses"
        createRoute="/(app)/businesses/create"
      />
      {loading ? (
        <ActivityIndicator style={panelStyles.loader} color={BrandColors.primary} />
      ) : error && items.length === 0 ? (
        <PanelError message={error} onRetry={() => { setLoading(true); void load(); }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={panelStyles.listContent}
          renderItem={({ item }) => (
            <BusinessCard
              business={item}
              onPress={() =>
                router.push(`/(app)/businesses/${item.id}` as never)
              }
            />
          )}
          onEndReached={() => {
            if (cursor && !loadingRef.current) {
              setLoadingMore(true);
              void load(cursor);
            }
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={BrandColors.primary}
            />
          }
          ListEmptyComponent={
            <PanelEmpty
              icon="storefront-outline"
              message="No businesses in the directory yet."
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={panelStyles.footer} color={BrandColors.primary} />
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </ThemedView>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const panelStyles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  headerTitle: { fontSize: 16 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: "transparent",
  },
  viewAll: { fontSize: 12, fontWeight: "600" },
  loader: { marginTop: Spacing.seven },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.seven,
    gap: Spacing.two,
  },
  emptyText: { fontSize: 14, textAlign: "center", paddingHorizontal: Spacing.four },
  listContent: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  gridContent: { padding: Spacing.three, paddingBottom: Spacing.six },
  row: { gap: COLUMN_GAP, marginBottom: COLUMN_GAP },
  footer: { padding: Spacing.three },
  fullScreenBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fullScreenText: { fontSize: 14, fontWeight: "600" },
});

const noProfileStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.five,
    gap: Spacing.three,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.two,
  },
  title: { textAlign: "center" },
  body: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 4,
    borderRadius: BorderRadius.full,
    marginTop: Spacing.two,
  },
  btnText: {
    fontSize: 15,
    fontWeight: "700",
    color: BrandColors.white,
  },
});

const gridCardStyles = StyleSheet.create({
  card: {
    alignItems: "center",
    padding: Spacing.three,
    borderRadius: BorderRadius.lg,
    gap: Spacing.one,
  },
  name: { fontSize: 13, textAlign: "center" },
  verified: { flexDirection: "row", alignItems: "center", gap: 3 },
  verifiedText: { fontSize: 11, color: BrandColors.primary },
});
