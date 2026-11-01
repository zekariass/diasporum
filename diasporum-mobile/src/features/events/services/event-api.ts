/**
 * Events API service — wraps all EventController endpoints.
 * All methods use the shared apiClient (bearer auth, host restriction, 401 retry).
 * Verified against EventController.java.
 */

import type { ApiClient } from '@/core/api/api-client';
import type {
  CreateEventRequest, DiscoveryFilters, EventCategory, EventDetail, EventPage,
  EventParticipant, ParticipantPage, RsvpResult, RsvpStatus, UpdateEventRequest,
} from '../types/event-types';

function buildQuery(params: [string, string | undefined][]): string {
  const q = params
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return q ? `?${q}` : '';
}

export function createEventApi(client: ApiClient) {
  return {
    // ---- categories ----
    categories: () =>
      client.get<{ items: EventCategory[] }>('/api/v1/events/categories', {
        authenticated: true,
      }),

    // ---- lifecycle ----
    createEvent: (req: CreateEventRequest) =>
      client.post<EventDetail>('/api/v1/events', req, { authenticated: true }),

    eventDetail: (eventId: string) =>
      client.get<EventDetail>(`/api/v1/events/${eventId}`, {
        authenticated: true,
      }),

    updateEvent: (eventId: string, req: UpdateEventRequest) =>
      client.patch<EventDetail>(`/api/v1/events/${eventId}`, req, {
        authenticated: true,
      }),

    publishEvent: (eventId: string) =>
      client.post<EventDetail>(`/api/v1/events/${eventId}/publish`, undefined, {
        authenticated: true,
      }),

    cancelEvent: (eventId: string, reason?: string) =>
      client.post<EventDetail>(
        `/api/v1/events/${eventId}/cancel`,
        reason ? { reason } : {},
        { authenticated: true },
      ),

    deleteEvent: (eventId: string) =>
      client.delete(`/api/v1/events/${eventId}`, { authenticated: true }),

    /** Authorized cover URL — visibility is checked server-side (non-owner safe). */
    coverDownloadUrl: (eventId: string) =>
      client.get<{ downloadUrl: string }>(
        `/api/v1/events/${eventId}/cover/download-url`,
        { authenticated: true },
      ),

    // ---- discovery ----
    discover: (filters: DiscoveryFilters = {}, cursor?: string, size = 20) =>
      client.get<EventPage>(
        `/api/v1/events${buildQuery([
          ['communityId', filters.communityId],
          ['scope', filters.scope],
          ['categoryId', filters.categoryId],
          ['mode', filters.mode],
          ['from', filters.from],
          ['to', filters.to],
          ['search', filters.search],
          ['cursor', cursor],
          ['size', String(size)],
        ])}`,
        { authenticated: true },
      ),

    /** Community-specific listing (requires active membership). */
    communityEvents: (communityId: string, cursor?: string, size = 20) =>
      client.get<EventPage>(
        `/api/v1/communities/${communityId}/events${buildQuery([
          ['cursor', cursor],
          ['size', String(size)],
        ])}`,
        { authenticated: true },
      ),

    // ---- RSVP ----
    setRsvp: (eventId: string, status: RsvpStatus) =>
      client.put<RsvpResult>(`/api/v1/events/${eventId}/rsvp`, { status }, {
        authenticated: true,
      }),

    removeRsvp: (eventId: string) =>
      client.delete<RsvpResult>(`/api/v1/events/${eventId}/rsvp`, {
        authenticated: true,
      }),

    participants: (eventId: string, status?: string, page = 0, size = 20) =>
      client.get<ParticipantPage>(
        `/api/v1/events/${eventId}/participants${buildQuery([
          ['status', status],
          ['page', String(page)],
          ['size', String(size)],
        ])}`,
        { authenticated: true },
      ),

    // ---- saves ----
    saveEvent: (eventId: string) =>
      client.put(`/api/v1/events/${eventId}/save`, {}, { authenticated: true }),

    unsaveEvent: (eventId: string) =>
      client.delete(`/api/v1/events/${eventId}/save`, { authenticated: true }),

    savedEvents: (page = 0, size = 20) =>
      client.get<{ items: EventPage['items']; page: number; size: number }>(
        `/api/v1/me/events/saved${buildQuery([
          ['page', String(page)],
          ['size', String(size)],
        ])}`,
        { authenticated: true },
      ),

    // ---- my events ----
    myEvents: (role: 'organized' | 'participating' = 'organized', page = 0, size = 20) =>
      client.get<{ items: EventPage['items']; page: number; size: number }>(
        `/api/v1/me/events${buildQuery([
          ['role', role],
          ['page', String(page)],
          ['size', String(size)],
        ])}`,
        { authenticated: true },
      ),

    // ---- reporting ----
    reportEvent: (eventId: string, reason: string, details?: string) =>
      client.post<{ id: string }>(
        `/api/v1/events/${eventId}/report`,
        { reason, ...(details ? { details } : {}) },
        { authenticated: true },
      ),
  };
}

export type EventApi = ReturnType<typeof createEventApi>;
export type { EventParticipant };
