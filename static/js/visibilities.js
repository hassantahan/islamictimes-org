// Shortcuts
const $  = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

// Hijri months in numerical order
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
  "Dhū al-Ḥijjah"
];

// Helpers for validation & rounding
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function round(v, dec = 6)  { return parseFloat(v.toFixed(dec)); }

let currentCoords = null;

// ─── Fetch upcoming Hijri month & year ─────────────────────────────────────
async function getUpcomingHijri() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const res = await fetch(`/upcoming_hijri?date=${todayISO}`);
  if (!res.ok) throw new Error("Failed to fetch upcoming Hijri");
  return res.json(); // { month: "<Name>", year: <Number> }
}

// ─── Build the “Month” & “Year” dropdowns and display the map ─────────────────
async function buildSelects() {
  // 1. Fetch index of all precomputed maps
  const data = await fetch("/maps_index").then(r => r.json());
  const availableMonths = new Set(data.map(e => e.month));
  const availableYears  = Array.from(new Set(data.map(e => e.year))).sort((a,b)=>a-b);

  // 2. Populate “Month” <select> in Hijri numerical order
  const monthSel = $("#month-select");
  HIJRI_MONTHS.forEach(mon => {
    if (availableMonths.has(mon)) {
      const opt = document.createElement("option");
      opt.value = mon;
      opt.textContent = mon;
      monthSel.append(opt);
    }
  });

  // 3. Populate “Year” <select> ascending
  const yearSel = $("#year-select");
  availableYears.forEach(yr => {
    const opt = document.createElement("option");
    opt.value = yr;
    opt.textContent = yr;
    yearSel.append(opt);
  });

  // 4. Pre-select upcoming Hijri if present in our data
  try {
    const { month: upM, year: upY } = await getUpcomingHijri();
    if (availableMonths.has(upM)) monthSel.value = upM;
    if (availableYears.includes(upY)) yearSel.value  = upY;
  } catch {
    // fallback: leave first options
  }

  // 5. Display the correct visibility‐map under the large map
  showMap(data);

  // 6. Update the large map whenever month or year changes
  monthSel.onchange = () => {
    showMap(data);
    fetchVisibilities();
  };
  yearSel.onchange = () => {
    showMap(data);
    fetchVisibilities();
  };
}

// ─── Display the big static visibility‐map based on month+year ─────────────────
function showMap(indexData) {
  const selMonth = $("#month-select").value;
  const selYear  = parseInt($("#year-select").value,10);

  // Find the entry that matches both month & year
  const entry = indexData.find(e => e.month === selMonth && e.year === selYear);
  if (entry) {
    $("#map-output").src = `https://islamictimes-maps.onrender.com/${entry.file}`;
  } else {
    $("#map-output").src = "/static/img/not-found.png";
  }
}

// ─── Autocomplete for “City” (Nominatim) ─────────────────────────────────────
let acTimeout = null;
$("#city").addEventListener("input", () => {
  clearTimeout(acTimeout);
  acTimeout = setTimeout(async () => {
    const q = $("#city").value.trim();
    if (!q) return hide($("#autocomplete-suggestions"));

    const list = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`
    ).then(r => r.json());

    const ul = $("#autocomplete-suggestions");
    ul.innerHTML = "";
    list.forEach(it => {
      const li = document.createElement("li");
      li.textContent = it.display_name;
      li.className = "px-3 py-2 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer";
      li.onclick = () => {
        $("#city").value = it.display_name;
        $("#lat").value  = it.lat;
        $("#lon").value  = it.lon;
        currentCoords = { lat: parseFloat(it.lat), lon: parseFloat(it.lon) };
        setSmallMap(it.lat, it.lon);
        hide(ul);
        fetchVisibilities();   // immediately compute visibilities
      };
      ul.append(li);
    });
    show(ul);
  }, 300);
});
document.addEventListener("click", e => {
  if (!e.target.closest("#city") && !e.target.closest("#autocomplete-suggestions")) {
    hide($("#autocomplete-suggestions"));
  }
});

// ─── Small embedded OpenStreetMap iframe for the calculator ─────────────────
function setSmallMap(lat, lon) {
  const z = 13;
  $("#map").src =
    `https://www.openstreetmap.org/export/embed.html?bbox=${lon-0.05},${lat-0.03},${lon+0.05},${lat+0.03}` +
    `&layer=mapnik&marker=${lat},${lon}`;
}

// ─── “Use GPS” button: get accurate coords and compute visibility ───────────────
$("#use-gps").onclick = () => {
  if (!navigator.geolocation) {
    alert("Geolocation not supported.");
    return;
  }
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    let lat = round(clamp(coords.latitude,  -90,  90));
    let lon = round(clamp(coords.longitude, -180, 180));
    currentCoords = { lat, lon };
    $("#lat").value = lat;
    $("#lon").value = lon;
    try {
      const rev = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
      ).then(r => r.json());
      $("#city").value = rev.display_name || "";
    } catch { /* ignore */ }
    setSmallMap(lat, lon);
    fetchVisibilities();
  }, () => alert("GPS unavailable or permission denied."));
};

