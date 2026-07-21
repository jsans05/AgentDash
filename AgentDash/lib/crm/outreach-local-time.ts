/**
 * Recipient-local timing helpers for outreach events.
 * Snapshots are denormalized at insert so later timezone edits don't rewrite history.
 */

export type LocalTimeSnapshot = {
  recipient_timezone: string | null;
  recipient_local_hour: number | null;
  recipient_local_dow: number | null;
};

/** Compute local hour (0–23) and day-of-week (0=Sun … 6=Sat) in the given IANA timezone. */
export function computeLocalTimeSnapshot(
  occurredAt: Date | string,
  timezone: string | null | undefined
): LocalTimeSnapshot {
  const tz = timezone?.trim() || null;
  if (!tz) {
    return {
      recipient_timezone: null,
      recipient_local_hour: null,
      recipient_local_dow: null,
    };
  }
  const date = typeof occurredAt === "string" ? new Date(occurredAt) : occurredAt;
  if (Number.isNaN(date.getTime())) {
    return {
      recipient_timezone: tz,
      recipient_local_hour: null,
      recipient_local_dow: null,
    };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    }).formatToParts(date);

    const hourPart = parts.find((p) => p.type === "hour")?.value;
    const weekdayPart = parts.find((p) => p.type === "weekday")?.value;
    let hour = hourPart != null ? Number(hourPart) : null;
    // Some engines return "24" for midnight
    if (hour === 24) hour = 0;

    const dowMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const dow = weekdayPart != null ? (dowMap[weekdayPart] ?? null) : null;

    return {
      recipient_timezone: tz,
      recipient_local_hour: hour != null && !Number.isNaN(hour) ? hour : null,
      recipient_local_dow: dow,
    };
  } catch {
    return {
      recipient_timezone: tz,
      recipient_local_hour: null,
      recipient_local_dow: null,
    };
  }
}

/** Common IANA zones for the timezone picker. */
export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Toronto", label: "Eastern (Toronto)" },
  { value: "America/Sao_Paulo", label: "Brasilia" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris / CET" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Australia/Melbourne", label: "Melbourne" },
  { value: "Australia/Perth", label: "Perth" },
  { value: "Pacific/Auckland", label: "Auckland" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "UTC", label: "UTC" },
];

/**
 * Best-effort timezone guess from a company website hostname / TLD.
 * Returns null when uncertain.
 */
export function guessTimezoneFromWebsite(website: string | null | undefined): string | null {
  if (!website?.trim()) return null;
  let host = website.trim().toLowerCase();
  try {
    if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
    host = new URL(host).hostname;
  } catch {
    // keep raw
  }
  if (host.endsWith(".au") || host.includes(".com.au")) return "Australia/Sydney";
  if (host.endsWith(".uk") || host.endsWith(".co.uk")) return "Europe/London";
  if (host.endsWith(".nz")) return "Pacific/Auckland";
  if (host.endsWith(".de") || host.endsWith(".at") || host.endsWith(".ch")) return "Europe/Berlin";
  if (host.endsWith(".fr") || host.endsWith(".be")) return "Europe/Paris";
  if (host.endsWith(".br")) return "America/Sao_Paulo";
  if (host.endsWith(".jp")) return "Asia/Tokyo";
  if (host.endsWith(".sg")) return "Asia/Singapore";
  if (host.endsWith(".ca")) return "America/Toronto";
  return null;
}

export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
