/**
 * Community + Taxonomy API types — mirrors backend DTOs.
 */

/** CommunityApi.MembershipView */
export interface MembershipView {
  readonly communityId: string;
  readonly userId: string;
  readonly role: string;
  readonly status: "ACTIVE" | "LEFT" | "SUSPENDED";
  readonly joinedAt: string;
}

/** TaxonomyApi.CommunityView */
export interface CommunityView {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly originCountryId: string;
  readonly destinationCountryId: string | null;
  readonly description: string | null;
  readonly active: boolean;
}

/** TaxonomyApi.CountryView */
export interface CountryView {
  readonly id: string;
  readonly name: string;
  readonly iso2: string;
  readonly iso3: string;
  readonly demonym: string | null;
  readonly flagEmoji: string | null;
  readonly active: boolean;
}

/** TaxonomyApi.LanguageView */
export interface LanguageView {
  readonly id: string;
  readonly languageCode: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly sortOrder: number;
}

/** Paginated response wrapper used by taxonomy endpoints */
export interface PagedResponse<T> {
  readonly items: T[];
  readonly total: number;
  readonly page: number;
  readonly size: number;
}

/** GET /api/v1/me/community-preview — the community the user will auto-join. */
export interface CommunityPreviewResponse {
  readonly community: CommunityView;
  readonly originCountry: CountryView;
  readonly destinationCountry: CountryView;
}

/** POST /api/v1/me/onboarding/complete — membership created + community assigned. */
export interface OnboardingCompleteResponse {
  readonly membership: MembershipView;
  readonly community: CommunityView;
}

export type CommunityModuleKey =
  | "FEED"
  | "REELS"
  | "MATCHMAKING"
  | "COMMUNITY_HELP"
  | "BUSINESS_DIRECTORY"
  | "EVENTS"
  | "JOBS"
  | "SERVICE_MARKETPLACE"
  | "SPARE_BAG"
  | "PROPERTY"
  | "VEHICLE"
  | "SHOP_MARKETPLACE"
  | "GENERAL_CHAT"
  | "VOICE_ROOMS"
  | "PEOPLE";

/** Server-resolved Default/Extended context and effective scoped modules. */
export interface CommunityAccessContext {
  readonly communityId: string;
  readonly communityName: string;
  readonly accessType: "DEFAULT" | "ORIGIN_EXTENDED";
  readonly originCountryId: string;
  readonly destinationCountryId: string;
  readonly modules: Partial<Record<CommunityModuleKey, boolean>>;
}

/** GET /api/v1/communities/my-access. */
export interface MyCommunityAccess {
  readonly defaultCommunityId: string | null;
  readonly activeCommunityId: string | null;
  readonly communities: CommunityAccessContext[];
}

export type CommunityActionKey =
  | "EXTENDED_FEED_POST_PUBLISH"
  | "EXTENDED_REEL_PUBLISH"
  | "EXTENDED_MATCHMAKING_LIKE"
  | "EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH";

/** Non-mutating server decision; all amounts and quota values come from Billing. */
export interface CommunityActionEligibility {
  readonly allowed: boolean;
  readonly chargeRequired: boolean;
  readonly consumptionRequired: boolean;
  readonly quantity: number;
  readonly remainingFreeQuota: number | null;
  readonly availableCredits: number | null;
  readonly source: string;
  readonly reason: string;
}
