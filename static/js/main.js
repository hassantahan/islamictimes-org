import { exampleLocation, rememberCity, setMapLink, setupLocation } from "./shared/location.js";
import { getPreferences, updatePreferences } from "./shared/preferences.js";
import { apiResponse, applySelect, civilDate, formatTime, localISO, PRAYERS, shiftDate } from "./shared/timetable.js";

const byId = (id) => document.getElementById(id);
const form = byId("daily-location");
const locationFields = setupLocation(form);
const date = byId("daily-date");
const method = byId("daily-method");
const asr = byId("daily-asr");
const midnight = byId("daily-midnight");
const angleInputs = {
  fajr_angle: byId("fajr-angle"), maghrib_angle: byId("maghrib-angle"), isha_angle: byId("isha-angle"),
};
const status = byId("daily-status");
const timeline = byId("daily-timeline");
const prayerRows = [...timeline.querySelectorAll("[data-prayer-row]")];
const solarLabels = { sunrise: "Sunrise", sunset: "Sunset", midnight: "Midnight" };

let location;
try { location = locationFields.read(); } catch { location = exampleLocation(); }
let result;
let displayedLocation = location;
let followToday = true;
let tomorrow;
let tomorrowPending = false;
let activeRequest;

function syncAngles() {
  const custom = method.value === "CUSTOM";
  byId("custom-angles").hidden = !custom;
  Object.values(angleInputs).forEach((input) => { input.disabled = !custom; });
}

function applySettings(settings) {
  applySelect(method, settings?.name || "ISNA");
  applySelect(asr, settings?.asr_type ?? 0);
  applySelect(midnight, settings?.midnight_type === "preset" ? "" : settings?.midnight_type ?? "");
  for (const [name, input] of Object.entries(angleInputs)) {
    const value = settings?.[name];
    input.value = Number.isFinite(value) ? value : "";
  }
  syncAngles();
}

function readSettings() {
  const settings = {
    name: method.value,
    asr_type: Number(asr.value),
    midnight_type: midnight.value === "" ? "preset" : Number(midnight.value),
  };
  if (settings.name === "CUSTOM") {
    const defaults = { fajr_angle: 15, maghrib_angle: 0, isha_angle: 15 };
    for (const [name, input] of Object.entries(angleInputs)) {
      settings[name] = input.value ? input.valueAsNumber : defaults[name];
    }
  }
  return settings;
}

let appliedSettings = getPreferences().daily;
applySettings(appliedSettings);
appliedSettings = readSettings();

function getDaily(forDate, signal) {
  return apiResponse("/prayer_times", {
    lat: location.lat, lon: location.lon, date: forDate, method: appliedSettings,
  }, signal).then((response) => response.json());
}

function candidates(day) {
  return Object.entries(PRAYERS)
    .map(([key, label]) => ({ key, label, time: day?.[key]?.time, when: Date.parse(day?.[key]?.time) }))
    .filter(({ when }) => Number.isFinite(when))
    .sort((left, right) => left.when - right.when);
}

function renderHero() {
  if (!result) return;
  const today = localISO(new Date(), result.timezone);
  const isToday = result.date === today;
  const now = Date.now();
  const prayers = candidates(result);
  const next = isToday ? prayers.find(({ when }) => when >= now) : prayers[0];
  const following = isToday && !next ? candidates(tomorrow).find(({ when }) => when >= now) : null;

  byId("hero-label").textContent = isToday ? "Next prayer" : "First prayer";
  byId("hero-prayer").textContent = (next || following)?.label ?? "—";
  byId("hero-time").textContent = formatTime((next || following)?.time);
  byId("hero-day").hidden = !following;
  for (const row of prayerRows) row.classList.toggle("next-row", isToday && row.dataset.prayerRow === next?.key);

  if (isToday && !next && !tomorrow && !tomorrowPending && displayedLocation === location) {
    const shown = result;
    tomorrowPending = true;
    getDaily(shiftDate(today, 1), activeRequest.signal).then((data) => {
      if (shown !== result) return;
      tomorrow = data;
      renderHero();
    }).catch(() => {}).finally(() => {
      if (shown === result) tomorrowPending = false;
    });
  }
}

function renderDaily() {
  if (!result) return;
  date.value = result.date;
  byId("hero-date").textContent = civilDate(result.date, { weekday: "long", month: "long", day: "numeric" });
  byId("daily-heading-location").textContent = displayedLocation.label;
  const hijri = result.hijri;
  byId("daily-hijri").textContent = hijri.day + " " + hijri.month_name + " " + hijri.year + " AH · Calculated";
  for (const key of Object.keys({ ...PRAYERS, ...solarLabels })) {
    const time = result[key]?.time;
    const nextDay = formatTime(time) !== "—" && time.slice(0, 10) > result.date;
    byId("time-" + key).textContent = formatTime(time) + (nextDay ? " (+1d)" : "");
  }
  byId("daily-warning").hidden = !result.warnings.length;
  byId("qibla-angle").textContent = result.qibla.angle_decimal.toFixed(1) + "° " + result.qibla.cardinal;
  byId("qibla-distance").textContent = Math.round(result.qibla.distance_km).toLocaleString() + " km to the Kaaba";
  byId("qibla-needle").style.setProperty("--bearing", result.qibla.angle_decimal + "deg");
  setMapLink(byId("daily-map-link"), displayedLocation);
  renderHero();
}

async function refresh(forDate, save = false) {
  activeRequest?.abort();
  const request = new AbortController();
  activeRequest = request;
  timeline.setAttribute("aria-busy", "true");
  status.textContent = "Calculating prayer times…";
  try {
    const data = await getDaily(forDate, request.signal);
    if (request.signal.aborted) return;
    tomorrow = null;
    tomorrowPending = false;
    result = data;
    displayedLocation = location;
    if (save) {
      rememberCity(location);
      updatePreferences({ daily: appliedSettings });
    }
    renderDaily();
    status.textContent = "";
  } catch (error) {
    if (!request.signal.aborted) status.textContent = error.message;
  } finally {
    if (!request.signal.aborted) timeline.setAttribute("aria-busy", "false");
  }
}

method.addEventListener("change", syncAngles);
date.addEventListener("change", () => {
  if (!date.reportValidity()) return;
  followToday = result ? date.value === localISO(new Date(), result.timezone) : false;
  refresh(date.value);
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const newLocation = locationFields.read();
    location = newLocation;
    appliedSettings = readSettings();
    refresh(followToday ? undefined : date.value, true);
  } catch (error) {
    status.textContent = error.message;
  }
});
document.addEventListener("preferenceschange", ({ detail }) => {
  if (detail.keys.includes("clock")) renderDaily();
});
setInterval(() => {
  const isStale = result && result.date !== localISO(new Date(), result.timezone);
  if (followToday && isStale && timeline.getAttribute("aria-busy") === "false") refresh();
  else renderHero();
}, 30000);
refresh();
