/**
 * Add-to-calendar for events — expo-calendar (next-gen API, SDK 58).
 * The event's own IANA timezone travels with the calendar entry so wall-clock
 * times stay correct regardless of the device timezone. Write-only permission
 * is sufficient (no calendar read access is requested on iOS).
 *
 * The module is required lazily: it contains native code, so dev-client
 * binaries built before the dependency was added (or Expo Go) lack it —
 * the caller degrades to "unavailable" instead of crashing the screen.
 */

import { Platform } from "react-native";

export type CalendarResult = "added" | "denied" | "unavailable";

type CalendarModule = typeof import("expo-calendar");

async function writableCalendar(
  Calendar: CalendarModule,
): Promise<InstanceType<CalendarModule["ExpoCalendar"]> | null> {
  if (Platform.OS === "ios") {
    try {
      return Calendar.getDefaultCalendarSync();
    } catch {
      return null;
    }
  }
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  return (
    calendars.find((c) => c.isPrimary && c.allowsModifications) ??
    calendars.find((c) => c.allowsModifications) ??
    null
  );
}

export async function addEventToCalendar(input: {
  title: string;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  location: string | null;
  url: string | null;
  description: string;
}): Promise<CalendarResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: optional native module
    const Calendar = require("expo-calendar") as CalendarModule;
    const permission = await Calendar.requestCalendarPermissions(true);
    if (!permission.granted) return "denied";
    const calendar = await writableCalendar(Calendar);
    if (!calendar) return "unavailable";
    await calendar.createEvent({
      title: input.title,
      startDate: new Date(input.startsAt),
      endDate: input.endsAt
        ? new Date(input.endsAt)
        : new Date(new Date(input.startsAt).getTime() + 60 * 60 * 1000),
      timeZone: input.timezone,
      location: input.location ?? undefined,
      url: input.url ?? undefined,
      notes: input.description,
    });
    return "added";
  } catch {
    return "unavailable";
  }
}
