import { rememberCity, setMapLink, setupLocation } from "./shared/location.js";
import { setupDatePicker } from "./shared/date-picker.js";
import { getPreferences, updatePreferences } from "./shared/preferences.js";
import { apiResponse, applySelect, civilDate, formatTime, localISO, PRAYERS, setupCustomAngles, SHIA_PRESETS, shiftDate } from "./shared/timetable.js";

const byId = (id) => document.getElementById(id);
const locationControls = byId("daily-location");
const locationDialog = byId("location-dialog");
const locationFields = setupLocation(locationControls, "toronto");
const calculation = byId("daily-calculation");
const dateButton = byId("open-date-picker");
const method = byId("daily-method");
const asr = byId("daily-asr");
const midnight = byId("daily-midnight");
const angles = setupCustomAngles(method, byId("custom-angles"));
const status = byId("daily-status");
const timeline = byId("daily-timeline");
const prayerRows = [...timeline.querySelectorAll("[data-prayer-row]")];
const solarLabels = { sunrise: "Sunrise", sunset: "Sunset", midnight: "Midnight" };
const mapFrame = byId("daily-map-frame");
const mapLink = byId("daily-map-link");
const fadilahMethodology = byId("fadilah-methodology");
const prayerCutoffs = { fajr: "sunrise", zuhr: "sunset", asr: "sunset", maghrib: "midnight", isha: "midnight" };

let location = locationFields.read();
let result;
let displayedLocation = location;
let selectedDate;
let saveSelections = false;
let locationTimer;
let calculationTimer;
const adjacentDays = new Map();
let activeRequest;

function applySettings(settings) {
  applySelect(method, settings?.name || method.options[0].value);
  applySelect(asr, settings?.asr_type ?? 0);
  applySelect(midnight, settings?.midnight_type === "preset" ? "" : settings?.midnight_type ?? "");
  angles.apply(settings);
}

