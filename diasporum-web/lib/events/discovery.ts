import type { EventView } from "./types";
import { EVENTS } from "./mock-events";

/** Mock "today" — matches the fixture dates so filters return results. */
const NOW = new Date("2026-11-07T12:00:00Z");

function sameDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/** Flat shape the shared matcher works on — keeps the predicate usable
 * client-side for live counts without dragging EventView around. */
export interface EventFacet {
  id: string;
  title: string;
  startsAt: string;
  eventMode: string;
  priceCents: number | null;
  categoryKey: string | null;
  status: string;
  cancelledAt: string | null;
  locationName: string | null;
  organizerName: string;
  communityName: string;
  promoted: boolean;
}

export function toFacet(item: EventView): EventFacet {
  return {
    id: item.event.id,
    title: item.event.title,
    startsAt: item.event.startsAt,
    eventMode: item.event.eventMode,
    priceCents: item.priceCents,
    categoryKey: item.category?.categoryKey ?? null,
    status: item.event.status,
    cancelledAt: item.event.cancelledAt,
    locationName: item.event.locationName,
    organizerName: item.organizer.displayName,
    communityName: item.communityName,
    promoted: item.promoted,
  };
}

export const FACETS: EventFacet[] = EVENTS.map(toFacet);

export interface FilterSelection {
  date: string; // any | today | weekend | week | month
  price: string; // any | free | paid
  mode: string; // any | inperson | online
  categories: string[]; // categoryKeys
}

export const DEFAULT_SELECTION: FilterSelection = { date: "any", price: "any", mode: "any", categories: [] };

function inDateRange(iso: string, date: string): boolean {
  if (date === "any") return true;
  const d = new Date(iso);
  if (d < NOW) return false;
  switch (date) {
    case "today":
      return sameDay(d, NOW);
    case "weekend": {
      const day = d.getUTCDay();
      return (day === 6 || day === 0) && d.getTime() - NOW.getTime() < 8 * 86400000;
    }
    case "week":
      return d.getTime() - NOW.getTime() < 7 * 86400000;
    case "month":
      return d.getUTCMonth() === NOW.getUTCMonth() && d.getUTCFullYear() === NOW.getUTCFullYear();
    default:
      return true;
  }
}

export function matches(f: EventFacet, sel: FilterSelection): boolean {
  if (f.status !== "PUBLISHED" || f.cancelledAt) return false;
  if (!inDateRange(f.startsAt, sel.date)) return false;
  if (sel.price === "free" && f.priceCents) return false;
  if (sel.price === "paid" && !f.priceCents) return false;
  if (sel.mode === "online" && f.eventMode !== "ONLINE_EXTERNAL") return false;
  if (sel.mode === "inperson" && f.eventMode === "ONLINE_EXTERNAL") return false;
  if (sel.categories.length > 0 && (!f.categoryKey || !sel.categories.includes(f.categoryKey))) return false;
  return true;
}

export function matchesQuery(f: EventFacet, q: string): boolean {
  const needle = q.toLowerCase();
  return (
    f.title.toLowerCase().includes(needle) ||
    f.organizerName.toLowerCase().includes(needle) ||
    (f.locationName ?? "").toLowerCase().includes(needle) ||
    f.communityName.toLowerCase().includes(needle)
  );
}

export function activeFilterCount(sel: FilterSelection): number {
  return (
    (sel.date !== "any" ? 1 : 0) +
    (sel.price !== "any" ? 1 : 0) +
    (sel.mode !== "any" ? 1 : 0) +
    sel.categories.length
  );
}

export interface DiscoveryQuery {
  date?: string;
  price?: string;
  mode?: string;
  category?: string; // comma-separated categoryKeys
  sort?: string; // date | relevance
  q?: string;
  location?: string;
}

export function selectionFromQuery(query: DiscoveryQuery): FilterSelection {
  return {
    date: query.date ?? "any",
    price: query.price ?? "any",
    mode: query.mode ?? "any",
    categories: query.category ? query.category.split(",").filter(Boolean) : [],
  };
}

export function discoverEvents(query: DiscoveryQuery): EventView[] {
  const sel = selectionFromQuery(query);
  let items = EVENTS.filter((e) => matches(toFacet(e), sel));
  if (query.q) items = items.filter((e) => matchesQuery(toFacet(e), query.q!));
  if (query.sort === "relevance") {
    items = [...items].sort((a, b) => Number(b.promoted) - Number(a.promoted));
  }
  return items;
}
