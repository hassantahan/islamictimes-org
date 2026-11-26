import { rememberCity, setMapLink, setupLocation } from "./shared/location.js";
import { apiResponse, localISO } from "./shared/timetable.js";

const byId = (id) => document.getElementById(id);
const months = [
  "Muḥarram", "Ṣaffar", "Rabīʿ al-Awwal", "Rabīʿ al-Thānī", "Jumādā al-Ūlā", "Jumādā al-Thāniyah",
  "Rajab", "Shaʿbān", "Ramaḍān", "Shawwāl", "Dhū al-Qaʿdah", "Dhū al-Ḥijjah",
];
const month = byId("month-select");
const year = byId("year-select");
const map = byId("map-output");
const mapStatus = byId("map-status");
const localStatus = byId("visibility-status");
const criterion = byId("visibility-criterion");
const entries = byId("visibility-entries");
const form = byId("visibility-form");
const locationFields = setupLocation(form);
let index = [];
let selectedLocation;
let pending;

function renderMap() {
  const entry = index.find((item) => item.month === month.value && Number(item.year) === Number(year.value));
  map.hidden = true;
  map.removeAttribute("src");
  if (!entry || typeof entry.file !== "string") {
    mapStatus.textContent = "No precomputed map is available for this month and year.";
    return;
  }

  const base = new URL(map.dataset.base);
  const image = new URL(entry.file, base.href.endsWith("/") ? base : base.href + "/");
  if (image.origin !== base.origin || !image.pathname.startsWith(base.pathname)) {
    mapStatus.textContent = "The map address is unavailable.";
    return;
  }
  mapStatus.textContent = "Loading visibility map…";
  map.alt = month.value + " " + year.value + " crescent visibility map";
  map.src = image.href;
}

map.addEventListener("load", () => {
  mapStatus.textContent = "";
  map.hidden = false;
});
map.addEventListener("error", () => {
  mapStatus.textContent = "The visibility map could not be loaded.";
  map.hidden = true;
});

async function loadMaps() {
  const [maps, upcoming] = await Promise.allSettled([
    apiResponse("/maps_index").then((response) => response.json()),
    apiResponse("/upcoming_hijri?date=" + localISO()).then((response) => response.json()),
  ]);
  if (maps.status === "fulfilled") {
    index = maps.value.filter((item) => item && months.includes(item.month) && Number.isInteger(Number(item.year)));
  }
  const current = upcoming.status === "fulfilled" ? upcoming.value : null;
  const years = new Set(index.map((item) => Number(item.year)));
  if (current) years.add(current.year);
  if (!years.size) {
    mapStatus.textContent = "The map index and Hijri date are temporarily unavailable.";
    return;
  }
  year.replaceChildren(...[...years].sort((a, b) => b - a).map((value) => new Option(value, value)));
  month.replaceChildren(...months.map((name) => new Option(name, name)));
  if (current) {
    year.value = current.year;
    if (months.includes(current.month_name)) month.value = current.month_name;
  }
  month.disabled = false;
  year.disabled = false;
  renderMap();
}

async function forecast(location) {
  pending?.abort();
  const request = new AbortController();
  pending = request;
  localStatus.textContent = "Calculating local visibility…";
  entries.replaceChildren();
  criterion.textContent = "";
  try {
    if (!year.value || !month.value) throw new Error("Wait for a Hijri month and year to become available.");
    const response = await apiResponse("/vis_calc", {
      lat: location.lat, lon: location.lon, hijri_month: months.indexOf(month.value) + 1, hijri_year: Number(year.value),
    }, request.signal);
    const data = await response.json();
    if (request.signal.aborted) return;
    for (const entry of data.entries) {
      const item = document.createElement("li");
      const heading = document.createElement("strong");
      heading.textContent = entry.datetime;
      const detail = document.createElement("p");
      detail.textContent = entry.category + " · " + entry.description;
      const quality = document.createElement("p");
      quality.className = "muted small";
      quality.textContent = "Q value " + entry.q;
      item.append(heading, detail, quality);
      entries.append(item);
    }
    criterion.textContent = "Criterion: " + data.criterion;
    localStatus.textContent = location.label;
    rememberCity(location);
    setMapLink(byId("visibility-map-link"), location);
  } catch (error) {
    if (!request.signal.aborted) localStatus.textContent = error.message;
  }
}

function selectionChanged() {
  renderMap();
  if (selectedLocation) forecast(selectedLocation);
}
month.addEventListener("change", selectionChanged);
year.addEventListener("change", selectionChanged);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    selectedLocation = locationFields.read();
    forecast(selectedLocation);
  } catch (error) {
    localStatus.textContent = error.message;
  }
});

loadMaps().catch((error) => {
  mapStatus.textContent = error.message;
});
