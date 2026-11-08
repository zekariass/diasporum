import type { EventView } from "./types";

const TZ = "Europe/London";

/** Card date — Eventbrite style: "Sat, Nov 7 · 7:00 PM" */
export function cardDate(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: TZ }).format(d);
  const md = new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).format(d);
  return `${day}, ${md} · ${time}`;
}

/** Detail header date: "Saturday, 7 November" */
export function headerDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  }).format(new Date(iso));
}

/** Sidebar datetime: "Sat, 7 Nov, 7:00 – 11:30 PM" */
export function dateTimeRange(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: TZ,
  }).format(start);
  const startTime = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  }).format(start);
  if (!endIso) return `${date}, ${startTime}`;
  const end = new Date(endIso);
  const endTime = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  }).format(end);
  const sameDay =
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: TZ }).format(start) ===
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: TZ }).format(end);
  return sameDay ? `${date}, ${startTime} – ${endTime}` : `${date}, ${startTime} – ${dateTimeRange(endIso, null)}`;
}

/** "Free", "From £15.00" */
export function priceLabel(item: EventView): string {
  if (item.priceCents == null) return "Free";
  if (item.priceCents === 0) return "Free";
  return `From ${new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: item.currency,
  }).format(item.priceCents / 100)}`;
}

export function attendeesLabel(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k attendees`;
  return `${count} attendees`;
}

export function followersLabel(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k followers`;
  return `${count} followers`;
}
