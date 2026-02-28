const $ = (selector) => document.querySelector(selector);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

const state = {
  coords: null,
  lastMethod: null,
  lastPresetMethodKey: null,
  midnightManuallySet: false,
};

const PRESET_CUSTOM_ANGLE_PREFILL = {
  ISNA: { fajr: 15, maghrib: 0, isha: 15 },
  MWL: { fajr: 18, maghrib: 0, isha: 17 },
  EGYPT: { fajr: 19.5, maghrib: 0, isha: 17.5 },
  MAKKAH: { fajr: 18.5, maghrib: 0, isha: 15 },
  KARACHI: { fajr: 18, maghrib: 0, isha: 18 },
  TEHRAN: { fajr: 17.7, maghrib: 4.5, isha: 14 },
  JAFARI: { fajr: 16, maghrib: 4, isha: 14 },
};

function normalizeMethodKey(rawValue) {
  const methodKey = String(rawValue || "").trim().toUpperCase();
  return methodKey || null;
}

function isCustomMethodKey(methodKey) {
  return methodKey === "CUSTOM";
}

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

function setMap(lat, lon) {
  const map = $("#map");
  if (!map) return;

  map.src =
    `https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.05},${lat - 0.03},${lon + 0.05},${lat + 0.03}` +
    `&layer=mapnik&marker=${lat},${lon}`;
}

function formatDisplayDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(undefined, { weekday: "long" });
  const month = d.toLocaleDateString(undefined, { month: "long" });
  const dayNum = d.toLocaleDateString(undefined, { day: "numeric" });
  const year = d.toLocaleDateString(undefined, { year: "numeric" });
  return `${day}, ${dayNum} ${month} ${year}`;
}

function formatPrayerTime(isoValue) {
  if (!isoValue || isoValue === "Does not exist") return "Does not exist";
  if (typeof isoValue !== "string" || !isoValue.includes("T")) return "Does not exist";

  const [_, time] = isoValue.split("T");
  const [h = "--", m = "--"] = (time || "").split(".")[0].split(":");
  return `${h}:${m}`;
}

function renderQibla(qibla) {
  const needle = $("#qibla-needle");
  const angleEl = $("#qibla-angle");
  const cardinalEl = $("#qibla-cardinal");
  const distanceEl = $("#qibla-distance");

  if (!needle || !angleEl || !cardinalEl || !distanceEl) return;

  if (!qibla || typeof qibla.angle_decimal !== "number") {
    needle.style.transform = "translate(-50%, -100%) rotate(0deg)";
    angleEl.textContent = "Unavailable";
    cardinalEl.textContent = "—";
    distanceEl.textContent = "Unavailable";
    return;
  }

  const angle = Number(qibla.angle_decimal);
  needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
  angleEl.textContent = `${angle.toFixed(1)}° (${qibla.cardinal || "—"})`;
  cardinalEl.textContent = qibla.cardinal || "—";

  const km = typeof qibla.distance_km === "number" ? qibla.distance_km.toFixed(1) : "—";
  const mi = typeof qibla.distance_mi === "number" ? qibla.distance_mi.toFixed(1) : "—";
  distanceEl.textContent = `${km} km (${mi} mi)`;
}

