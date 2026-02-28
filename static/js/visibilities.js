const $ = (selector) => document.querySelector(selector);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

const HIJRI_MONTHS = [
  "Muḥarram",
  "Ṣaffar",
  "Rabīʿ al-Awwal",
  "Rabīʿ al-Thānī",
  "Jumādā al-Ūlā",
  "Jumādā al-Thāniyah",
  "Rajab",
  "Shaʿbān",
  "Ramaḍān",
  "Shawwāl",
  "Dhū al-Qaʿdah",
  "Dhū al-Ḥijjah",
];

const state = {
  coords: null,
  indexData: [],
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 6) {
  return Number.parseFloat(value.toFixed(digits));
}

function normalizeCoordinateValue(rawValue, min, max) {
  const parsed = Number.parseFloat(rawValue);
  if (Number.isNaN(parsed)) return "";
  const normalized = round(clamp(parsed, min, max), 6);
  return String(normalized);
}

function initCoordinateInputNormalization() {
  const fields = [
    { selector: "#lat", min: -90, max: 90 },
    { selector: "#lon", min: -180, max: 180 },
  ];

  fields.forEach(({ selector, min, max }) => {
    const input = $(selector);
    if (!input) return;

    const normalize = () => {
      const next = normalizeCoordinateValue(input.value, min, max);
      if (next !== "") input.value = next;
    };

    input.addEventListener("blur", normalize);
    input.addEventListener("change", normalize);
  });
}

async function parseApiResponse(response) {
  if (response.ok) return response.json();

  let message = `Request failed (${response.status})`;
  try {
    const payload = await response.json();
    message = payload?.error?.message || message;
  } catch {
    const text = await response.text();
    if (text) message = text;
  }
  throw new Error(message);
}

function setSmallMap(lat, lon) {
  const map = $("#map");
  if (!map) return;

  map.src =
    `https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.05},${lat - 0.03},${lon + 0.05},${lat + 0.03}` +
    `&layer=mapnik&marker=${lat},${lon}`;
}

function renderLargeMap() {
  const mapOutput = $("#map-output");
  const monthValue = $("#month-select")?.value;
  const yearValue = Number.parseInt($("#year-select")?.value || "", 10);
  if (!mapOutput || !monthValue || Number.isNaN(yearValue)) return;

  const entry = state.indexData.find((item) => item.month === monthValue && item.year === yearValue);
  if (!entry) {
    mapOutput.removeAttribute("src");
    mapOutput.alt = "No precomputed map available for the selected month/year";
    return;
  }

  mapOutput.src = `https://islamictimes-maps.onrender.com/${entry.file}`;
  mapOutput.alt = `${monthValue} ${yearValue} visibility map`;
}

