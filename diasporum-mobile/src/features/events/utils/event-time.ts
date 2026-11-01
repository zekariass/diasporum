/**
 * Event date/time helpers — wall-clock entry in the event's timezone converted
 * to a UTC instant for the API, and display formatting in the event's timezone.
 * Uses Intl (Hermes supports it in the Expo runtime); falls back to UTC.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, mo, d] = s.split('-').map(Number);
  const asUtc = new Date(`${s}T00:00:00Z`);
  // Reject calendar overflow (e.g. 2026-02-30) that Date.UTC would roll over.
  return (
    !Number.isNaN(asUtc.getTime()) &&
    asUtc.getUTCFullYear() === y &&
    asUtc.getUTCMonth() === mo - 1 &&
    asUtc.getUTCDate() === d
  );
}

export function isValidTime(s: string): boolean {
  if (!TIME_RE.test(s)) return false;
  const [h, m] = s.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Device timezone when available (IANA name), otherwise UTC. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function isSupportedZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidTimezone(tz: string): boolean {
  return tz.length > 0 && isSupportedZone(tz);
}

/** Offset (ms) of `timeZone` at instant `at` — positive when ahead of UTC. */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) =>
    Number(parts.find(p => p.type === type)?.value ?? '0');
  const hour = get('hour') === 24 ? 0 : get('hour'); // some ICU versions use 24:00
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'),
  );
  return asUtc - at.getTime();
}

/**
 * Converts a wall-clock date + time in `timeZone` to a UTC Date.
 * Handles DST transitions by iterating the offset twice.
 */
export function zonedToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date | null {
  if (!isValidDate(dateStr) || !isValidTime(timeStr)) return null;
  const tz = isSupportedZone(timeZone) ? timeZone : 'UTC';
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset1 = zoneOffsetMs(tz, new Date(guess));
  const offset2 = zoneOffsetMs(tz, new Date(guess - offset1));
  return new Date(guess - offset2);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface ZonedParts {
  year: number; month: number; day: number;
  hour: number; minute: number; weekday: number;
}

function partsInZone(instant: string, timeZone: string): ZonedParts | null {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return null;
  const tz = isSupportedZone(timeZone) ? timeZone : 'UTC';
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = dtf.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(p => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? 0 : Number(get('hour'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    weekday: Math.max(0, WEEKDAYS.indexOf(get('weekday'))),
  };
}

/** "Sat, Nov 7 · 18:30" in the event's own timezone. */
export function formatEventDate(instant: string, timeZone: string): string {
  const p = partsInZone(instant, timeZone);
  if (!p) return '';
  return `${WEEKDAYS[p.weekday]}, ${MONTHS[p.month - 1]} ${p.day} · ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Day-of-month + short month for compact card badges. */
export function eventDayBadge(instant: string, timeZone: string): { day: string; month: string } {
  const p = partsInZone(instant, timeZone);
  if (!p) return { day: '--', month: '—' };
  return { day: String(p.day), month: MONTHS[p.month - 1].toUpperCase() };
}

/** Date-only part of a wall-clock string (YYYY-MM-DD). */
export function toDateInput(instant: string, timeZone: string): string {
  const p = partsInZone(instant, timeZone);
  if (!p) return '';
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Time-only part of a wall-clock string (HH:MM). */
export function toTimeInput(instant: string, timeZone: string): string {
  const p = partsInZone(instant, timeZone);
  if (!p) return '';
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "3 going · 5 interested · 1 waitlisted" style summary. */
export function countsSummary(going: number, interested: number, waitlisted: number): string {
  const parts = [`${going} going`, `${interested} interested`];
  if (waitlisted > 0) parts.push(`${waitlisted} waitlisted`);
  return parts.join(' · ');
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
