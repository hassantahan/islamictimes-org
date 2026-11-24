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

export function savedCity() {
  const city = getPreferences().city;
  return Object.hasOwn(CITIES, city) ? city : "";
}

export function exampleLocation() {
  return { ...CITIES.toronto, city: "", example: true };
}

export function rememberCity(location) {
  if (location.city) updatePreferences({ city: location.city });
}

export function setMapLink(link, location) {
  link.href = "https://www.openstreetmap.org/?mlat=" + location.lat + "&mlon=" + location.lon +
    "#map=13/" + location.lat + "/" + location.lon;
  link.hidden = false;
}

export function setupLocation(form) {
  const city = form.querySelector("[data-city]");
  const lat = form.querySelector("[data-latitude]");
  const lon = form.querySelector("[data-longitude]");
  const details = form.querySelector("[data-coordinate-details]");
  const device = form.querySelector("[data-geolocate]");
  const status = form.querySelector("[data-location-status]");
  const customOption = city.querySelector('[value="custom"]');
  let fromDevice = false;

  for (const [key, place] of Object.entries(CITIES)) city.insertBefore(new Option(place.label, key), customOption);
  city.value = savedCity();

  function markCustom(deviceLocation = false) {
    city.value = "custom";
    fromDevice = deviceLocation;
    form.dispatchEvent(new Event("locationchange"));
  }

  city.addEventListener("change", () => {
    details.open = city.value === "custom";
    status.textContent = "";
    if (city.value !== "custom") {
      lat.value = "";
      lon.value = "";
      fromDevice = false;
    }
    form.dispatchEvent(new Event("locationchange"));
  });

  lat.addEventListener("input", () => markCustom());
  lon.addEventListener("input", () => markCustom());
  device.addEventListener("click", () => {
    if (!navigator.geolocation) {
      status.textContent = "Device location unavailable.";
      return;
    }
    device.disabled = true;
    status.textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      lat.value = coords.latitude.toFixed(6);
      lon.value = coords.longitude.toFixed(6);
      markCustom(true);
      status.textContent = "";
      device.disabled = false;
    }, () => {
      status.textContent = "Device location unavailable.";
      device.disabled = false;
    }, { timeout: 10000 });
  });

  return {
    read() {
      if (Object.hasOwn(CITIES, city.value)) return { ...CITIES[city.value], city: city.value };
      if (city.value === "custom") {
        if (lat.value && lon.value && lat.validity.valid && lon.validity.valid) {
          return { lat: lat.valueAsNumber, lon: lon.valueAsNumber, label: fromDevice ? "Device location" : "Custom coordinates", city: "" };
        }
        throw new Error("Enter a valid latitude and longitude.");
      }
      throw new Error("Choose a city or provide your location.");
    },
  };
}
