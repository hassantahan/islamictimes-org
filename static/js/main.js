const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

// theme toggle
const themeToggle = $("#theme-toggle");
function updateThemeIcon() {
  themeToggle.textContent =
    document.documentElement.classList.contains("dark") ? "🌞" : "🌙";
}
// init theme
if (localStorage.getItem("theme") === "light") {
  document.documentElement.classList.remove("dark");
} else {
  document.documentElement.classList.add("dark");
}
updateThemeIcon();
themeToggle.addEventListener("click", () => {
  document.documentElement.classList.toggle("dark");
  localStorage.setItem(
    "theme",
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  );
  updateThemeIcon();
});

let currentCoords = null;
let lastMethod = {};
const PRAYER_ORDER = ["fajr","sunrise","zuhr","asr","sunset","maghrib","isha","midnight"];
const prayerRowCache = {};

function validateCoords(lat, lon) {
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function validateAngles(a) {
    return a >= 0 && a <= 90;
}

function fmtTime(iso) {
    // 1) If we literally got our “Does not exist” sentinel, show it
    if (iso === "Does not exist") {
        return iso;
    }
    // 2) If it’s not a non‑empty string or missing the “T”, bail out
    if (!iso || typeof iso !== "string" || !iso.includes("T")) {
        return "Does not exist";
    }
    // 3) Safe parse: split out HH:MM and ignore the rest
    try {
        const [_, rest] = iso.split("T");
        const [h, m] = rest.split(".")[0].split(":");
        return `${h}:${m}`;
    } catch {
        // in case something still goes wrong
        return "";
    }
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}
  

function round(val, decimals = 6) {
    return parseFloat(val.toFixed(decimals));
}

function renderTable(json) {
    // update each prayer's time cell
    Object.entries(json).forEach(([key, obj]) => {
        if (key === "method") return;
        const cell = document.getElementById(`time-${key}`);
        if (cell) cell.textContent = fmtTime(obj.time);
    });

    // update method name header
    $("#method-name").textContent = json.method.name;
    lastMethod = json.method;
    // show($("#results"));
}  

function setMap(lat,lon) {
    const z=13;
    $("#map").src = `https://www.openstreetmap.org/export/embed.html?`+
                    `bbox=${lon-0.05},${lat-0.03},${lon+0.05},${lat+0.03}`+
                    `&layer=mapnik&marker=${lat},${lon}`;
}

async function fetchPrayers() {
    show($("#spinner"));
    // start spinner only if request lasts >150 ms
    const spinTimeout = setTimeout(() => show($("#spinner")), 250);

    try {
        const m = $("#method").value;
        const method = { 
            name: m,
            asr_type: $("#asr").value==="hanafi"?1:0,
            midnight_type: $("#midnight").value==="jafari"?1:0
        };
        if (m==="CUSTOM") {
            method.name = "custom";
            method.fajr_angle    = parseFloat($("#fajr_angle").value)||undefined;
            method.maghrib_angle = parseFloat($("#maghrib_angle").value)||undefined;
            method.isha_angle    = parseFloat($("#isha_angle").value)||undefined;
        }
        const res = await fetch("/prayer_times", {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({
                lat: currentCoords.lat,
                lon: currentCoords.lon,
                date: new Date().toISOString().slice(0,10),
                method
            })
        });
        if (!res.ok) throw await res.text();
        const json = await res.json();
        renderTable(json);
    } catch(e) {
        console.error(e);
        alert("Failed to load prayer times.");
    } finally {
        clearTimeout(spinTimeout);
        hide($("#spinner"));
    }
}

// Autocomplete
let acT=null;
$("#city").addEventListener("input",()=>{
    clearTimeout(acT);
    acT = setTimeout(async()=>{
    const q=$("#city").value.trim();
    if(!q) return hide($("#autocomplete-suggestions"));
    const list = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`
    ).then(r=>r.json());
    const ul=$("#autocomplete-suggestions");
    ul.innerHTML="";
    list.forEach(it=>{
        const li=document.createElement("li");
        li.textContent=it.display_name;
        li.className="px-3 py-2 hover:bg-gray-200 cursor-pointer";
        li.onclick=async()=>{
        $("#city").value=it.display_name;
        $("#lat").value=it.lat;
        $("#lon").value=it.lon;
        currentCoords={lat:parseFloat(it.lat),lon:parseFloat(it.lon)};
        setMap(currentCoords.lat,currentCoords.lon);
        hide(ul);
        await fetchPrayers();
        };
        ul.append(li);
    });
    show(ul);
    }, 300);
});
document.addEventListener("click",e=>{
    if(!e.target.closest("#city")) hide($("#autocomplete-suggestions"));
});

// Modal open/close
$("#open-adv").onclick = () => {
    show($("#adv-modal"));
    // force the #method change handler to run and prefill if CUSTOM
    $("#method").dispatchEvent(new Event("change"));
};
$("#close-adv").onclick  = () => hide($("#adv-modal"));

// GPS button with reverse-geocode
$("#use-gps").onclick = () => {
    navigator.geolocation.getCurrentPosition(async ({coords}) => {
      // clamp & round
      let lat = clamp(coords.latitude,  -90,  90);
      let lon = clamp(coords.longitude, -180, 180);
      lat = round(lat);
      lon = round(lon);
  
      currentCoords = { lat, lon };
      $("#lat").value  = lat;
      $("#lon").value  = lon;
  
      // now reverse-geocode, map, fetch
      const rev = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
      ).then(r=>r.json());
      $("#city").value = rev.display_name || "";
  
      setMap(lat, lon);
      await fetchPrayers();
    }, ()=>alert("GPS denied."));
};

// manual form
$("#manual-form").onsubmit = async e => {
    e.preventDefault();

    // parse
    let lat = parseFloat($("#lat").value);
    let lon = parseFloat($("#lon").value);
    if (isNaN(lat) || isNaN(lon)) return alert("Enter valid coordinates.");

    // clamp to valid range
    lat = clamp(lat, -90,  90);
    lon = clamp(lon, -180, 180);

    // round to 6 decimals
    lat = round(lat);
    lon = round(lon);

    // write back into inputs so user sees it
    $("#lat").value = lat;
    $("#lon").value = lon;

    // reverse-geocode to update the city/address field
    try {
        const rev = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
        ).then(r => r.json());
        $("#city").value = rev.display_name || "";
    } catch {
        // quietly ignore if reverse fails
    }

    currentCoords = { lat, lon };
    setMap(lat, lon);
    await fetchPrayers();
};  

$("#method").addEventListener("change", () => {
    const isCustom = $("#method").value === "CUSTOM";
  
    // show or hide the three inputs
    $$("#fajr_angle, #maghrib_angle, #isha_angle")
      .forEach(el => isCustom ? show(el) : hide(el));
  
    if (isCustom) {
      // hard‑coded defaults
      $("#fajr_angle").value    = 15;
      $("#maghrib_angle").value = 0;
      $("#isha_angle").value    = 15;
    } else {
      // reset midnight rule for built‑ins
      $("#midnight").value = $("#method").value === "JAFARI" ? "jafari" : "standard";
    }
});


// On load
window.addEventListener("DOMContentLoaded", async () => {
    // Initial IP lookup + field population
    try {
        const ip = await fetch("https://ipapi.co/json/").then(r=>r.json());
        currentCoords={lat:ip.latitude,lon:ip.longitude};

        $("#lat").value=ip.latitude.toFixed(6);
        $("#lon").value=ip.longitude.toFixed(6);
        $("#city").value=[ip.city,ip.region,ip.country_name]
                        .filter(Boolean)
                        .join(", ");

        setMap(ip.latitude,ip.longitude);
        await fetchPrayers();
    } catch {
        alert("IP lookup failed.");
    }

    // Restore the Compute‑button click handler
    $("#compute-btn").addEventListener("click", async (e) => {
        e.preventDefault();
        await fetchPrayers();
    });
});

// Auto-clamp & round on blur
[
    { sel: "#lat",   min: -90,  max:  90,  dec: 6 },
    { sel: "#lon",   min: -180, max: 180,  dec: 6 },
    { sel: "#fajr_angle",   min: 0, max: 90, dec: 1 },
    { sel: "#maghrib_angle",min: 0, max: 90, dec: 1 },
    { sel: "#isha_angle",   min: 0, max: 90, dec: 1 }
].forEach(({sel, min, max, dec}) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener("blur", () => {
        let v = parseFloat(el.value);
        if (isNaN(v)) return;
        v = clamp(v, min, max);
        v = round(v, dec);
        el.value = v;
    });
});
  