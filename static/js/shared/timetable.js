import { getPreferences } from "./preferences.js";

export const PRAYERS = {
  fajr: "Fajr", zuhr: "Ẓuhr", asr: "ʿAṣr", maghrib: "Maghrib", isha: "ʿIshāʾ",
};
export const SHIA_PRESETS = new Set(["JAFARI", "TEHRAN", "CUSTOM"]);

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

export function formatRange({ start, end }) {
  const first = formatTime(start);
  const last = formatTime(end);
  const suffix = last.match(/ (AM|PM)$/)?.[0];
  return (suffix && first.endsWith(suffix) ? first.slice(0, -suffix.length) : first) + "–" + last;
}

export function setupTimetableNote(button, note, { center = false, keepClear } = {}) {
  let hideTimer;
  let pinned = false;
  const isOpen = () => note.matches(":popover-open");
  const keepOpen = () => clearTimeout(hideTimer);
  const show = () => {
    keepOpen();
    if (!isOpen()) note.showPopover({ source: button });
  };
  const hideOnLeave = () => {
    keepOpen();
    if (!pinned && !button.matches(":focus-visible")) hideTimer = setTimeout(() => note.hidePopover(), 200);
  };
  button.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") show();
  });
  button.addEventListener("pointerleave", hideOnLeave);
  button.addEventListener("focus", () => {
    if (button.matches(":focus-visible")) show();
  });
  button.addEventListener("blur", hideOnLeave);
  note.addEventListener("pointerenter", keepOpen);
  note.addEventListener("pointerleave", hideOnLeave);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    pinned = !pinned;
    if (pinned) show();
    else note.hidePopover();
  });
  note.addEventListener("toggle", () => {
    button.setAttribute("aria-expanded", String(isOpen()));
    if (!isOpen()) pinned = false;
  });
  note.addEventListener("beforetoggle", (event) => {
    if (event.newState !== "open") return;
    const rect = button.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const edge = .75 * rem;
    const width = Math.min(note.classList.contains("gauge-note") ? 14 * rem : 17.5 * rem, innerWidth - 2 * edge);
    const left = center ? (rect.left + rect.right - width) / 2 : rect.right - width;
    note.style.left = Math.max(edge, Math.min(left, innerWidth - width - edge)) + "px";
    const clear = keepClear && !keepClear.hidden ? keepClear.getBoundingClientRect() : rect;
    const top = Math.min(rect.top, clear.top);
    const bottom = Math.max(rect.bottom, clear.bottom);
    const below = innerHeight - bottom;
    const placeBelow = below >= 12 * rem || below >= top;
    note.style.maxHeight = Math.max(0, (placeBelow ? below : top) - 8 - edge) + "px";
    note.style.insetBlock = placeBelow
      ? (bottom + 8) + "px auto"
      : "auto " + (innerHeight - top + 8) + "px";
  });
}

export function nextDayMarker() {
  const marker = document.createElement("sup");
  marker.className = "next-day";
  marker.textContent = "+1";
  marker.title = "Next day";
  return marker;
}

export function setupCustomAngles(method, group) {
  const inputs = [...group.querySelectorAll("[data-prayer-angle]")];

  const sync = () => {
    const custom = method.value === "CUSTOM";
    group.hidden = !custom;
    for (const input of inputs) input.disabled = !custom;
  };

  method.addEventListener("change", () => {
    sync();
    if (!group.hidden) group.closest("details")?.setAttribute("open", "");
  });
  return {
    apply(settings) {
      for (const input of inputs) {
        const value = settings?.[input.dataset.prayerAngle];
        input.value = Number.isFinite(value) && value > 0 && value <= 90 ? value : "";
      }
      sync();
    },
    read() {
      const angles = {};
      for (const input of inputs) {
        if (input.disabled) continue;
        if (!input.reportValidity() || input.valueAsNumber <= 0) {
          throw new Error("Angles must be greater than 0° and at most 90°.");
        }
        if (input.value !== "") angles[input.dataset.prayerAngle] = input.valueAsNumber;
      }
      return angles;
    },
  };
}

export function applySelect(select, value) {
  if ([...select.options].some((option) => option.value === String(value))) select.value = String(value);
}
