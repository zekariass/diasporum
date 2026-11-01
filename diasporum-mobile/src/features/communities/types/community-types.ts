/**
 * Community + Taxonomy API types — mirrors backend DTOs.
 */

/** CommunityApi.MembershipView */
export interface MembershipView {
  readonly communityId: string;
  readonly userId: string;
  readonly role: string;
  readonly status: 'ACTIVE' | 'LEFT' | 'SUSPENDED';
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
