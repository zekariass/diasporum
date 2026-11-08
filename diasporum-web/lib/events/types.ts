/**
 * Events UI types — mirror the backend EventController DTOs
 * (see diasporum-mobile/src/features/events/types/event-types.ts)
 * plus presentational fields needed to reproduce the Eventbrite-style
 * layout (cover palette, price label). The presentational fields are
 * mock-only and can be dropped or mapped once a real API feeds these
 * screens.
 */

export type RsvpStatus = "GOING" | "INTERESTED" | "NOT_GOING" | "WAITLISTED";
export type EventMode = "IN_PERSON" | "ONLINE_EXTERNAL";
export type VisibilityScope = "COMMUNITY" | "COUNTRY";

export interface EventCategory {
  id: string;
  categoryKey: string;
  displayName: string;
  sortOrder: number;
}

export interface ParticipantCounts {
  going: number;
  interested: number;
  waitlisted: number;
}

export interface OrganizerSummary {
  id: string;
  displayName: string;
  /** Presentational only — not in the backend payload. */
  followers: number;
}

/** Event fields as serialized by the backend EventRow record. */
export interface EventRow {
  id: string;
  countryId: string | null;
  communityId: string;
  visibilityScope: VisibilityScope;
  organizerId: string;
  categoryId: string;
  title: string;
  description: string;
  eventMode: EventMode;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  locationName: string | null;
  externalUrl: string | null;
  capacity: number | null;
  status: "DRAFT" | "PUBLISHED" | "DELETED";
  cancelledAt: string | null;
  cancelReason: string | null;
}

/** Presentational extras layered on top of the backend shape. */
export interface EventView {
  event: EventRow;
  category: EventCategory | null;
  communityName: string;
  counts: ParticipantCounts;
  myRsvp: RsvpStatus | null;
  saved: boolean;
  organizer: OrganizerSummary;
  /** Mock-only: Eventbrite cards show a price; Diasporum has no ticketing
   * yet, so this is presentational until a ticketing milestone exists. */
  priceCents: number | null;
  currency: string;
  /** Mock-only cover art palette index (1..8) used by <EventArt/>. */
  coverPalette: number;
  /** Mock-only listing badges. */
  promoted: boolean;
  almostFull: boolean;
}