function getAngleDecimalValue(angleValue) {
  if (typeof angleValue === "number" && Number.isFinite(angleValue)) return angleValue;
  if (angleValue && typeof angleValue === "object") {
    return getAngleDecimalValue(angleValue.decimal);
  }
  const parsed = Number(angleValue);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function sanitizeCustomAngle(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 90) return null;
  return Math.round(value * 10) / 10;
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

function readMethodPayload() {
  const methodSelect = $("#method");
  const asrSelect = $("#asr");
  const midnightSelect = $("#midnight");
  const fajrInput = $("#fajr_angle");
  const maghribInput = $("#maghrib_angle");
  const ishaInput = $("#isha_angle");

  if (!methodSelect || !asrSelect || !midnightSelect) {
    return { name: "ISNA" };
  }

  const methodName = methodSelect.value;
  const method = {
    name: methodName,
    asr_type: asrSelect.value === "hanafi" ? 1 : 0,
    midnight_type: midnightSelect.value === "jafari" ? 1 : 0,
  };

  if (methodName === "CUSTOM") {
    method.name = "custom";
    if (fajrInput?.value) method.fajr_angle = Number.parseFloat(fajrInput.value);
    if (maghribInput?.value) method.maghrib_angle = Number.parseFloat(maghribInput.value);
    if (ishaInput?.value) method.isha_angle = Number.parseFloat(ishaInput.value);
  }

  return method;
}

function renderPrayerTable(payload) {
  const order = ["fajr", "sunrise", "zuhr", "asr", "sunset", "maghrib", "isha", "midnight"];
  for (const key of order) {
    const cell = document.getElementById(`time-${key}`);
    if (cell) cell.textContent = formatPrayerTime(payload?.[key]?.time);
  }

  const methodDisplay = $("#method-display-bottom");
  if (payload?.method) {
    state.lastMethod = payload.method;
    const resolvedMethodKey = normalizeMethodKey(payload.method.name);
    if (resolvedMethodKey && !isCustomMethodKey(resolvedMethodKey)) {
      state.lastPresetMethodKey = resolvedMethodKey;
    }
  }
  if (methodDisplay && payload?.method?.name) methodDisplay.textContent = payload.method.name;

  const hijriCell = $("#time-hijri");
  if (hijriCell && payload?.hijri) {
    const h = payload.hijri;
    hijriCell.textContent = `${h.day} ${h.month_name} ${h.year}`;
  }

  renderQibla(payload?.qibla);

  const alertEl = $("#lat-alert");
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const hasExtremeWarning = warnings.some((w) => w.includes("Extreme latitude warning"));
  if (hasExtremeWarning) show(alertEl); else hide(alertEl);
}

async function fetchPrayers() {
  if (!state.coords) return;

  const spinner = $("#spinner");
  show(spinner);

  try {
    const datePicker = $("#date-picker");
    const response = await fetch("/prayer_times", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: state.coords.lat,
        lon: state.coords.lon,
        date: datePicker?.value,
        method: readMethodPayload(),
      }),
    });

    const payload = await parseApiResponse(response);
    renderPrayerTable(payload);
  } catch (err) {
    alert(err.message || "Failed to load prayer times.");
  } finally {
    hide(spinner);
  }
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

            setMap(lat, lon);
            hide(suggestions);
            await fetchPrayers();
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

function initManualForm() {
  const form = $("#manual-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const latInput = $("#lat");
    const lonInput = $("#lon");

    let lat = Number.parseFloat(latInput.value);
    let lon = Number.parseFloat(lonInput.value);

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      alert("Please enter valid coordinates.");
      return;
    }

    lat = round(clamp(lat, -90, 90));
    lon = round(clamp(lon, -180, 180));

    state.coords = { lat, lon };
    latInput.value = lat;
    lonInput.value = lon;

    try {
      const reverse = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
      ).then((r) => r.json());
      if (reverse?.display_name) $("#city").value = reverse.display_name;
    } catch {
      // non-blocking
    }

    setMap(lat, lon);
    await fetchPrayers();
  });
}

function initGpsButton() {
  const gpsButton = $("#use-gps");
  if (!gpsButton) return;

  gpsButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
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

        setMap(lat, lon);
        await fetchPrayers();
      },
      () => alert("GPS permission denied or unavailable.")
    );
  });
}

