/**
 * Event date/time utility tests — DST-safe wall-clock → UTC conversion,
 * display formatting in the event's timezone and validation helpers.
 */

import {
  countsSummary,
  eventDayBadge,
  formatEventDate,
  isValidDate,
  isValidTime,
  isValidTimezone,
  toDateInput,
  toTimeInput,
  zonedToUtc,
} from "@/features/events/utils/event-time";

describe("zonedToUtc", () => {
  it("converts Berlin wall-clock time during CET (winter)", () => {
    const utc = zonedToUtc("2026-11-20", "18:30", "Europe/Berlin");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-11-20T17:30:00.000Z");
  });

  it("converts Berlin wall-clock time during CEST (summer, DST)", () => {
    const utc = zonedToUtc("2026-07-20", "18:30", "Europe/Berlin");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-07-20T16:30:00.000Z");
  });

  it("treats UTC as a no-op", () => {
    const utc = zonedToUtc("2026-11-20", "09:00", "UTC");
    expect(utc!.toISOString()).toBe("2026-11-20T09:00:00.000Z");
  });

  it("falls back to UTC for an unsupported timezone instead of failing", () => {
    const utc = zonedToUtc("2026-11-20", "09:00", "Mars/Olympus");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-11-20T09:00:00.000Z");
  });

  it("returns null for invalid date or time input", () => {
    expect(zonedToUtc("2026-13-01", "10:00", "UTC")).toBeNull();
    expect(zonedToUtc("not-a-date", "10:00", "UTC")).toBeNull();
    expect(zonedToUtc("2026-11-20", "25:00", "UTC")).toBeNull();
    expect(zonedToUtc("2026-11-20", "9:00", "UTC")).toBeNull();
  });

  it("round-trips through formatEventDate in the original timezone", () => {
    const utc = zonedToUtc("2026-11-20", "18:30", "Europe/Berlin");
    expect(formatEventDate(utc!.toISOString(), "Europe/Berlin")).toBe(
      "Fri, Nov 20 · 18:30",
    );
  });
});

describe("formatEventDate", () => {
  it("formats an instant in the event's own timezone", () => {
    expect(formatEventDate("2026-11-20T17:30:00Z", "Europe/Berlin")).toBe(
      "Fri, Nov 20 · 18:30",
    );
  });

  it("shifts the day correctly for zones behind UTC", () => {
    expect(formatEventDate("2026-11-20T17:30:00Z", "America/New_York")).toBe(
      "Fri, Nov 20 · 12:30",
    );
  });

  it("returns an empty string for invalid instants", () => {
    expect(formatEventDate("not-an-instant", "UTC")).toBe("");
  });
});

describe("eventDayBadge", () => {
  it("extracts day and month for compact badges", () => {
    expect(eventDayBadge("2026-11-20T17:30:00Z", "Europe/Berlin")).toEqual({
      day: "20",
      month: "NOV",
    });
  });

  it("renders a placeholder for invalid instants", () => {
    expect(eventDayBadge("nope", "UTC")).toEqual({ day: "--", month: "—" });
  });
});

describe("input formatting", () => {
  it("extracts date and time parts in the event timezone", () => {
    const instant = "2026-11-20T17:30:00Z";
    expect(toDateInput(instant, "Europe/Berlin")).toBe("2026-11-20");
    expect(toTimeInput(instant, "Europe/Berlin")).toBe("18:30");
  });

  it("round-trips a zoned instant back to the original wall-clock input", () => {
    const utc = zonedToUtc("2026-07-20", "08:15", "America/New_York");
    expect(toDateInput(utc!.toISOString(), "America/New_York")).toBe(
      "2026-07-20",
    );
    expect(toTimeInput(utc!.toISOString(), "America/New_York")).toBe("08:15");
  });
});

describe("countsSummary", () => {
  it("joins going and interested counts", () => {
    expect(countsSummary(3, 5, 0)).toBe("3 going · 5 interested");
  });

  it("includes the waitlist only when populated", () => {
    expect(countsSummary(2, 1, 4)).toBe("2 going · 1 interested · 4 waitlisted");
  });
});

describe("validation helpers", () => {
  it("accepts well-formed dates and rejects malformed ones", () => {
    expect(isValidDate("2026-11-20")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-11-2")).toBe(false);
    expect(isValidDate("20261120")).toBe(false);
  });

  it("accepts well-formed times and rejects out-of-range values", () => {
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("12:60")).toBe(false);
    expect(isValidTime("9:30")).toBe(false);
  });

  it("validates IANA timezone names", () => {
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("Not/A_Zone")).toBe(false);
  });
});
