import { exampleLocation, rememberCity, setMapLink, setupLocation } from "./shared/location.js";
import { getPreferences, updatePreferences } from "./shared/preferences.js";
import { apiResponse, applySelect, civilDate, formatTime, localISO, PRAYERS, setupCustomAngles, shiftDate } from "./shared/timetable.js";

const byId = (id) => document.getElementById(id);
const form = byId("daily-location");
const locationFields = setupLocation(form);
const date = byId("daily-date");
const method = byId("daily-method");
const asr = byId("daily-asr");
const midnight = byId("daily-midnight");
const angles = setupCustomAngles(method, byId("custom-angles"));
const status = byId("daily-status");
const timeline = byId("daily-timeline");
const prayerRows = [...timeline.querySelectorAll("[data-prayer-row]")];
const solarLabels = { sunrise: "Sunrise", sunset: "Sunset", midnight: "Midnight" };
const map = byId("daily-map");
const mapFrame = byId("daily-map-frame");
const mapLink = byId("daily-map-link");

let location;
try { location = locationFields.read(); } catch { location = exampleLocation(); }
let result;
let displayedLocation = location;
let followToday = true;
let tomorrow;
let tomorrowPending = false;
let activeRequest;


function applySettings(settings) {
  applySelect(method, settings?.name || method.options[0].value);
  applySelect(asr, settings?.asr_type ?? 0);
  applySelect(midnight, settings?.midnight_type === "preset" ? "" : settings?.midnight_type ?? "");
  angles.apply(settings);
}

function readSettings() {
  const settings = {
    name: method.value,
    asr_type: Number(asr.value),
    midnight_type: midnight.value === "" ? "preset" : Number(midnight.value),
  };
  return { ...settings, ...angles.read() };
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

function renderFadilah(windows) {
  byId("fadilah-source").hidden = !windows;
  byId("fadilah-unavailable").hidden = !windows || Object.keys(windows).length > 0;
  for (const key of ["zuhr", "asr"]) {
    const time = windows?.[key];
    const windowLabel = byId("fadilah-" + key);
    const preferred = byId("preferred-" + key);
    windowLabel.hidden = !time;
    preferred.hidden = !time;
    if (!time) continue;

    const start = formatTime(time.start);
    const end = formatTime(time.end);
    const suffix = end.match(/ (AM|PM)$/)?.[0];
    const shortStart = suffix && start.endsWith(suffix) ? start.slice(0, -suffix.length) : start;
    windowLabel.querySelector("[data-fadilah-range]").textContent = shortStart + "–" + end;
    preferred.querySelector("dd").textContent = formatTime(time.preferred_by);
  }
}

function renderMap() {
  if (!map.open || !result) {
    if (mapFrame.hasAttribute("src")) mapFrame.removeAttribute("src");
    mapFrame.hidden = true;
    mapLink.hidden = true;
    return;
  }

  const lat = Number(displayedLocation.lat.toFixed(2));
  const lon = Number(displayedLocation.lon.toFixed(2));
  if (Math.abs(lat) > 85) {
    byId("map-notice").textContent = "Map unavailable at this latitude.";
    return;
  }
  byId("map-notice").textContent = "Shows the approximate location.";
  const bbox = [
    Math.max(-180, lon - 0.05), Math.max(-85, lat - 0.03),
    Math.min(180, lon + 0.05), Math.min(85, lat + 0.03),
  ];
  const url = new URL("https://www.openstreetmap.org/export/embed.html");
  url.search = new URLSearchParams({
    bbox: bbox.map((coordinate) => coordinate.toFixed(2)).join(","),
    layer: "mapnik",
    marker: lat + "," + lon,
  }).toString();
  mapFrame.hidden = false;
  if (mapFrame.src !== url.href) {
    // The embed fits its map to the frame dimensions during initialization.
    mapFrame.getBoundingClientRect();
    mapFrame.src = url.href;
  }
  setMapLink(mapLink, { lat, lon });
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
  const methodOption = [...method.options].find((option) => option.value === appliedSettings.name);
  byId("current-calculation-method").textContent = methodOption?.textContent ?? result.method.name;
  renderFadilah(result.fadilah);
  renderMap();
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
    if (displayedLocation.lat !== location.lat || displayedLocation.lon !== location.lon) map.open = false;
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

date.addEventListener("change", () => {
  if (!date.reportValidity()) return;
  followToday = result ? date.value === localISO(new Date(), result.timezone) : false;
  refresh(date.value);
});
map.addEventListener("toggle", renderMap);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const newLocation = form.querySelector("[data-city]").value ? locationFields.read() : exampleLocation();
    const settings = readSettings();
    location = newLocation;
    appliedSettings = settings;
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
