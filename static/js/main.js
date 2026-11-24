import { exampleLocation, rememberCity, setMapLink, setupLocation } from "./shared/location.js";
import { getPreferences, updatePreferences } from "./shared/preferences.js";
import { apiResponse, applySelect, civilDate, formatTime, localISO, PRAYERS, setupCustomAngles, shiftDate } from "./shared/timetable.js";

const byId = (id) => document.getElementById(id);
const locationControls = byId("daily-location");
const locationDialog = byId("location-dialog");
const locationFields = setupLocation(locationControls);
const city = locationControls.querySelector("[data-city]");
const calculation = byId("daily-calculation");
const date = byId("daily-date");
const dateButton = byId("open-date-picker");
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
let selectedDate;
let saveSelections = false;
let locationTimer;
let calculationTimer;
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
let displayedSettings = appliedSettings;

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

  if (isToday && !next && !tomorrow && !tomorrowPending &&
      displayedLocation === location && displayedSettings === appliedSettings) {
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
  for (const key of ["zuhr", "asr"]) {
    const time = windows?.[key];
    const windowLabel = byId("fadilah-" + key);
    windowLabel.hidden = !time;
    if (!time) {
      byId("fadilah-note-" + key).hidePopover?.();
      continue;
    }

    const start = formatTime(time.start);
    const end = formatTime(time.end);
    const suffix = end.match(/ (AM|PM)$/)?.[0];
    const shortStart = suffix && start.endsWith(suffix) ? start.slice(0, -suffix.length) : start;
    windowLabel.querySelector("[data-fadilah-range]").textContent = shortStart + "–" + end;
    windowLabel.querySelector("[data-fadilah-preferred]").textContent = formatTime(time.preferred_by);
  }
}

function renderMap() {
  const lat = Number(displayedLocation.lat.toFixed(2));
  const outOfBounds = Math.abs(lat) > 85;
  byId("map-notice").textContent = outOfBounds ? "Map unavailable at this latitude." : "Approximate · OpenStreetMap";
  if (!map.open || !result || outOfBounds) {
    if (mapFrame.hasAttribute("src")) mapFrame.removeAttribute("src");
    mapFrame.hidden = true;
    mapLink.hidden = true;
    return;
  }

  const lon = Number(displayedLocation.lon.toFixed(2));
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
  date.value = selectedDate ?? result.date;
  const gregorian = byId("hero-date");
  gregorian.dateTime = result.date;
  gregorian.textContent = civilDate(result.date, { weekday: "long" }) + ", " +
    civilDate(result.date, { month: "long", day: "numeric", year: "numeric" });
  byId("daily-heading-location").textContent = displayedLocation.label;
  byId("example-location").hidden = !displayedLocation.example;
  const hijri = result.hijri;
  byId("daily-hijri").textContent = hijri.day + " " + hijri.month_name + " " + hijri.year + " AH";
  for (const key of Object.keys({ ...PRAYERS, ...solarLabels })) {
    const time = result[key]?.time;
    const nextDay = formatTime(time) !== "—" && time.slice(0, 10) > result.date;
    byId("time-" + key).textContent = formatTime(time) + (nextDay ? " (+1d)" : "");
  }
  byId("daily-warning").hidden = !result.warnings.length;
  byId("qibla-angle").textContent = result.qibla.angle_decimal.toFixed(1) + "° " + result.qibla.cardinal;
  byId("qibla-distance").textContent = Math.round(result.qibla.distance_km).toLocaleString() + " km";
  byId("qibla-needle").style.setProperty("--bearing", result.qibla.angle_decimal + "deg");
  renderFadilah(result.fadilah);
  renderMap();
  renderHero();
}

async function refresh() {
  activeRequest?.abort();
  const request = new AbortController();
  activeRequest = request;
  timeline.setAttribute("aria-busy", "true");
  status.textContent = "Updating…";
  try {
    const data = await getDaily(selectedDate, request.signal);
    if (request.signal.aborted) return;
    tomorrow = null;
    tomorrowPending = false;
    result = data;
    if (displayedLocation.lat !== location.lat || displayedLocation.lon !== location.lon) map.open = false;
    displayedLocation = location;
    displayedSettings = appliedSettings;
    if (saveSelections) {
      saveSelections = false;
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

function updateLocation() {
  const errorStatus = byId("location-error");
  try {
    const newLocation = city.value ? locationFields.read() : exampleLocation();
    errorStatus.textContent = "";
    const unchanged = newLocation.lat === location.lat && newLocation.lon === location.lon && newLocation.label === location.label;
    if (unchanged && (location === displayedLocation || timeline.getAttribute("aria-busy") === "true")) {
      return;
    }
    location = newLocation;
    saveSelections = true;
    refresh();
  } catch {
    errorStatus.textContent = "Enter valid coordinates.";
  }
}

function updateCalculation() {
  const errorStatus = byId("calculation-error");
  try {
    const settings = readSettings();
    errorStatus.textContent = "";
    const unchanged = JSON.stringify(settings) === JSON.stringify(appliedSettings);
    if (unchanged && (appliedSettings === displayedSettings || timeline.getAttribute("aria-busy") === "true")) return;
    appliedSettings = settings;
    saveSelections = true;
    refresh();
  } catch (error) {
    errorStatus.textContent = error.message;
  }
}

if (typeof date.showPicker === "function") {
  date.classList.add("date-picker-anchor");
  date.tabIndex = -1;
  dateButton.hidden = false;
  dateButton.addEventListener("click", () => {
    try {
      date.showPicker();
    } catch {
      date.classList.remove("date-picker-anchor");
      date.removeAttribute("tabindex");
      dateButton.hidden = true;
      date.focus();
    }
  });
}
date.addEventListener("change", () => {
  if (!date.reportValidity()) return;
  const today = result && localISO(new Date(), result.timezone);
  selectedDate = date.value === today ? undefined : date.value;
  refresh();
});

for (const button of timeline.querySelectorAll("[popovertarget]")) {
  const tile = byId(button.getAttribute("popovertarget"));
  tile.addEventListener("beforetoggle", (event) => {
    if (event.newState !== "open") return;
    const rect = button.closest(".fadilah-window").getBoundingClientRect();
    const tileWidth = Math.min(224, innerWidth - 24);
    tile.style.left = Math.max(12, rect.right - tileWidth) + "px";
    const below = innerHeight - rect.bottom;
    tile.style.insetBlock = below >= 145 || below >= rect.top
      ? (rect.bottom + 8) + "px auto"
      : "auto " + (innerHeight - rect.top + 8) + "px";
  });
}

map.addEventListener("toggle", renderMap);
byId("open-location").addEventListener("click", () => locationDialog.showModal());
locationControls.addEventListener("locationchange", () => {
  clearTimeout(locationTimer);
  if (city.value === "custom") {
    locationTimer = setTimeout(updateLocation, 300);
  } else {
    updateLocation();
  }
});
calculation.addEventListener("input", (event) => {
  if (!event.target.matches("[data-prayer-angle]")) return;
  clearTimeout(calculationTimer);
  calculationTimer = setTimeout(updateCalculation, 300);
});
calculation.addEventListener("change", () => {
  clearTimeout(calculationTimer);
  updateCalculation();
});
document.addEventListener("preferenceschange", ({ detail }) => {
  if (detail.keys.includes("clock")) renderDaily();
});
setInterval(() => {
  const isStale = result && result.date !== localISO(new Date(), result.timezone);
  if (!selectedDate && isStale && timeline.getAttribute("aria-busy") === "false") refresh();
  else renderHero();
}, 30000);
refresh();