function readSettings() {
  const shiaPreset = SHIA_PRESETS.has(method.value);
  byId("daily-asr-option").hidden = shiaPreset;
  const settings = {
    name: method.value,
    asr_type: shiaPreset ? undefined : Number(asr.value),
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

function loadAdjacentDay(date) {
  if (adjacentDays.has(date) || displayedLocation !== location || displayedSettings !== appliedSettings) return;
  const shown = result;
  const signal = activeRequest.signal;
  adjacentDays.set(date, null);
  getDaily(date, signal).then((day) => {
    if (signal.aborted || shown !== result) return;
    adjacentDays.set(date, day);
    renderHero();
  }).catch(() => {
    if (shown === result) adjacentDays.delete(date);
  });
}

function candidates(day) {
  if (!day) return [];
  const sharedAfternoon = Object.hasOwn(day, "fadilah");
  return Object.entries(PRAYERS)
    .map(([key, label]) => {
      const preferredWindow = sharedAfternoon && key === "asr" ? day.fadilah.asr : null;
      const time = sharedAfternoon && key === "asr" ? preferredWindow?.start : day[key]?.time;
      return {
        key, label, time, date: day.date, preferredWindow,
        when: Date.parse(time), ends: Date.parse(day[prayerCutoffs[key]]?.time),
        shared: sharedAfternoon && key === "zuhr",
      };
    })
    .filter(({ when }) => Number.isFinite(when));
}

function formatRange({ start, end }) {
  const first = formatTime(start);
  const last = formatTime(end);
  const suffix = last.match(/ (AM|PM)$/)?.[0];
  return (suffix && first.endsWith(suffix) ? first.slice(0, -suffix.length) : first) + "–" + last;
}

function renderHero() {
  if (!result) return;
  const today = localISO(new Date(), result.timezone);
  const isToday = result.date === today;
  const now = Date.now();
  const prayers = candidates(result).sort((left, right) => left.when - right.when);
  const yesterday = isToday ? shiftDate(today, -1) : null;
  const tomorrow = isToday ? shiftDate(today, 1) : null;
  const schedule = isToday
    ? [...candidates(adjacentDays.get(yesterday)), ...prayers, ...candidates(adjacentDays.get(tomorrow))]
      .sort((left, right) => left.when - right.when)
    : prayers;
  const upcoming = isToday ? schedule.find(({ when }) => when > now) : prayers.find(({ preferredWindow }) => !preferredWindow);
  const started = isToday ? schedule.findLast(({ when, preferredWindow }) => when <= now && !preferredWindow) : null;
  const current = started && !(started.ends <= now) ? started : null;
  const nextWindow = upcoming?.preferredWindow;

  byId("hero-label").textContent = nextWindow ? "Next preferred window" : isToday ? "Next prayer" : "First prayer";
  byId("hero-prayer").textContent = upcoming?.label ?? "—";
  const heroTime = byId("hero-time");
  heroTime.classList.toggle("clock-range", !!nextWindow);
  heroTime.textContent = nextWindow ? formatRange(nextWindow) : formatTime(upcoming?.time);
  byId("hero-day").hidden = !isToday || !upcoming || upcoming.time.slice(0, 10) <= today;
  byId("current-prayer").hidden = !isToday;
  byId("current-prayer-label").textContent = current?.shared ? "Current prayers" : "Current prayer";
  byId("current-prayer-name").textContent = current?.shared ? "Ẓuhr / ʿAṣr" : current?.label ?? "Between prayers";
  for (const row of prayerRows) {
    const key = row.dataset.prayerRow;
    const range = result.fadilah?.[key];
    row.classList.toggle("next-row", isToday && key === upcoming?.key && result.date === upcoming.date);
    row.classList.toggle("in-fadilah", !!(isToday && range && Date.parse(range.start) <= now && now < Date.parse(range.end)));
  }

  if (isToday) {
    if (!prayers.some(({ when, preferredWindow }) => when <= now && !preferredWindow)) loadAdjacentDay(yesterday);
    if (!upcoming) loadAdjacentDay(tomorrow);
  }
}

function renderFadilah(windows) {
  fadilahMethodology.hidden = !Object.keys(windows ?? {}).length;
  for (const key of ["zuhr", "asr"]) {
    const time = windows?.[key];
    const windowLabel = byId("fadilah-" + key);
    windowLabel.hidden = !time;
    if (!time) {
      byId("fadilah-note-" + key).hidePopover?.();
      continue;
    }

    const button = windowLabel.querySelector(".fadilah-range");
    const range = formatRange(time);
    button.textContent = range;
    button.setAttribute("aria-label", PRAYERS[key] + " preferred window, " + button.textContent);
    windowLabel.querySelector("[data-fadilah-note-range]").textContent = range;
    windowLabel.querySelector("[data-fadilah-preferred]").textContent = formatTime(time.preferred_by);
  }
}

function renderMap() {
  const lat = Number(displayedLocation.lat.toFixed(2));
  const outOfBounds = Math.abs(lat) > 85;
  byId("map-notice").hidden = !outOfBounds;
  if (outOfBounds) {
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
  dateButton.disabled = false;
  const gregorian = byId("hero-date");
  gregorian.dateTime = result.date;
  gregorian.textContent = civilDate(result.date, { weekday: "long" }) + ", " +
    civilDate(result.date, { month: "long", day: "numeric", year: "numeric" });
  byId("daily-heading-location").textContent = displayedLocation.label;
  const hijri = result.hijri;
  byId("daily-hijri").textContent = hijri.day + " " + hijri.month_name + " " + hijri.year + " AH";
  for (const key of Object.keys({ ...PRAYERS, ...solarLabels })) {
    const time = result[key]?.time;
    const nextDay = formatTime(time) !== "—" && time.slice(0, 10) > result.date;
    byId("time-" + key).textContent = formatTime(time) + (nextDay ? " (+1d)" : "");
  }
  const sharedAfternoon = Object.hasOwn(result, "fadilah");
  const asrTime = byId("time-asr");
  const asrWindow = result.fadilah?.asr;
  asrTime.hidden = !!asrWindow;
  asrTime.classList.toggle("asr-fallback", sharedAfternoon);
  byId("asr-preferred-label").hidden = !asrWindow;
  if (sharedAfternoon) asrTime.textContent = Number.isFinite(Date.parse(result.zuhr?.time)) ? "After Ẓuhr" : "—";
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
    adjacentDays.clear();
    result = data;
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
    const newLocation = locationFields.read();
    errorStatus.textContent = "";
    const unchanged = newLocation.lat === location.lat && newLocation.lon === location.lon && newLocation.label === location.label;
    if (unchanged && (location === displayedLocation || timeline.getAttribute("aria-busy") === "true")) {
      return;
    }
    location = newLocation;
    saveSelections = true;
    refresh();
  } catch (error) {
    errorStatus.textContent = error.message;
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

const datePicker = setupDatePicker((date) => {
  const today = localISO(new Date(), result.timezone);
  selectedDate = date === today ? undefined : date;
  refresh();
});
dateButton.addEventListener("click", () => datePicker.open(result.date, localISO(new Date(), result.timezone)));

for (const button of timeline.querySelectorAll("[popovertarget]")) {
  const tile = byId(button.getAttribute("popovertarget"));
  let hideTimer;
  let pinned = false;
  const isOpen = () => tile.matches(":popover-open");
  const keepOpen = () => clearTimeout(hideTimer);
  const hideOnLeave = () => {
    keepOpen();
    if (!pinned) hideTimer = setTimeout(() => tile.hidePopover(), 200);
  };
  button.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") return;
    keepOpen();
    if (!isOpen()) tile.showPopover({ source: button });
  });
  button.addEventListener("pointerleave", hideOnLeave);
  tile.addEventListener("pointerenter", keepOpen);
  tile.addEventListener("pointerleave", hideOnLeave);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    keepOpen();
    pinned = !pinned;
    if (!pinned) tile.hidePopover();
    else if (!isOpen()) tile.showPopover({ source: button });
  });
  tile.addEventListener("toggle", () => {
    button.setAttribute("aria-expanded", String(isOpen()));
    if (!isOpen()) pinned = false;
  });
  tile.addEventListener("beforetoggle", (event) => {
    if (event.newState !== "open") return;
    const rect = button.closest(".fadilah-window").getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const edge = .75 * rem;
    const tileWidth = Math.min(17.5 * rem, innerWidth - 2 * edge);
    tile.style.left = Math.max(edge, Math.min(rect.right - tileWidth, innerWidth - tileWidth - edge)) + "px";
    const below = innerHeight - rect.bottom;
    const placeBelow = below >= 12 * rem || below >= rect.top;
    tile.style.maxHeight = (placeBelow ? below - 8 - edge : rect.top - 8 - edge) + "px";
    tile.style.insetBlock = placeBelow
      ? (rect.bottom + 8) + "px auto"
      : "auto " + (innerHeight - rect.top + 8) + "px";
  });
}

byId("open-location").addEventListener("click", () => {
  locationDialog.showModal();
  const citySearch = locationControls.querySelector("[data-city]");
  citySearch.focus();
  citySearch.select();
});
locationControls.addEventListener("locationchange", ({ detail }) => {
  clearTimeout(locationTimer);
  if (detail.coordinates) {
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