// ─── “Use Manual Location” button: read lat/lon fields and compute visibility ───
$("#use-manual").onclick = () => {
  let lat = parseFloat($("#lat").value);
  let lon = parseFloat($("#lon").value);
  if (isNaN(lat) || isNaN(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    alert("Enter valid coordinates.");
    return;
  }
  lat = round(lat);
  lon = round(lon);
  currentCoords = { lat, lon };
  setSmallMap(lat, lon);
  fetchVisibilities();
};


// ─── Fetch visibilities from Flask and render as table ─────────────────────────
async function fetchVisibilities() {
  if (!currentCoords) return;
  show($("#map-spinner"));

  // Include the selected hijri month & year in the payload:
  const payload = {
    lat: currentCoords.lat,
    lon: currentCoords.lon,
    hijri_month: parseInt(HIJRI_MONTHS.indexOf($("#month-select").value) + 1, 10),
    hijri_year:  parseInt($("#year-select").value, 10)
  };

  try {
    const res = await fetch("/vis_calc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt);
    }
    const data = await res.json();
    renderVisTable(data);
  } catch (e) {
    console.error(e);
    $("#vis-body").innerHTML = `
      <tr><td colspan="4" class="px-4 py-2 text-red-500">Error: ${e.message}</td></tr>
    `;
    $("#vis-criterion").textContent = "";  // clear criterion if error
  } finally {
    hide($("#map-spinner"));
  }
}

// ─── Build the table rows from the JSON response ───────────────────────────────
function renderVisTable({ criterion, entries }) {
  const tbody = $("#vis-body");
  tbody.innerHTML = ""; // clear previous rows

  // 1) Inject the criterion line below the table
  $("#vis-criterion").textContent = `Criterion: ${criterion}`;

  // 2) Render one row per entry
  entries.forEach(({ datetime, q, category, description }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-2">${datetime}</td>
      <td class="px-4 py-2">${q}</td>
      <td class="px-4 py-2">${category}</td>
      <td class="px-4 py-2">${description}</td>
    `;
    tbody.append(tr);
  });
}

// ─── Initial setup on page load ───────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  // 1) Build the big map selector
  await buildSelects();

  // 2) Pre-fill location from IP (fallback if GPS/manual not used)
  try {
    const ip = await fetch("https://ipapi.co/json/").then(r => r.json());
    const lat = round(ip.latitude);
    const lon = round(ip.longitude);
    currentCoords = { lat, lon };
    $("#lat").value = lat;
    $("#lon").value = lon;
    $("#city").value = [ip.city, ip.region, ip.country_name].filter(Boolean).join(", ");
    setSmallMap(lat, lon);
    fetchVisibilities();   // immediately compute for IP-based location
  } catch {
    // if IP lookup fails, user must use GPS or manual
  }
});
