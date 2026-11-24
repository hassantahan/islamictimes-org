import { getPreferences } from "./preferences.js";

export const PRAYERS = {
  fajr: "Fajr", zuhr: "Ẓuhr", asr: "ʿAṣr", maghrib: "Maghrib", isha: "ʿIshāʾ",
};

export async function apiResponse(url, payload, signal) {
  const response = await fetch(url, {
    credentials: "omit",
    signal,
    ...(payload && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  });
  if (response.ok) return response;
  const error = await response.json().catch(() => null);
  throw new Error(error?.error?.message ?? "The request failed. Please try again.");
}

export function localISO(date = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date);
  const field = (name) => parts.find((part) => part.type === name).value;
  return [field("year"), field("month"), field("day")].join("-");
}

export function civilDate(iso, options) {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
}

export function shiftDate(iso, amount) {
  const date = new Date(iso + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function formatTime(iso) {
  const match = typeof iso === "string" && iso.match(/T(\d{2}):(\d{2})/);
  if (!match) return "—";
  const [, hour, minute] = match;
  if (getPreferences().clock === "24") return hour + ":" + minute;
  const number = Number(hour);
  return (number % 12 || 12) + ":" + minute + (number < 12 ? " AM" : " PM");
}

export function applySelect(select, value) {
  if ([...select.options].some((option) => option.value === String(value))) select.value = String(value);
}
