import { getPreferences, updatePreferences } from "./preferences.js";

const CITIES = {
  amman: { label: "Amman, Jordan", lat: 31.95, lon: 35.93 },
  cairo: { label: "Cairo, Egypt", lat: 30.04, lon: 31.24 },
  capeTown: { label: "Cape Town, South Africa", lat: -33.92, lon: 18.42 },
  chicago: { label: "Chicago, United States", lat: 41.88, lon: -87.63 },
  dhaka: { label: "Dhaka, Bangladesh", lat: 23.81, lon: 90.41 },
  dubai: { label: "Dubai, United Arab Emirates", lat: 25.20, lon: 55.27 },
  istanbul: { label: "Istanbul, Türkiye", lat: 41.01, lon: 28.98 },
  jakarta: { label: "Jakarta, Indonesia", lat: -6.21, lon: 106.85 },
  karachi: { label: "Karachi, Pakistan", lat: 24.86, lon: 67.01 },
  kualaLumpur: { label: "Kuala Lumpur, Malaysia", lat: 3.14, lon: 101.69 },
  london: { label: "London, United Kingdom", lat: 51.51, lon: -0.13 },
  losAngeles: { label: "Los Angeles, United States", lat: 34.05, lon: -118.24 },
  makkah: { label: "Makkah, Saudi Arabia", lat: 21.42, lon: 39.83 },
  melbourne: { label: "Melbourne, Australia", lat: -37.81, lon: 144.96 },
  montreal: { label: "Montréal, Canada", lat: 45.50, lon: -73.57 },
  newYork: { label: "New York, United States", lat: 40.71, lon: -74.01 },
  paris: { label: "Paris, France", lat: 48.86, lon: 2.35 },
  singapore: { label: "Singapore", lat: 1.35, lon: 103.82 },
  sydney: { label: "Sydney, Australia", lat: -33.87, lon: 151.21 },
  tehran: { label: "Tehran, Iran", lat: 35.69, lon: 51.39 },
  toronto: { label: "Toronto, Canada", lat: 43.65, lon: -79.38 },
  vancouver: { label: "Vancouver, Canada", lat: 49.28, lon: -123.12 },
};

const featuredCities = Object.entries(CITIES).map(([city, place]) => ({ ...place, city }));
const countries = new Intl.DisplayNames(["en"], { type: "region" });
let cityIndex;

