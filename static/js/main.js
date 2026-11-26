import { rememberCity, setupLocation } from "./shared/location.js";
import { setupDatePicker } from "./shared/date-picker.js";
import { highlightDayGauge, renderDayGauge } from "./shared/day-gauge.js";
import { onBackdropClick } from "./shared/dialog.js";
import { getPreferences, onSettingsApply, updatePreferences } from "./shared/preferences.js";
import { apiResponse, applySelect, civilDate, formatRange, formatTime, localISO, nextDayMarker, PRAYERS, setupCustomAngles, setupTimetableNote, SHIA_PRESETS, shiftDate } from "./shared/timetable.js";

const byId = (id) => document.getElementById(id);
const locationControls = byId("daily-location");
const locationDialog = byId("location-dialog");
const locationForm = byId("daily-location-form");
const settingsDialog = byId("preferences");
const locationFields = setupLocation(locationControls, "toronto");
const calculation = byId("daily-calculation");
const dateButton = byId("open-date-picker");
const method = byId("daily-method");
const asr = byId("daily-asr");
const midnight = byId("daily-midnight");
const eveningModel = byId("evening-model");
const fajrEnd = byId("fajr-end-angle");
const angles = setupCustomAngles(method, byId("custom-angles"));
const status = byId("daily-status");
const timeline = byId("daily-timeline");
const gauge = byId("prayer-gauge");
const prayerRows = [...timeline.querySelectorAll("[data-prayer-row]")];
const solarLabels = { sunrise: "Sunrise", sunset: "Sunset", midnight: "Midnight" };
const mapFrame = byId("daily-map-frame");
const prayerCutoffs = { fajr: "sunrise", zuhr: "sunset", asr: "sunset", maghrib: "midnight", isha: "midnight" };

let location = locationFields.read();
let result;
let selectedDate;
let calculationTimer;
let countdownTimer;
const adjacentDays = new Map();
let activeRequest;

function syncCalculationOptions() {
  const shiaPreset = SHIA_PRESETS.has(method.value);
  byId("daily-asr-option").hidden = shiaPreset;
  byId("evening-model-option").hidden = !shiaPreset;
  byId("fajr-end-option").hidden = !shiaPreset;
  return shiaPreset;
}

function applySettings(settings) {
  applySelect(method, settings?.name || method.options[0].value);
  applySelect(asr, settings?.asr_type ?? 0);
  applySelect(midnight, settings?.midnight_type === "preset" ? "" : settings?.midnight_type ?? "");
  angles.apply(settings);
  applySelect(eveningModel, settings?.western_redness_model ?? "seasonal");
  fajrEnd.value = location.city && settings?.fajrEndCity === location.city ? settings.fajr_fadilah_end_degrees ?? "" : "";
  syncCalculationOptions();
}

function readSettings() {
  const shiaPreset = syncCalculationOptions();
  if (shiaPreset && !fajrEnd.reportValidity()) throw new Error("Check the local Fajr end angle.");
  const settings = {
    name: method.value,
    asr_type: shiaPreset ? undefined : Number(asr.value),
    midnight_type: midnight.value === "" ? "preset" : Number(midnight.value),
    western_redness_model: shiaPreset ? eveningModel.value : undefined,
    fajr_fadilah_end_degrees: shiaPreset && fajrEnd.value !== "" ? fajrEnd.valueAsNumber : undefined,
  };
  return { ...settings, ...angles.read() };
}

let appliedSettings = getPreferences().daily;
applySettings(appliedSettings);
appliedSettings = readSettings();

function getDaily(forDate, signal, place = location, settings = appliedSettings) {
  return apiResponse("/prayer_times", {
    lat: place.lat, lon: place.lon, date: forDate, method: settings,
  }, signal).then((response) => response.json());
}

function loadAdjacentDay(date) {
  if (adjacentDays.has(date)) return;
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
  const sharedEvening = day.method.use_isha_fadilah;
  return Object.entries(PRAYERS)
    .map(([key, label]) => {
      const prefersWindow = (sharedAfternoon && key === "asr") || (sharedEvening && key === "isha");
      const preferredWindow = prefersWindow ? day.fadilah[key] : null;
      const time = prefersWindow ? preferredWindow?.start : day[key]?.time;
      return {
        key, label, time, date: day.date, preferredWindow,
        when: Date.parse(time), ends: Date.parse(day[prayerCutoffs[key]]?.time),
        sharedWith: sharedAfternoon && key === "zuhr" ? "asr" : sharedEvening && key === "maghrib" ? "isha" : null,
      };
    })
    .filter(({ when }) => Number.isFinite(when));
}

