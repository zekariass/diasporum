/**
 * ProfileScreen — redesigned personal profile: themed cover + overlapping
 * avatar, identity block, Business Workspace entry, stats row, horizontally
 * scrollable feature tabs and the selected tab's own-content collection.
 *
 * A single FlatList provides the vertical scroll, pull-to-refresh and
 * cursor pagination; `key={activeTab}` remounts it per tab so grid/list
 * layouts and scroll position never leak between tabs. Every tab's hook
 * stays mounted once opened, so switching back is instant and cached.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";

import { PostItem } from "@/features/feed/components/post-item";
import { openPostDetail } from "@/features/feed/utils/post-detail-seed";
import { EventCard } from "@/features/events/components/event-card";
import { JobCard } from "@/features/jobs/components/job-card";
import { VehicleCard } from "@/features/vehicles/components/vehicle-card";
import { PropertyCard } from "@/features/property/components/property-card";
import { ListingCard } from "@/features/spare-bag/components/spare-bag-ui";
import {
  ProviderCard,
  RequestCard,
} from "@/features/services/components/service-ui";

import { createFeedApi } from "@/features/feed/services/feed-api";
import { createEventApi } from "@/features/events/services/event-api";
import { createJobApi } from "@/features/jobs/services/job-api";
import { createVehicleApi } from "@/features/vehicles/services/vehicle-api";
import { createPropertyApi } from "@/features/property/services/property-api";
import { createSpareBagApi } from "@/features/spare-bag/services/spare-bag-api";
import { createServiceMarketplaceApi } from "@/features/services/services/service-marketplace-api";
import { createSocialApi } from "../services/social-api";

import type { FeedItem, Poll } from "@/features/feed/types/feed-types";
import type { EventItem } from "@/features/events/types/event-types";
import type { JobItem } from "@/features/jobs/types/job-types";
import type { VehicleView } from "@/features/vehicles/types/vehicle-types";
import type { PropertyItem } from "@/features/property/types/property-types";
import type { Listing } from "@/features/spare-bag/types/spare-bag-types";
import type {
  ServiceProvider,
  ServiceRequest,
} from "@/features/services/types/service-marketplace-types";

import { useProfileCollection } from "../hooks/use-profile-collection";
import { useMyPosts, type MyPosts } from "../hooks/use-my-posts";
import { ProfileCover } from "../components/profile-cover";
import { ProfileIdentity } from "../components/profile-identity";
import { WorkspaceCard } from "../components/workspace-card";
import { ProfileStats } from "../components/profile-stats";
import { ProfileFeatureTabs } from "../components/profile-feature-tabs";
import {
  MediaTile,
  ProfileEmpty,
  ProfileError,
  ProfileListSkeleton,
  SectionHeader,
} from "../components/profile-states";
import {
  PROFILE_TABS,
  type ProfileRow,
  type ProfileTabDef,
  type ProfileTabKey,
  type ServiceSegment,
} from "../types/profile-content";

const PAGE_SIZE = 20;

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session, apiClient } = useSession();
  const profile = session?.profile;

  const [activeTab, setActiveTab] = useState<ProfileTabKey>("posts");
  const [serviceSegment, setServiceSegment] =
    useState<ServiceSegment>("requests");

  // ---- API clients ----------------------------------------------------
  const feedApi = useMemo(() => createFeedApi(apiClient), [apiClient]);
  const eventApi = useMemo(() => createEventApi(apiClient), [apiClient]);
  const jobApi = useMemo(() => createJobApi(apiClient), [apiClient]);
  const vehicleApi = useMemo(() => createVehicleApi(apiClient), [apiClient]);
  const propertyApi = useMemo(
    () => createPropertyApi(apiClient),
    [apiClient],
  );
  const spareBagApi = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const serviceApi = useMemo(
    () => createServiceMarketplaceApi(apiClient),
    [apiClient],
  );
  const socialApi = useMemo(() => createSocialApi(apiClient), [apiClient]);

  // ---- own-content collections (lazy — fetch on first tab open) -------
  const posts = useMyPosts({}, activeTab === "posts");
  const mediaPosts = useMyPosts({ hasMedia: true }, activeTab === "media");
  const polls = useMyPosts(
    { postType: "POLL" },
    activeTab === "polls",
  );

  const fetchEvents = useCallback(
    (token: string | null) => {
      const page = token ? Number(token) : 0;
      return eventApi.myEvents("organized", page, PAGE_SIZE).then((r) => ({
        items: r.items,
        nextToken: r.items.length === PAGE_SIZE ? String(page + 1) : null,
      }));
    },
    [eventApi],
  );
  const eventKey = useCallback((i: EventItem) => i.event.id, []);
  const events = useProfileCollection(
    fetchEvents,
    eventKey,
    activeTab === "events",
  );

  const fetchJobs = useCallback(
    (token: string | null) =>
      jobApi.myJobs(token ?? undefined, PAGE_SIZE).then((r) => ({
        items: r.items,
        nextToken: r.nextCursor,
      })),
    [jobApi],
  );
  const jobKey = useCallback((i: JobItem) => i.job.id, []);
  const jobs = useProfileCollection(fetchJobs, jobKey, activeTab === "jobs");

  const fetchServiceRequests = useCallback(
    (token: string | null) =>
      serviceApi.myRequests(undefined, token ?? undefined).then((r) => ({
        items: r.items,
        nextToken: r.nextCursor,
      })),
    [serviceApi],
  );
  const requestKey = useCallback((i: ServiceRequest) => i.id, []);
  const serviceRequests = useProfileCollection(
    fetchServiceRequests,
    requestKey,
    activeTab === "services" && serviceSegment === "requests",
  );

  const fetchServiceProviders = useCallback(
    (token: string | null) =>
      serviceApi.myProviders(undefined, token ?? undefined).then((r) => ({
        items: r.items,
        nextToken: r.nextCursor,
      })),
    [serviceApi],
  );
  const providerKey = useCallback((i: ServiceProvider) => i.id, []);
  const serviceProviders = useProfileCollection(
    fetchServiceProviders,
    providerKey,
    activeTab === "services" && serviceSegment === "providers",
  );

  const fetchVehicles = useCallback(
    (token: string | null) =>
      vehicleApi.myVehicles({}, token ?? undefined, PAGE_SIZE).then((r) => ({
        items: r.items,
        nextToken: r.nextCursor,
      })),
    [vehicleApi],
  );
  const vehicleKey = useCallback((i: VehicleView) => i.listing.id, []);
  const vehicles = useProfileCollection(
    fetchVehicles,
    vehicleKey,
    activeTab === "vehicles",
  );

  const fetchProperties = useCallback(
    (token: string | null) =>
      propertyApi
        .mine(undefined, undefined, token ?? undefined, PAGE_SIZE)
        .then((r) => ({ items: r.items, nextToken: r.nextCursor })),
    [propertyApi],
  );
  const propertyKey = useCallback((i: PropertyItem) => i.property.id, []);
  const properties = useProfileCollection(
    fetchProperties,
    propertyKey,
    activeTab === "properties",
  );

  const fetchListings = useCallback(
    (token: string | null) =>
      spareBagApi.mine(undefined, token ?? undefined, PAGE_SIZE).then((r) => ({
        items: r.items,
        nextToken: r.nextCursor,
      })),
    [spareBagApi],
  );
  const listingKey = useCallback((i: Listing) => i.id, []);
  const spareBag = useProfileCollection(
    fetchListings,
    listingKey,
    activeTab === "spareBag",
  );

  // ---- stats row -------------------------------------------------------
  const [social, setSocial] = useState<{
    followers: number | null;
    following: number | null;
  }>({ followers: null, following: null });
  const loadStats = useCallback(() => {
    void socialApi
      .followers(0, 1)
      .then((r) => setSocial((s) => ({ ...s, followers: r.total })))
      .catch(() => {});
    void socialApi
      .following(0, 1)
      .then((r) => setSocial((s) => ({ ...s, following: r.total })))
      .catch(() => {});
  }, [socialApi]);
  const statsStarted = useRef(false);
  useEffect(() => {
    if (!statsStarted.current) {
      statsStarted.current = true;
      loadStats();
    }
  }, [loadStats]);

  // ---- poll management (same wiring as the home feed) ------------------
  const updatePoll = useCallback(
    (col: MyPosts, item: FeedItem, poll: Poll) => {
      col.updatePost(item.sourceId, { payload: { ...item.payload, poll } });
    },
    [],
  );
  const closePoll = useCallback(
    async (col: MyPosts, item: FeedItem) => {
      try {
        const updated = await feedApi.closePoll(item.sourceId);
        updatePoll(col, item, updated);
      } catch (cause) {
        Alert.alert(
          "Could not close poll",
          ApiError.isApiError(cause) ? cause.userMessage : "Please try again.",
        );
      }
    },
    [feedApi, updatePoll],
  );

  const renderPost = useCallback(
    (item: FeedItem, col: MyPosts) => (
      <PostItem
        item={item}
        isOwner
        canManage
        onPress={() => openPostDetail(router, item)}
        onComment={() => openPostDetail(router, item)}
        onReact={(r) => void col.react(item.sourceId, r)}
        onSave={() => void col.toggleSave(item.sourceId)}
        onEdit={() =>
          router.push(`/(app)/posts/edit/${item.sourceId}` as never)
        }
        onDelete={() => void col.deletePost(item.sourceId)}
        onPollVote={item.contentType === "POLL" ? feedApi.vote : undefined}
        onPollChange={(poll) => updatePoll(col, item, poll)}
        onClosePoll={() => void closePoll(col, item)}
      />
    ),
    [router, feedApi.vote, updatePoll, closePoll],
  );

  // ---- per-tab row data + active collection ----------------------------
  const tabDef: ProfileTabDef = useMemo(
    () => PROFILE_TABS.find((t) => t.key === activeTab) ?? PROFILE_TABS[0],
    [activeTab],
  );

  const serviceCollection =
    serviceSegment === "requests" ? serviceRequests : serviceProviders;

  const activeCollection =
    activeTab === "posts"
      ? posts
      : activeTab === "media"
        ? mediaPosts
        : activeTab === "polls"
          ? polls
          : activeTab === "events"
            ? events
            : activeTab === "jobs"
              ? jobs
              : activeTab === "services"
                ? serviceCollection
                : activeTab === "vehicles"
                  ? vehicles
                  : activeTab === "properties"
                    ? properties
                    : spareBag;

  const rows: ProfileRow[] = useMemo(() => {
    switch (activeTab) {
      case "posts":
        return posts.items.map((p) => ({
          key: p.itemId,
          kind: "post" as const,
          post: p,
        }));
      case "media":
        return mediaPosts.items.flatMap((p) =>
          p.mediaIds.map((mediaId) => ({
            key: `${p.sourceId}:${mediaId}`,
            kind: "media" as const,
            post: p,
            mediaId,
          })),
        );
      case "polls":
        return polls.items.map((p) => ({
          key: p.itemId,
          kind: "post" as const,
          post: p,
        }));
      case "events":
        return events.items.map((i) => ({
          key: i.event.id,
          kind: "event" as const,
          item: i,
        }));
      case "jobs":
        return jobs.items.map((i) => ({
          key: i.job.id,
          kind: "job" as const,
          item: i,
        }));
      case "services":
        return serviceSegment === "requests"
          ? serviceRequests.items.map((i) => ({
              key: i.id,
              kind: "serviceRequest" as const,
              item: i,
            }))
          : serviceProviders.items.map((i) => ({
              key: i.id,
              kind: "serviceProvider" as const,
              item: i,
            }));
      case "vehicles":
        return vehicles.items.map((i) => ({
          key: i.listing.id,
          kind: "vehicle" as const,
          item: i,
        }));
      case "properties":
        return properties.items.map((i) => ({
          key: i.property.id,
          kind: "property" as const,
          item: i,
        }));
      case "spareBag":
        return spareBag.items.map((i) => ({
          key: i.id,
          kind: "spareBag" as const,
          item: i,
        }));
    }
  }, [
    activeTab,
    posts.items,
    mediaPosts.items,
    polls.items,
    events.items,
    jobs.items,
    serviceSegment,
    serviceRequests.items,
    serviceProviders.items,
    vehicles.items,
    properties.items,
    spareBag.items,
  ]);

  const sectionCount =
    activeTab === "posts"
      ? posts.total
      : activeTab === "media"
        ? mediaPosts.total
        : activeTab === "polls"
          ? polls.total
          : null;

  const seeAllRoute =
    activeTab === "services"
      ? serviceSegment === "requests"
        ? "/(app)/services/requests/mine"
        : "/(app)/services/providers/mine"
      : tabDef.seeAllRoute;

  const onRefresh = useCallback(() => {
    loadStats();
    activeCollection.refresh();
  }, [loadStats, activeCollection]);

  // ---- header ----------------------------------------------------------

  const header = (
    <View>
      <ProfileCover
        displayName={profile?.displayName ?? null}
        avatarMediaId={profile?.avatarMediaId ?? null}
        onEditPress={() => router.push("/(app)/profile/edit")}
        onSettingsPress={() => router.push("/(app)/settings/security" as never)}
        onAvatarPress={() => router.push("/(app)/profile/edit")}
      />
      <ProfileIdentity
        displayName={profile?.displayName ?? null}
        username={profile?.username ?? null}
        bio={profile?.bio ?? null}
        city={profile?.city ?? null}
        verified={profile?.profileCompleted ?? false}
      />
      <WorkspaceCard onPress={() => router.push("/(app)/business" as never)} />
      <ProfileStats
        posts={posts.total}
        followers={social.followers}
        following={social.following}
        onPostsPress={() => setActiveTab("posts")}
      />
      <ProfileFeatureTabs active={activeTab} onSelect={setActiveTab} />
      <SectionHeader
        title={tabDef.sectionTitle}
        count={sectionCount}
        onSeeAll={
          seeAllRoute ? () => router.push(seeAllRoute as never) : undefined
        }
      />
      {activeTab === "services" ? (
        <View style={styles.segmentRow}>
          {(["requests", "providers"] as ServiceSegment[]).map((seg) => {
            const selected = seg === serviceSegment;
            return (
              <Pressable
                key={seg}
                onPress={() => setServiceSegment(seg)}
                accessibilityRole="tab"
                accessibilityLabel={
                  seg === "requests"
                    ? "My service requests"
                    : "My service provider profiles"
                }
                accessibilityState={{ selected }}
                style={[
                  styles.segmentChip,
                  {
                    backgroundColor: selected
                      ? theme.backgroundElement
                      : "transparent",
                  },
                ]}
              >
                <ThemedText
                  style={[
                    styles.segmentLabel,
                    {
                      color: selected ? theme.text : theme.textSecondary,
                      fontWeight: selected ? "700" : "500",
                    },
                  ]}
                >
                  {seg === "requests" ? "Requests" : "Providers"}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );

  // ---- row rendering ---------------------------------------------------

  const renderRow = useCallback(
    ({ item }: { item: ProfileRow }) => {
      switch (item.kind) {
        case "post":
          return renderPost(item.post, activeTab === "polls" ? polls : posts);
        case "media":
          return (
            <MediaTile
              post={item.post}
              mediaId={item.mediaId}
              onPress={() =>
                router.push(`/(app)/posts/${item.post.sourceId}` as never)
              }
            />
          );
        case "event":
          return (
            <EventCard
              item={item.item}
              onPress={(id) => router.push(`/(app)/events/${id}` as never)}
            />
          );
        case "job":
          return (
            <JobCard
              item={item.item}
              onPress={(id) => router.push(`/(app)/jobs/${id}` as never)}
            />
          );
        case "vehicle":
          return (
            <VehicleCard
              item={item.item}
              onPress={(id) => router.push(`/(app)/vehicles/${id}` as never)}
            />
          );
        case "property":
          return (
            <PropertyCard
              item={item.item}
              managed
              onPress={(id) => router.push(`/(app)/properties/${id}` as never)}
            />
          );
        case "spareBag":
          return <ListingCard listing={item.item} />;
        case "serviceRequest":
          return <RequestCard request={item.item} />;
        case "serviceProvider":
          return <ProviderCard provider={item.item} />;
      }
    },
    [renderPost, activeTab, polls, posts, router],
  );

  const keyExtractor = useCallback((r: ProfileRow) => r.key, []);

  const isMedia = activeTab === "media";

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <FlatList
        key={activeTab}
        data={rows}
        renderItem={renderRow}
        keyExtractor={keyExtractor}
        numColumns={isMedia ? 3 : 1}
        columnWrapperStyle={isMedia ? styles.gridRow : undefined}
        ListHeaderComponent={header}
        onEndReached={activeCollection.loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={activeCollection.refreshing}
            onRefresh={onRefresh}
            tintColor={BrandColors.primary}
            colors={[BrandColors.primary]}
          />
        }
        ListEmptyComponent={
          !activeCollection.loaded || activeCollection.loading ? (
            <ProfileListSkeleton />
          ) : activeCollection.error ? (
            <ProfileError
              message={activeCollection.error}
              onRetry={activeCollection.refresh}
            />
          ) : (
            <ProfileEmpty
              icon={tabDef.icon}
              title={tabDef.emptyTitle}
              message={tabDef.emptyMessage}
              actionLabel={tabDef.createLabel}
              onAction={
                tabDef.createRoute
                  ? () => router.push(tabDef.createRoute as never)
                  : undefined
              }
            />
          )
        }
        ListFooterComponent={
          activeCollection.loadingMore ? (
            <ActivityIndicator
              style={styles.footer}
              color={BrandColors.primary}
            />
          ) : activeCollection.error && rows.length > 0 ? (
            <ProfileError
              message={activeCollection.error}
              onRetry={activeCollection.refresh}
            />
          ) : (
            <View style={styles.footer} />
          )
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          rows.length === 0 ? styles.emptyContainer : styles.listContainer
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContainer: { paddingBottom: Spacing.six },
  emptyContainer: { flexGrow: 1, paddingBottom: Spacing.six },
  gridRow: { gap: 2, paddingHorizontal: 2 },
  segmentRow: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  segmentChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  segmentLabel: { fontSize: 13, lineHeight: 18 },
  footer: { paddingVertical: Spacing.four },
});
