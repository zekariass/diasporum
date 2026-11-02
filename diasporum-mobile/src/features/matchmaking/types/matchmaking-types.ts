export type MatchmakingStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'SUSPENDED' | 'DELETED';
export type FieldVisibility = 'VISIBLE' | 'BLURRED' | 'HIDDEN';
export type SwipeAction = 'LIKE' | 'PASS';
export type SwipeStatus = 'ACTIVE' | 'WITHDRAWN' | 'REWOUND';
export type MatchStatus = 'MATCHED' | 'UNMATCHED' | 'CLOSED' | 'BLOCKED';

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
  photoMediaId: string | null;
  blurredPhotoMediaId: string | null;
  nameVisibility: FieldVisibility;
  photoVisibility: FieldVisibility;
  anonymousAlias: string;
  verificationStatus: 'NOT_VERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REVOKED';
  status: MatchmakingStatus;
  activatedAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MatchmakingProfileRequest = Omit<
  MatchmakingProfile,
  'userId' | 'verificationStatus' | 'activatedAt' | 'lastActiveAt' | 'createdAt' | 'updatedAt'
> & { status: 'DRAFT' | 'ACTIVE' | 'PAUSED' };

export interface MatchmakingPreferences {
  userId: string;
  minAge: number;
  maxAge: number;
  maxDistanceKm: number | null;
  showVerifiedOnly: boolean;
  hasChildrenPreference: 'ANY' | 'YES' | 'NO';
  wantsChildrenPreference: 'ANY' | 'YES' | 'NO' | 'UNSURE';
  genderKeys: string[];
  religionIds: string[];
  languageIds: string[];
}

export type MatchmakingPreferencesRequest = Omit<MatchmakingPreferences, 'userId'>;

export interface PublicMatchmakingProfile {
  userId: string;
  displayName: string;
  photoUrl: string | null;
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
}

export interface PrivacySettings {
  allowMatchmakingDiscovery: boolean;
}