function renderVisibilityTable(data) {
  const body = $("#vis-body");
  const criterion = $("#vis-criterion");
  if (!body || !criterion) return;

  body.innerHTML = "";
  criterion.textContent = `Criterion: ${data.criterion}`;

  data.entries.forEach((entry) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-2">${entry.datetime}</td>
      <td class="px-4 py-2">${entry.q}</td>
      <td class="px-4 py-2">${entry.category}</td>
      <td class="px-4 py-2">${entry.description}</td>
    `;
    body.append(tr);
  });
}

async function fetchVisibilities() {
  if (!state.coords) return;

  const spinner = $("#map-spinner");
  show(spinner);

  try {
    const monthName = $("#month-select")?.value;
    const yearValue = Number.parseInt($("#year-select")?.value || "", 10);

    const payload = {
      lat: state.coords.lat,
      lon: state.coords.lon,
      hijri_month: HIJRI_MONTHS.indexOf(monthName) + 1,
      hijri_year: yearValue,
    };

    const response = await fetch("/vis_calc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await parseApiResponse(response);
    renderVisibilityTable(data);
  } catch (err) {
    const body = $("#vis-body");
    const criterion = $("#vis-criterion");
    if (body) {
      body.innerHTML = `<tr><td colspan="4" class="px-4 py-2 text-red-500">${err.message}</td></tr>`;
    }
    if (criterion) criterion.textContent = "";
  } finally {
    hide(spinner);
  }
}

async function loadMapIndex() {
  const response = await fetch("/maps_index");
  const data = await parseApiResponse(response);
  if (!Array.isArray(data)) throw new Error("Invalid maps index response");

  state.indexData = data;

  const months = new Set(data.map((item) => item.month));
  const years = [...new Set(data.map((item) => item.year))].sort((a, b) => a - b);

  const monthSelect = $("#month-select");
  const yearSelect = $("#year-select");
  monthSelect.innerHTML = "";
  yearSelect.innerHTML = "";

  HIJRI_MONTHS.forEach((monthName) => {
    if (!months.has(monthName)) return;
    const option = document.createElement("option");
    option.value = monthName;
    option.textContent = monthName;
    monthSelect.append(option);
  });

  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.append(option);
  });

  try {
    const todayISO = new Date().toISOString().slice(0, 10);
    const upcoming = await fetch(`/upcoming_hijri?date=${todayISO}`).then((r) => r.json());
    if (months.has(upcoming.month_name)) monthSelect.value = upcoming.month_name;
    if (years.includes(upcoming.year)) yearSelect.value = String(upcoming.year);
  } catch {
    // ignore, use defaults
  }

  monthSelect.addEventListener("change", () => {
    renderLargeMap();
    fetchVisibilities();
  });

  yearSelect.addEventListener("change", () => {
    renderLargeMap();
    fetchVisibilities();
  });

  renderLargeMap();
}

function initAutocomplete() {
  const cityInput = $("#city");
  const suggestions = $("#autocomplete-suggestions");
  if (!cityInput || !suggestions) return;

  let timeoutId = null;

  cityInput.addEventListener("input", () => {
    clearTimeout(timeoutId);

    timeoutId = setTimeout(async () => {
      const query = cityInput.value.trim();
      if (!query) {
        hide(suggestions);
        return;
      }

      try {
        const results = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`
        ).then((r) => r.json());

        suggestions.innerHTML = "";
        results.forEach((item) => {
          const li = document.createElement("li");
          li.className = "px-3 py-2 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer";
          li.textContent = item.display_name;

          li.addEventListener("click", async () => {
            const lat = round(clamp(Number.parseFloat(item.lat), -90, 90));
            const lon = round(clamp(Number.parseFloat(item.lon), -180, 180));

            state.coords = { lat, lon };
            $("#lat").value = lat;
            $("#lon").value = lon;
            cityInput.value = item.display_name;
            hide(suggestions);

            setSmallMap(lat, lon);
            await fetchVisibilities();
          });
          suggestions.append(li);
        });

        show(suggestions);
      } catch {
        hide(suggestions);
      }
    }, 300);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#city") && !event.target.closest("#autocomplete-suggestions")) {
      hide(suggestions);
    }
  });
}

function initManualLocationButton() {
  const manualButton = $("#use-manual");
  if (!manualButton) return;

  manualButton.addEventListener("click", async () => {
    let lat = Number.parseFloat($("#lat").value);
    let lon = Number.parseFloat($("#lon").value);

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      alert("Enter valid coordinates.");
      return;
    }

    lat = round(clamp(lat, -90, 90));
    lon = round(clamp(lon, -180, 180));

    state.coords = { lat, lon };
    $("#lat").value = lat;
    $("#lon").value = lon;

    setSmallMap(lat, lon);
    await fetchVisibilities();
  });
}

function initGpsButton() {
  const gpsButton = $("#use-gps");
  if (!gpsButton) return;

  gpsButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const lat = round(clamp(coords.latitude, -90, 90));
        const lon = round(clamp(coords.longitude, -180, 180));

        state.coords = { lat, lon };
        $("#lat").value = lat;
        $("#lon").value = lon;

        try {
          const reverse = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
          ).then((r) => r.json());
          if (reverse?.display_name) $("#city").value = reverse.display_name;
        } catch {
          // non-blocking
        }

        setSmallMap(lat, lon);
        await fetchVisibilities();
      },
      () => alert("GPS unavailable or permission denied.")
    );
  });
}

async function initIpFallback() {
  try {
    const ip = await fetch("https://ipapi.co/json/").then((r) => r.json());
    const lat = round(clamp(Number(ip.latitude), -90, 90));
    const lon = round(clamp(Number(ip.longitude), -180, 180));

    state.coords = { lat, lon };
    $("#lat").value = lat;
    $("#lon").value = lon;
    $("#city").value = [ip.city, ip.region, ip.country_name].filter(Boolean).join(", ");

    setSmallMap(lat, lon);
    await fetchVisibilities();
  } catch {
    // user can still set location manually
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  if (!$("#month-select")) return;

  initCoordinateInputNormalization();
  initAutocomplete();
  initManualLocationButton();
  initGpsButton();

  try {
    await loadMapIndex();
  } catch (err) {
    const body = $("#vis-body");
    if (body) {
      body.innerHTML = `<tr><td colspan="4" class="px-4 py-2 text-red-500">${err.message}</td></tr>`;
    }
    return;
  }

  await initIpFallback();
});
