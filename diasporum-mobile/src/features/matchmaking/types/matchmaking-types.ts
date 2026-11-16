export type MatchmakingStatus =
  | "DRAFT"
  | "ACTIVE"
  | "PAUSED"
  | "SUSPENDED"
  | "DELETED";
export type SwipeAction = "LIKE" | "PASS";
export type SwipeStatus = "ACTIVE" | "WITHDRAWN" | "REWOUND";
export type MatchStatus = "MATCHED" | "UNMATCHED" | "CLOSED" | "BLOCKED";
export type PhotoRendition = "ORIGINAL" | "BLURRED";

/** One owned gallery photo; `url` is the presigned original rendition. */
export interface MatchmakingProfilePhoto {
  id: string;
  mediaId: string;
  sortOrder: number;
  isPrimary: boolean;
  url: string | null;
}

/** Photo collection plus the backend-configured upload limit. */
export interface MatchmakingPhotoList {
  photos: MatchmakingProfilePhoto[];
  maxPhotos: number;
}

export interface MatchmakingProfile {
  userId: string;
  genderKey: string;
  addressId: string | null;
  nationalityCountryId: string | null;
  religionId: string | null;
  educationLevel: string | null;
  occupation: string | null;
  relationshipIntention: string | null;
  maritalStatus: string | null;
  hasChildren: boolean | null;
  wantsChildren: string | null;
  smoking: string | null;
  drinking: string | null;
  activityLevel: string | null;
  heightCm: number | null;
  marriageTimeline: string | null;
  longDistanceRelationship: boolean | null;
  religionImportance: string | null;
  willingToRelocate: boolean | null;
  blurPhotosUntilMatch: boolean;
  hideNameUntilMatch: boolean;
  anonymousAlias: string;
  verificationStatus:
    | "NOT_VERIFIED"
    | "PENDING"
    | "VERIFIED"
    | "REJECTED"
    | "REVOKED";
  status: MatchmakingStatus;
  activatedAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
  photos: MatchmakingProfilePhoto[];
  maxProfilePhotos: number;
}

/**
 * Photos are managed exclusively through the /profile/photos endpoints —
 * they are never part of the profile write request.
 */
export type MatchmakingProfileRequest = Omit<
  MatchmakingProfile,
  | "userId"
  | "verificationStatus"
  | "activatedAt"
  | "lastActiveAt"
  | "createdAt"
  | "updatedAt"
  | "photos"
  | "maxProfilePhotos"
> & { status: "DRAFT" | "ACTIVE" | "PAUSED" };

export interface SharedProfileDraft {
  bio: string;
  city: string;
  currentCountryId: string | null;
  interestIds: string[];
  languageIds: string[];
}

/** Gender is derived server-side (automatic opposite-gender discovery). */
export interface MatchmakingPreferences {
  userId: string;
  minAge: number;
  maxAge: number;
  maxDistanceKm: number | null;
  showVerifiedOnly: boolean;
  hasChildrenPreference: "ANY" | "YES" | "NO";
  wantsChildrenPreference: "ANY" | "YES" | "NO" | "UNSURE";
  religionIds: string[];
  languageIds: string[];
}

export type MatchmakingPreferencesRequest = Omit<
  MatchmakingPreferences,
  "userId"
>;

/**
 * One authorised photo rendition for the requesting viewer. `url` is
 * presigned against the specific permitted rendition only — the client
 * never decides which rendition it may see.
 */
export interface PublicPhoto {
  url: string | null;
  isPrimary: boolean;
  sortOrder: number;
  rendition: PhotoRendition;
}

export interface PublicMatchmakingProfile {
  bio?: string | null;
  publicLocation?: string | null;
  interests?: string[];
  languages?: string[];
  userId: string;
  displayName: string;
  photoUrl: string | null;
  photos: PublicPhoto[];
  nameRevealed: boolean;
  genderKey: string;
  age: number | null;
  nationalityCountryId: string | null;
  religionId: string | null;
  educationLevel: string | null;
  occupation: string | null;
  relationshipIntention: string | null;
  maritalStatus: string | null;
  hasChildren: boolean | null;
  wantsChildren: string | null;
  smoking: string | null;
  drinking: string | null;
  activityLevel: string | null;
  heightCm: number | null;
  marriageTimeline: string | null;
  longDistanceRelationship: boolean | null;
  religionImportance: string | null;
  willingToRelocate: boolean | null;
  verificationStatus: string;
}

export interface MatchView {
  id: string;
  status: MatchStatus;
  other: PublicMatchmakingProfile;
  matchedAt: string;
  closedAt: string | null;
  conversationId: string | null;
}

export interface SwipeResult {
  action: SwipeAction;
  status: SwipeStatus;
  matched: boolean;
  matchId: string | null;
  conversationId: string | null;
}

export type EligibilityReason =
  | "ELIGIBLE"
  /** No stored date of birth — the DOB form must be completed first. */
  | "DOB_REQUIRED"
  | "AGE_CONFIRMATION_REQUIRED"
  | "NO_PROFILE"
  | "PROFILE_INCOMPLETE"
  | "PROFILE_PAUSED"
  | "PROFILE_SUSPENDED"
  | "PROFILE_DELETED"
  /** A birth date exists but fails the 18+ check. */
  | "NOT_ADULT"
  | "DISCOVERY_OPT_IN_REQUIRED";

/** Server-computed Dating entry state — the backend decides which flow applies. */
export interface MatchmakingEligibility {
  eligible: boolean;
  reason: EligibilityReason;
  profileStatus: MatchmakingStatus | null;
  verificationStatus: MatchmakingProfile["verificationStatus"] | null;
  adult: boolean;
  hasDateOfBirth: boolean;
  discoveryOptIn: boolean;
  hasPreferences: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ReferenceOption {
  id: string;
  label: string;
}

export interface PrivateAddressOption extends ReferenceOption {
  countryId: string;
}

export interface MatchmakingReferenceData {
  genders: ReferenceOption[];
  religions: ReferenceOption[];
  countries: ReferenceOption[];
  languages: ReferenceOption[];
  addresses: PrivateAddressOption[];
  profileOptions?: Record<string, ReferenceOption[]>;
  maxProfilePhotos: number;
}

export interface PrivacySettings {
  allowMatchmakingDiscovery: boolean;
}

/** Minimal identity of a blocked member for the management screen. */
export interface BlockedUser {
  id: string;
  username: string | null;
  displayName: string | null;
}
