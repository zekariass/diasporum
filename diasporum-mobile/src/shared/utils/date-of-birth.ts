/**
 * Shared date-of-birth helpers — one source for picker bounds, ISO
 * conversion and display formatting so profile and matchmaking screens
 * cannot drift apart.
 *
 * DOB is one-time and immutable once stored (enforced server-side via
 * the atomic `date_of_birth IS NULL` update + 409 conflict).
 */

/** Picker bounds. */
export const MIN_DOB = new Date(1900, 0, 1);
/** Latest birth year a picker may offer — current year minus the 18+ requirement. */
export const MAX_DOB_YEAR = new Date().getFullYear() - 18;

/** Local-calendar ISO date — avoids the UTC offset day-shift of toISOString. */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    + `-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDob(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