function initAdvancedSettingsModal() {
  const openButton = $("#open-adv");
  const closeButton = $("#close-adv");
  const modal = $("#adv-modal");
  const methodSelect = $("#method");
  const midnightSelect = $("#midnight");
  const computeButton = $("#compute-btn");

  if (!modal || !methodSelect) return;

  const syncMethodFields = () => {
    const custom = isCustomMethodKey(normalizeMethodKey(methodSelect.value));
    ["#fajr_angle", "#maghrib_angle", "#isha_angle"].forEach((selector) => {
      const input = $(selector);
      if (!input) return;
      if (custom) show(input); else hide(input);
    });

    const midnight = $("#midnight");
    if (custom) {
      const fallback = { fajr: 15, maghrib: 0, isha: 15 };
      const previous = state.lastMethod || {};
      const presetMethodKey = state.lastPresetMethodKey || "ISNA";
      const preset = PRESET_CUSTOM_ANGLE_PREFILL[presetMethodKey] || PRESET_CUSTOM_ANGLE_PREFILL.ISNA;
      const previousMethodKey = normalizeMethodKey(previous?.name);
      const usePreviousAngles = !previousMethodKey
        || isCustomMethodKey(previousMethodKey)
        || previousMethodKey === presetMethodKey;

      const fajrInput = $("#fajr_angle");
      const maghribInput = $("#maghrib_angle");
      const ishaInput = $("#isha_angle");

      const lastFajr = usePreviousAngles
        ? sanitizeCustomAngle(getAngleDecimalValue(previous?.fajr_angle))
        : null;
      const lastMaghrib = usePreviousAngles
        ? sanitizeCustomAngle(getAngleDecimalValue(previous?.maghrib_angle))
        : null;
      const lastIsha = usePreviousAngles
        ? sanitizeCustomAngle(getAngleDecimalValue(previous?.isha_angle))
        : null;

      const nextFajr = lastFajr ?? preset?.fajr ?? fallback.fajr;
      const nextMaghrib = lastMaghrib ?? preset?.maghrib ?? fallback.maghrib;
      const nextIsha = lastIsha ?? preset?.isha ?? fallback.isha;

      if (fajrInput) fajrInput.value = String(nextFajr);
      if (maghribInput) maghribInput.value = String(nextMaghrib);
      if (ishaInput) ishaInput.value = String(nextIsha);
    } else if (midnight && !state.midnightManuallySet) {
      const methodKey = normalizeMethodKey(methodSelect.value);
      midnight.value = methodKey === "JAFARI" || methodKey === "TEHRAN" ? "jafari" : "standard";
    }
  };

  midnightSelect?.addEventListener("change", () => {
    state.midnightManuallySet = true;
  });

  methodSelect.addEventListener("change", () => {
    const methodKey = normalizeMethodKey(methodSelect.value);
    if (methodKey && !isCustomMethodKey(methodKey)) {
      state.lastPresetMethodKey = methodKey;
    }
    syncMethodFields();
  });

  const initialMethodKey = normalizeMethodKey(methodSelect.value);
  if (initialMethodKey && !isCustomMethodKey(initialMethodKey)) {
    state.lastPresetMethodKey = initialMethodKey;
  }

  syncMethodFields();

  openButton?.addEventListener("click", () => show(modal));
  closeButton?.addEventListener("click", () => hide(modal));
  computeButton?.addEventListener("click", async () => {
    await fetchPrayers();
    hide(modal);
  });
}

function initDatePicker() {
  const datePicker = $("#date-picker");
  const dateDisplay = $("#current-date-display");
  if (!datePicker) return;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  datePicker.value = `${yyyy}-${mm}-${dd}`;

  if (dateDisplay) dateDisplay.textContent = formatDisplayDate(datePicker.value);

  datePicker.addEventListener("change", async () => {
    if (dateDisplay) dateDisplay.textContent = formatDisplayDate(datePicker.value);
    await fetchPrayers();
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

    setMap(lat, lon);
    await fetchPrayers();
  } catch {
    // user can still set location manually or via GPS
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  if (!$("#manual-form")) return;

  initCoordinateInputNormalization();
  initDatePicker();
  initAutocomplete();
  initManualForm();
  initGpsButton();
  initAdvancedSettingsModal();
  await initIpFallback();
});