function renderCountdown(upcoming, now) {
  const remaining = upcoming.when - now;
  const seconds = Math.ceil(remaining / 1000);
  const minutes = Math.ceil(remaining / 60000);
  const hours = Math.floor(minutes / 60);
  const parts = [];
  if (hours) parts.push(hours + "h");
  if (minutes % 60) parts.push(minutes % 60 + "m");
  byId("hero-time").textContent = "in " + (seconds < 60 ? seconds + "s" : parts.join(" "));

  // Refresh at the next visible countdown change or prayer boundary.
  const delay = remaining <= 60000 ? remaining % 1000 || 1000 : remaining % 60000 || 60000;
  countdownTimer = setTimeout(() => {
    const nextNow = Date.now();
    if (nextNow < upcoming.when) renderCountdown(upcoming, nextNow);
    else renderHero();
  }, delay);
}

function renderHero() {
  if (!result) return;
  clearTimeout(countdownTimer);
  const today = localISO(new Date(), result.timezone);
  const isToday = result.date === today;
  const now = Date.now();
  const prayers = candidates(result).sort((left, right) => left.when - right.when);
  const previousDate = shiftDate(result.date, -1);
  const tomorrow = isToday ? shiftDate(today, 1) : null;
  const schedule = [...candidates(adjacentDays.get(previousDate)), ...prayers, ...candidates(adjacentDays.get(tomorrow))]
    .sort((left, right) => left.when - right.when);
  const upcoming = isToday ? schedule.find(({ when }) => when > now) : prayers.find(({ preferredWindow }) => !preferredWindow);
  const started = isToday ? schedule.findLast(({ when, preferredWindow }) => when <= now && !preferredWindow) : null;
  const current = started && !(started.ends <= now) ? started : null;
  const nextWindow = upcoming?.preferredWindow;

  byId("hero-label").textContent = nextWindow ? "Next preferred window" : isToday ? "Next prayer" : "First prayer";
  byId("hero-prayer").textContent = upcoming?.label ?? "—";
  const heroTime = byId("hero-time");
  const exactTime = nextWindow
    ? (nextWindow.estimated ? "≈ " : "") + formatRange(nextWindow)
    : formatTime(upcoming?.time);
  const showCountdown = isToday && !!upcoming;
  const heroDay = byId("hero-day");
  heroTime.classList.toggle("clock-countdown", showCountdown);
  if (showCountdown) {
    heroTime.title = exactTime;
    renderCountdown(upcoming, now);
  } else {
    heroTime.removeAttribute("title");
    heroTime.textContent = upcoming ? exactTime : "";
  }
  heroDay.hidden = !showCountdown || upcoming.time.slice(0, 10) <= today;
  if (!heroDay.hidden) heroDay.textContent = "Tomorrow · " + exactTime;
  byId("current-prayer").hidden = !isToday;
  byId("current-prayer-label").textContent = current?.sharedWith ? "Current prayers" : "Current prayer";
  const currentName = current?.sharedWith
    ? current.label + " & " + PRAYERS[current.sharedWith]
    : current?.label ?? "Between prayers";
  byId("current-prayer-name").textContent = currentName;
  byId("current-prayer-name").classList.toggle("has-prayer", !!current);
  for (const row of prayerRows) {
    const key = row.dataset.prayerRow;
    const range = result.fadilah?.[key];
    const active = current?.date === result.date && (key === current.key || key === current.sharedWith);
    const preferred = isToday && range && (active || range.estimated) && Date.parse(range.start) <= now && now < Date.parse(range.end);
    row.classList.toggle("current-row", active);
    row.querySelector("[data-prayer-state]").textContent = preferred
      ? (range.estimated ? ", estimated preferred time now" : ", preferred time now")
      : active ? ", current prayer" : "";
    row.classList.toggle("next-row", isToday && key === upcoming?.key && result.date === upcoming.date);
    row.classList.toggle("in-fadilah", !!preferred);
  }

  const showTimeline = getPreferences().showTimeline;
  gauge.hidden = !showTimeline;
  if (showTimeline) {
    renderDayGauge(gauge, result.date, result.timezone, isToday ? now : null, schedule, currentName, result.fadilah);
  }
  if (showTimeline || (isToday && !started)) loadAdjacentDay(previousDate);
  if (isToday && !upcoming) loadAdjacentDay(tomorrow);
}

