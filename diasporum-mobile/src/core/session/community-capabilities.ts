import type {
  CommunityAccessContext,
  CommunityModuleKey,
  MyCommunityAccess,
} from "@/features/communities/types/community-types";

export const FEATURE_MODULE_KEYS: Readonly<Record<string, CommunityModuleKey>> =
  {
    feed: "FEED",
    reels: "REELS",
    people: "PEOPLE",
    dating: "MATCHMAKING",
    property: "PROPERTY",
    vehicle: "VEHICLE",
    event: "EVENTS",
    "spare-bag": "SPARE_BAG",
    business: "BUSINESS_DIRECTORY",
    jobs: "JOBS",
    poll: "FEED",
    help: "COMMUNITY_HELP",
    services: "SERVICE_MARKETPLACE",
  };

const MODULE_LABELS: Readonly<Partial<Record<CommunityModuleKey, string>>> = {
  FEED: "Feed",
  REELS: "Reels",
  MATCHMAKING: "Matchmaking",
  COMMUNITY_HELP: "Community Help & Offers",
  PEOPLE: "People",
  PROPERTY: "Property",
  VEHICLE: "Vehicles",
  EVENTS: "Events",
  SPARE_BAG: "Spare Bag",
  BUSINESS_DIRECTORY: "Business",
  JOBS: "Jobs",
  SERVICE_MARKETPLACE: "Services",
  SHOP_MARKETPLACE: "Shops",
  GENERAL_CHAT: "General Chat",
  VOICE_ROOMS: "Voice Rooms",
};

export function activeCommunityContext(
  access: MyCommunityAccess | null | undefined,
): CommunityAccessContext | null {
  if (!access?.activeCommunityId) return null;
  return (
    access.communities.find(
      (community) => community.communityId === access.activeCommunityId,
    ) ?? null
  );
}

/**
 * A missing snapshot preserves compatibility with an older backend. Once the
 * new endpoint has responded, an unavailable active context fails closed.
 */
export function isCommunityModuleEnabled(
  access: MyCommunityAccess | null | undefined,
  moduleKey: CommunityModuleKey,
): boolean {
  if (access == null) return true;
  return activeCommunityContext(access)?.modules[moduleKey] === true;
}

export function isExtendedCommunity(
  access: MyCommunityAccess | null | undefined,
): boolean {
  return activeCommunityContext(access)?.accessType === "ORIGIN_EXTENDED";
}

export function enabledModuleSummary(context: CommunityAccessContext): string {
  if (context.accessType === "DEFAULT") return "Full community access";
  const labels = Object.entries(MODULE_LABELS)
    .filter(([key]) => context.modules[key as CommunityModuleKey] === true)
    .map(([, label]) => label);
  return labels.length > 0
    ? labels.join(" · ")
    : "No modules currently enabled";
}

/** Maps deep links to the same backend module keys used by navigation. */
export function communityModuleForPath(
  pathname: string,
  mode?: string,
): CommunityModuleKey | null {
  const path = pathname.split("?")[0];
  const hasSegment = (segment: string) =>
    new RegExp(`(?:^|/)${segment}(?:/|$)`).test(path);

  if (hasSegment("posts")) return mode === "help" ? "COMMUNITY_HELP" : "FEED";
  if (hasSegment("reels")) return "REELS";
  if (hasSegment("matchmaking")) return "MATCHMAKING";
  if (hasSegment("people")) return "PEOPLE";
  if (hasSegment("properties")) return "PROPERTY";
  if (hasSegment("vehicles")) return "VEHICLE";
  if (hasSegment("events")) return "EVENTS";
  if (hasSegment("jobs")) return "JOBS";
  if (hasSegment("spare-bag")) return "SPARE_BAG";
  if (hasSegment("services")) return "SERVICE_MARKETPLACE";
  if (hasSegment("business") || hasSegment("businesses"))
    return "BUSINESS_DIRECTORY";
  if (hasSegment("shops")) return "SHOP_MARKETPLACE";
  if (hasSegment("rooms")) return "VOICE_ROOMS";
  return null;
}
