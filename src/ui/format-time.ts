import { config } from "../config.js";

/** Format stored UTC / ISO timestamps for dashboard display. */
export function formatDisplayTime(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  const raw = String(value).trim();
  const normalized =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) && !raw.includes("T")
      ? `${raw.replace(" ", "T")}Z`
      : raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: config.dashboard.displayTimezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return raw;
  }
}

export function formatRowTimes<T extends Record<string, unknown>>(
  rows: T[],
  fields: (keyof T)[]
): T[] {
  return rows.map((row) => {
    const out = { ...row };
    for (const field of fields) {
      const v = out[field];
      if (typeof v === "string") {
        (out as Record<string, unknown>)[field as string] = formatDisplayTime(v);
      }
    }
    return out;
  });
}