function renderFadilah(windows) {
  for (const key of Object.keys(PRAYERS)) {
    const time = windows?.[key];
    const windowLabel = byId("fadilah-" + key);
    windowLabel.hidden = !time;
    if (!time) {
      byId("fadilah-note-" + key).hidePopover?.();
      continue;
    }

    const button = windowLabel.querySelector(".fadilah-range");
    const range = time.end ? formatRange(time) : "";
    button.textContent = range ? (time.estimated ? "≈ " : "") + range : "Preferred";
    const label = time.estimated ? " estimated preferred window, " : " preferred window, ";
    button.setAttribute("aria-label", PRAYERS[key] + (range ? label + range : " preferred time"));
    windowLabel.querySelector("[data-fadilah-note-range]").textContent = range;
    if (key === "fajr") {
      windowLabel.querySelector("[data-fajr-note-window]").hidden = !range;
      windowLabel.querySelector("[data-fajr-note-opening]").hidden = !!range;
      windowLabel.querySelector("[data-fajr-start]").textContent = formatTime(time.start);
    }
    const preferredBy = windowLabel.querySelector("[data-fadilah-preferred]");
    if (preferredBy) preferredBy.textContent = formatTime(time.preferred_by);
  }
}

function renderPrimaryWindow(key, enabled, after) {
  const time = byId("time-" + key);
  const showWindow = enabled && !!result.fadilah?.[key];
  time.hidden = showWindow;
  time.classList.toggle("prayer-sequence", enabled);
  byId(key + "-preferred-label").hidden = !showWindow;
  byId("fadilah-" + key).classList.toggle("primary-window", showWindow);
  if (enabled && !showWindow) {
    time.textContent = "—";
    if (Number.isFinite(Date.parse(result[after]?.time))) {
      const prayer = document.createElement("i");
      prayer.textContent = PRAYERS[after];
      time.replaceChildren("After ", prayer);
    }
  }
}

function renderMap() {
  const lat = Number(location.lat.toFixed(2));
  const outOfBounds = Math.abs(lat) > 85;
  byId("map-notice").hidden = !outOfBounds;
  if (outOfBounds) {
    if (mapFrame.hasAttribute("src")) mapFrame.removeAttribute("src");
    mapFrame.hidden = true;
    return;
  }

  const lon = Number(location.lon.toFixed(2));
  const url = new URL("../location-map.html", import.meta.url);
  url.hash = new URLSearchParams({ lat, lon, bearing: result.qibla.angle_decimal }).toString();
  mapFrame.hidden = false;
  if (mapFrame.src !== url.href) mapFrame.src = url.href;
}

function renderCaution(key, caution) {
  let button = byId("caution-" + key);
  let note = byId("caution-note-" + key);
  if (!caution) {
    if (button) {
      button.hidden = true;
      note.hidePopover();
    }
    return;
  }

  const label = PRAYERS[key] ?? solarLabels[key];
  if (!button) {
    const value = byId("time-" + key);
    const card = value.closest(".prayer-card");
    const anchor = card ? card.querySelector(".prayer-name") : value.closest("dd");
    button = document.createElement("button");
    button.id = "caution-" + key;
    button.className = "prayer-caution";
    button.type = "button";
    button.setAttribute("popovertarget", "caution-note-" + key);
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.5 18 17H2Z M10 7.5v4 M10 14h.01"/></svg>';
    note = document.createElement("div");
    note.id = "caution-note-" + key;
    note.className = "timetable-note";
    note.setAttribute("popover", "auto");
    const title = document.createElement("h3");
    title.id = "caution-title-" + key;
    note.setAttribute("aria-labelledby", title.id);
    note.append(title, document.createElement("p"));
    anchor.append(button);
    (card ?? anchor).append(note);
    setupTimetableNote(button, note, { keepClear: gauge });
  }
  button.hidden = false;
  button.setAttribute("aria-label", label + ": " + caution.kind);
  note.querySelector("h3").textContent = caution.kind === "estimated" ? "Estimated time" : "Time unavailable";
  note.querySelector("p").textContent = caution.detail;
}

