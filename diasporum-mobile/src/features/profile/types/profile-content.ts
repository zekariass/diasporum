/**
 * Profile feature-tab model — which own-content collection each tab renders,
 * plus the union of row types the profile FlatList can display.
 * Tabs only exist for features with a real "my content" API.
 */

import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

import type { FeedItem } from "@/features/feed/types/feed-types";
import type { EventItem } from "@/features/events/types/event-types";
import type { JobItem } from "@/features/jobs/types/job-types";
import type { VehicleView } from "@/features/vehicles/types/vehicle-types";
import type { PropertyItem } from "@/features/property/types/property-types";
import type { Listing } from "@/features/spare-bag/types/spare-bag-types";
import type {
  ServiceProvider,
  ServiceRequest,
} from "@/features/services/types/service-marketplace-types";

export type ProfileTabKey =
  | "posts"
  | "media"
  | "polls"
  | "events"
  | "jobs"
  | "services"
  | "vehicles"
  | "properties"
  | "spareBag";

export type ServiceSegment = "requests" | "providers";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export interface ProfileTabDef {
  key: ProfileTabKey;
  label: string;
  icon: IconName;
  /** Content section header. */
  sectionTitle: string;
  /** Existing "manage all" screen for this feature, when one exists. */
  seeAllRoute?: string;
  emptyTitle: string;
  emptyMessage: string;
  /** Existing creation flow, surfaced only when it already exists. */
  createLabel?: string;
  createRoute?: string;
}

export const PROFILE_TABS: readonly ProfileTabDef[] = [
  {
    key: "posts",
    label: "Posts",
    icon: "create-outline",
    sectionTitle: "My Posts",
    emptyTitle: "No posts yet",
    emptyMessage: "Posts you share with your communities appear here.",
    createLabel: "Create a post",
    createRoute: "/(app)/posts/create",
  },
  {
    key: "media",
    label: "Media",
    icon: "images-outline",
    sectionTitle: "My Media",
    emptyTitle: "No media yet",
    emptyMessage: "Photos and videos from your posts appear here.",
    createLabel: "Create a post",
    createRoute: "/(app)/posts/create",
  },
  {
    key: "polls",
    label: "Polls",
    icon: "stats-chart-outline",
    sectionTitle: "My Polls",
    emptyTitle: "No polls yet",
    emptyMessage: "You haven't created any polls yet.",
    createLabel: "Create a poll",
    createRoute: "/(app)/posts/create?mode=poll",
  },
  {
    key: "events",
    label: "Events",
    icon: "calendar-outline",
    sectionTitle: "My Events",
    seeAllRoute: "/(app)/events/my",
    emptyTitle: "No events yet",
    emptyMessage: "Events you create or manage appear here.",
    createLabel: "Create an event",
    createRoute: "/(app)/events/create",
  },
  {
    key: "jobs",
    label: "Jobs",
    icon: "briefcase-outline",
    sectionTitle: "My Jobs",
    seeAllRoute: "/(app)/jobs/my",
    emptyTitle: "No job listings yet",
    emptyMessage: "Job listings you publish appear here.",
    createLabel: "Post a job",
    createRoute: "/(app)/jobs/create",
  },
  {
    key: "services",
    label: "Services",
    icon: "construct-outline",
    sectionTitle: "My Services",
    seeAllRoute: "/(app)/services/requests/mine",
    emptyTitle: "Nothing here yet",
    emptyMessage: "Your service requests and provider profiles appear here.",
    createLabel: "Request a service",
    createRoute: "/(app)/services/requests/create",
  },
  {
    key: "vehicles",
    label: "Vehicles",
    icon: "car-outline",
    sectionTitle: "My Vehicles",
    seeAllRoute: "/(app)/vehicles/my",
    emptyTitle: "No vehicle listings yet",
    emptyMessage: "Your vehicle listings will appear here.",
    createLabel: "List a vehicle",
    createRoute: "/(app)/vehicles/create",
  },
  {
    key: "properties",
    label: "Properties",
    icon: "home-outline",
    sectionTitle: "My Properties",
    seeAllRoute: "/(app)/properties/my",
    emptyTitle: "No property listings yet",
    emptyMessage: "Your property listings will appear here.",
    createLabel: "List a property",
    createRoute: "/(app)/properties/create",
  },
  {
    key: "spareBag",
    label: "Spare Bag",
    icon: "airplane-outline",
    sectionTitle: "My Spare Bag",
    seeAllRoute: "/(app)/spare-bag/my",
    emptyTitle: "No listings yet",
    emptyMessage: "Your spare-bag offers and requests appear here.",
    createLabel: "Create a listing",
    createRoute: "/(app)/spare-bag/create-passenger",
  },
] as const;

/** Row union consumed by the profile FlatList. */
export type ProfileRow =
  | { key: string; kind: "post"; post: FeedItem }
  | { key: string; kind: "media"; post: FeedItem; mediaId: string }
  | { key: string; kind: "event"; item: EventItem }
  | { key: string; kind: "job"; item: JobItem }
  | { key: string; kind: "vehicle"; item: VehicleView }
  | { key: string; kind: "property"; item: PropertyItem }
  | { key: string; kind: "spareBag"; item: Listing }
  | { key: string; kind: "serviceRequest"; item: ServiceRequest }
  | { key: string; kind: "serviceProvider"; item: ServiceProvider };
