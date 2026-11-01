/**
 * Events module types — mirror the backend EventController DTOs exactly.
 * Verified against EventService.java records and EventController.java.
 */

export type RsvpStatus = 'GOING' | 'INTERESTED' | 'NOT_GOING' | 'WAITLISTED';
/** v10.12 also defines ONLINE_VOICE, but the backend rejects it with
 * ONLINE_VOICE_NOT_SUPPORTED until the Voice Rooms milestone ships; the form
 * therefore only offers the two modes below. */
export type EventMode = 'IN_PERSON' | 'ONLINE_EXTERNAL';
export type VisibilityScope = 'COMMUNITY' | 'COUNTRY';

/** Single event row as serialized by the backend EventRow record. */
export interface EventRow {
  id: string;
  countryId: string | null;
  communityId: string;
  visibilityScope: VisibilityScope;
  organizerId: string;
  ownerUserId: string | null;
  businessAccountId: string | null;
  createdByUserId: string | null;
  categoryId: string;
  countryTopicCategoryId: string | null;
  title: string;
  description: string;
  eventMode: EventMode;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  locationName: string | null;
  externalUrl: string | null;
  capacity: number | null;
  status: 'DRAFT' | 'PUBLISHED' | 'DELETED';
  publishedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  coverMediaId: string | null;
  /** Future Diasporum voice-room reference for ONLINE_VOICE events (null
   * while the Voice Rooms milestone is pending). Provider credentials are
   * never stored on the event. */
  voiceRoomId: string | null;
}

export interface EventCategory {
  id: string;
  countryId: string | null;
  categoryKey: string;
  displayName: string;
  sortOrder: number;
}

export interface ParticipantCounts {
  going: number;
  interested: number;
  waitlisted: number;
}

/** Organizer / participant profile summary (IdentityApi.ProfileSummary subset). */
export interface ProfileSummaryLite {
  id: string;
  username: string;
  displayName: string | null;
  avatarMediaId: string | null;
}

/** List item with viewer-dependent engagement flags. */
export interface EventItem {
  event: EventRow;
  category: EventCategory | null;
  counts: ParticipantCounts;
  myRsvp: RsvpStatus | null;
  saved: boolean;
  canManage: boolean;
}

export interface EventPage {
  items: EventItem[];
  nextCursor: string | null;
}

/** Full detail — list item + organizer + business account name. */
export interface EventDetail extends EventItem {
  organizer: ProfileSummaryLite | null;
  businessAccountName: string | null;
}

export interface RsvpResult {
  status: RsvpStatus;
  counts: ParticipantCounts;
  capacity: number | null;
  promotedUserId: string | null;
}

export interface EventParticipant {
  profile: ProfileSummaryLite;
  rsvpStatus: RsvpStatus;
}

export interface ParticipantPage {
  items: EventParticipant[];
  counts: ParticipantCounts;
  page: number;
  size: number;
}

/** POST /api/v1/events request body. startsAt/endsAt are ISO-8601 instants. */
export interface CreateEventRequest {
  communityId: string;
  visibilityScope?: VisibilityScope;
  categoryId: string;
  countryTopicCategoryId?: string;
  title: string;
  description: string;
  eventMode: EventMode;
  startsAt: string;
  endsAt?: string;
  timezone: string;
  locationName?: string;
  externalUrl?: string;
  capacity?: number;
  coverMediaId?: string;
  businessAccountId?: string;
  draft?: boolean;
}

/** PATCH /api/v1/events/{id} — null/undefined fields keep current values.
 * visibilityScope is validated server-side (membership / event country). */
export interface UpdateEventRequest {
  visibilityScope?: VisibilityScope;
  title?: string;
  description?: string;
  eventMode?: EventMode;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  locationName?: string;
  externalUrl?: string;
  capacity?: number;
  categoryId?: string;
  countryTopicCategoryId?: string;
  coverMediaId?: string;
  clearCover?: boolean;
}

export interface DiscoveryFilters {
  communityId?: string;
  scope?: VisibilityScope;
  categoryId?: string;
  mode?: EventMode;
  from?: string;
  to?: string;
  search?: string;
}