function renderDaily() {
  if (!result) return;
  dateButton.disabled = false;
  const gregorian = byId("hero-date");
  gregorian.dateTime = result.date;
  gregorian.textContent = civilDate(result.date, { weekday: "long" }) + ", " +
    civilDate(result.date, { month: "long", day: "numeric", year: "numeric" });
  byId("daily-heading-location").textContent = location.label;
  byId("open-location").title = location.label;
  const hijri = result.hijri;
  const month = document.createElement("i");
  month.textContent = hijri.month_name;
  byId("daily-hijri").replaceChildren(hijri.day + " ", month, " " + hijri.year + " AH");
  for (const key of Object.keys({ ...PRAYERS, ...solarLabels })) {
    const time = result[key]?.time;
    const value = byId("time-" + key);
    const reading = formatTime(time);
    value.textContent = reading;
    if (reading !== "—" && time.slice(0, 10) > result.date) value.append(nextDayMarker());
    renderCaution(key, result[key]?.caution);
  }
  const midnightEnd = byId("midnight-note-end");
  midnightEnd.textContent = "sunrise";
  if (result.method.midnight_type === 1) {
    const fajr = document.createElement("i");
    fajr.textContent = PRAYERS.fajr;
    midnightEnd.replaceChildren(fajr);
  }
  byId("open-midnight-note").disabled = false;
  renderPrimaryWindow("asr", Object.hasOwn(result, "fadilah"), "zuhr");
  renderPrimaryWindow("isha", result.method.use_isha_fadilah, "maghrib");
  byId("qibla-angle").textContent = result.qibla.angle_decimal.toFixed(1) + "° " + result.qibla.cardinal;
  byId("qibla-distance").textContent = Math.round(result.qibla.distance_km).toLocaleString() + " km";
  byId("qibla-needle").style.setProperty("--bearing", result.qibla.angle_decimal + "deg");
  renderFadilah(result.fadilah);
  renderMap();
  renderHero();
}

async function refresh({ place = location, settings = appliedSettings, date = selectedDate, save = false, dialog, errorStatus } = {}) {
  activeRequest?.abort();
  const request = new AbortController();
  activeRequest = request;
  const abort = () => request.abort();
  dialog?.addEventListener("close", abort, { once: true });
  timeline.setAttribute("aria-busy", "true");
  status.textContent = "Updating…";
  try {
    const data = await getDaily(date, request.signal, place, settings);
    if (request.signal.aborted || (dialog && !dialog.open)) return false;
    adjacentDays.clear();
    location = place;
    appliedSettings = settings;
    selectedDate = date;
    result = data;
    if (save) {
      rememberCity(location);
      const daily = { ...appliedSettings };
      if (daily.fajr_fadilah_end_degrees !== undefined) {
        if (location.city) daily.fajrEndCity = location.city;
        else delete daily.fajr_fadilah_end_degrees;
      }
      updatePreferences({ daily });
    }
    renderDaily();
    status.textContent = "";
    return true;
  } catch (error) {
    if (!request.signal.aborted) {
      status.textContent = errorStatus ? "" : error.message;
      if (errorStatus) errorStatus.textContent = error.message;
    }
    return false;
  } finally {
    dialog?.removeEventListener("close", abort);
    if (activeRequest === request) {
      timeline.setAttribute("aria-busy", "false");
      if (request.signal.aborted || (dialog && !dialog.open)) status.textContent = "";
    }
  }
}

async function updateLocation(event) {
  event.preventDefault();
  if (locationForm.inert) return;
  const errorStatus = byId("location-error");
  errorStatus.textContent = "";
  try {
    const place = locationFields.read();
    const moved = place.lat !== location.lat || place.lon !== location.lon;
    if (!moved && place.label === location.label && result) {
      locationDialog.close();
      return;
    }
    const settings = moved ? { ...appliedSettings, fajr_fadilah_end_degrees: undefined } : appliedSettings;
    locationForm.inert = true;
    if (!await refresh({ place, settings, save: true, dialog: locationDialog, errorStatus })) return;
    if (moved) fajrEnd.value = "";
    locationDialog.close();
  } catch (error) {
    errorStatus.textContent = error.message;
  } finally {
    locationForm.inert = false;
  }
}