function searchText(value) {
  return value.normalize("NFD").replace(/\p{Mark}/gu, "").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function loadCityIndex() {
  if (!cityIndex) {
    cityIndex = fetch(new URL("../../data/cities.json", import.meta.url), { credentials: "omit" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load cities.");
        return response.json();
      })
      .then((cities) => cities.map(([id, name, ascii, country, region, lat, lon]) => {
        const label = [...new Set([name, region, countries.of(country)].filter(Boolean))].join(", ");
        return { city: "geonames:" + id, label, lat, lon, terms: searchText(label + " " + ascii + " " + country).split(" ") };
      }))
      .catch((error) => {
        cityIndex = undefined;
        throw error;
      });
  }
  return cityIndex;
}

function savedCity() {
  const city = getPreferences().city;
  if (typeof city === "string") return featuredCities.find((place) => place.city === city);
  if (typeof city?.city === "string" && /^geonames:\d+$/.test(city.city) && typeof city.label === "string" &&
      Number.isFinite(city.lat) && Math.abs(city.lat) <= 90 &&
      Number.isFinite(city.lon) && Math.abs(city.lon) <= 180) {
    return city;
  }
}

export function rememberCity(location) {
  if (!location.city) return;
  const { city, label, lat, lon } = location;
  updatePreferences({ city: Object.hasOwn(CITIES, city) ? city : { city, label, lat, lon } });
}

export function setMapLink(link, location) {
  link.href = "https://www.openstreetmap.org/?mlat=" + location.lat + "&mlon=" + location.lon +
    "#map=13/" + location.lat + "/" + location.lon;
  link.hidden = false;
}

export function setupLocation(form, defaultCity = "") {
  const input = form.querySelector("[data-city]");
  const list = form.querySelector("[data-city-results]");
  const searchStatus = form.querySelector("[data-city-status]");
  const lat = form.querySelector("[data-latitude]");
  const lon = form.querySelector("[data-longitude]");
  const details = form.querySelector("[data-coordinate-details]");
  const device = form.querySelector("[data-geolocate]");
  const status = form.querySelector("[data-location-status]");
  let selected = savedCity() ?? featuredCities.find(({ city }) => city === defaultCity);
  let suggestions = [];
  let activeOption = -1;
  let searchGeneration = 0;
  let locationGeneration = 0;
  let debounce;
  let custom = false;
  let fromDevice = false;

  input.value = selected?.label ?? "";

  function setActive(index) {
    if (activeOption >= 0) list.children[activeOption]?.setAttribute("aria-selected", "false");
    activeOption = index;
    const option = list.children[index];
    if (option) {
      option.setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function closeResults() {
    searchGeneration += 1;
    clearTimeout(debounce);
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    setActive(-1);
  }

  function setLocation(place) {
    locationGeneration += 1;
    selected = place.city ? place : undefined;
    custom = !selected;
    fromDevice = custom && place.label === "Device location";
    input.value = selected?.label ?? "";
    lat.value = custom ? place.lat : "";
    lon.value = custom ? place.lon : "";
    details.open = custom;
    searchStatus.textContent = "";
    status.textContent = "";
    closeResults();
  }

  function choose(place) {
    setLocation(place);
    form.dispatchEvent(new CustomEvent("locationchange", { detail: { coordinates: false } }));
  }

  function renderResults(places, message) {
    setActive(-1);
    suggestions = places;
    list.replaceChildren(...places.map((place, index) => {
      const option = document.createElement("li");
      option.id = list.id + "-" + index;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = place.label;
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => choose(place));
      return option;
    }));
    list.hidden = !places.length;
    input.setAttribute("aria-expanded", String(!!places.length));
    searchStatus.textContent = message;
  }

  async function search() {
    const generation = ++searchGeneration;
    const query = searchText(input.value);
    if (query.length < 2) return;
    const words = query.split(" ");
    const matches = (terms) => words.every((word) => terms.some((term) => term.startsWith(word)));
    const places = featuredCities.filter(({ label }) => matches(searchText(label).split(" "))).slice(0, 8);
    renderResults(places, places.length ? "" : "Searching…");
    try {
      for (const place of await loadCityIndex()) {
        if (generation !== searchGeneration) return;
        if (places.length === 8) break;
        if (matches(place.terms) && !places.some(({ lat, lon }) => Math.abs(lat - place.lat) < .035 && Math.abs(lon - place.lon) < .035)) {
          places.push(place);
        }
      }
      renderResults(places, places.length ? "" : "No matching cities.");
    } catch {
      if (generation === searchGeneration) renderResults(places, places.length ? "" : "City search unavailable.");
    }
  }

  function markCustom(deviceLocation = false) {
    locationGeneration += 1;
    custom = true;
    fromDevice = deviceLocation;
    input.value = "";
    searchStatus.textContent = "";
    closeResults();
    form.dispatchEvent(new CustomEvent("locationchange", { detail: { coordinates: true } }));
  }

  input.addEventListener("input", () => {
    locationGeneration += 1;
    closeResults();
    searchStatus.textContent = "";
    debounce = setTimeout(search, 140);
  });
  input.addEventListener("blur", () => {
    closeResults();
    searchStatus.textContent = "";
  });
  input.addEventListener("keydown", (event) => {
    if (list.hidden) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = activeOption < 0 && delta < 0 ? suggestions.length - 1 : activeOption + delta;
      setActive((next + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(suggestions[Math.max(0, activeOption)]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeResults();
    }
  });
  lat.addEventListener("input", () => markCustom());
  lon.addEventListener("input", () => markCustom());
  device.addEventListener("click", () => {
    if (!navigator.geolocation) {
      status.textContent = "Device location unavailable.";
      return;
    }
    const generation = ++locationGeneration;
    device.disabled = true;
    status.textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (generation === locationGeneration) {
        lat.value = coords.latitude.toFixed(6);
        lon.value = coords.longitude.toFixed(6);
        markCustom(true);
      }
      status.textContent = "";
      device.disabled = false;
    }, () => {
      status.textContent = generation === locationGeneration ? "Device location unavailable." : "";
      device.disabled = false;
    }, { timeout: 10000 });
  });

  return {
    setLocation,
    read() {
      if (input.value && selected && input.value === selected.label) return selected;
      if (input.value.trim()) throw new Error("Choose a city from the search results.");
      if (custom) {
        if (lat.value && lon.value && lat.validity.valid && lon.validity.valid) {
          return { lat: lat.valueAsNumber, lon: lon.valueAsNumber, label: fromDevice ? "Device location" : "Custom coordinates", city: "" };
        }
        throw new Error("Enter a valid latitude and longitude.");
      }
      throw new Error("Choose a city or provide your location.");
    },
  };
}