function updateCalculation() {
  const errorStatus = byId("calculation-error");
  errorStatus.textContent = "";
  try {
    const settings = readSettings();
    const unchanged = JSON.stringify(settings) === JSON.stringify(appliedSettings);
    if (unchanged && result && timeline.getAttribute("aria-busy") === "false") return true;
    return refresh({ settings, save: true, dialog: settingsDialog, errorStatus });
  } catch (error) {
    errorStatus.textContent = error.message;
    return false;
  }
}

const datePicker = setupDatePicker((date, dialog, errorStatus) => {
  const today = localISO(new Date(), result.timezone);
  return date === result.date || refresh({ date: date === today ? null : date, dialog, errorStatus });
});
dateButton.addEventListener("click", () => datePicker.open(result.date, localISO(new Date(), result.timezone)));

for (const button of timeline.closest(".prayer-sheet").querySelectorAll("[popovertarget]")) {
  setupTimetableNote(button, byId(button.getAttribute("popovertarget")), { keepClear: gauge });
}
for (const row of prayerRows) {
  const card = row.querySelector(".prayer-card");
  const highlight = () => highlightDayGauge(gauge, row.dataset.prayerRow);
  const clear = () => highlightDayGauge(gauge, "");
  card.addEventListener("pointerenter", (event) => { if (event.pointerType === "mouse") highlight(); });
  card.addEventListener("pointerleave", () => { if (!card.querySelector(":focus-visible")) clear(); });
  card.addEventListener("focusin", (event) => { if (event.target.matches(":focus-visible")) highlight(); });
  card.addEventListener("focusout", (event) => {
    if (!card.contains(event.relatedTarget) && !card.matches(":hover")) clear();
  });
}

function highlightPrayerCards(target) {
  const keys = target?.closest(".gauge-band")?.dataset.prayers.split(" ") ?? [];
  for (const row of prayerRows) row.classList.toggle("from-gauge", keys.includes(row.dataset.prayerRow));
}
gauge.addEventListener("pointerover", (event) => {
  if (event.pointerType === "mouse") highlightPrayerCards(event.target);
});
gauge.addEventListener("pointerleave", () => highlightPrayerCards(gauge.querySelector(".gauge-band:focus-visible")));
gauge.addEventListener("focusin", (event) => {
  if (event.target.matches(":focus-visible")) highlightPrayerCards(event.target);
});
gauge.addEventListener("focusout", (event) => highlightPrayerCards(event.relatedTarget));

byId("open-location").addEventListener("click", () => {
  locationFields.setLocation(location);
  byId("location-error").textContent = "";
  locationDialog.showModal();
  const citySearch = locationControls.querySelector("[data-city]");
  citySearch.focus();
  citySearch.select();
});
locationControls.addEventListener("input", () => {
  byId("location-error").textContent = "";
});
locationControls.addEventListener("locationchange", () => {
  byId("location-error").textContent = "";
});
locationForm.addEventListener("submit", updateLocation);
onBackdropClick(locationDialog, () => locationForm.requestSubmit());
calculation.addEventListener("input", (event) => {
  if (!event.target.matches("[data-prayer-angle]")) return;
  clearTimeout(calculationTimer);
  calculationTimer = setTimeout(updateCalculation, 300);
});
calculation.addEventListener("change", () => {
  clearTimeout(calculationTimer);
  updateCalculation();
});
onSettingsApply(() => {
  clearTimeout(calculationTimer);
  return updateCalculation();
});
settingsDialog.addEventListener("close", () => {
  clearTimeout(calculationTimer);
  applySettings(appliedSettings);
  fajrEnd.value = appliedSettings.fajr_fadilah_end_degrees ?? "";
});
document.addEventListener("preferenceschange", ({ detail }) => {
  if (detail.keys.includes("clock")) renderDaily();
  else if (detail.keys.includes("showTimeline")) renderHero();
});
setInterval(() => {
  const isStale = result && result.date !== localISO(new Date(), result.timezone);
  if (!selectedDate && isStale && timeline.getAttribute("aria-busy") === "false") refresh();
  else renderHero();
}, 30000);
refresh();
