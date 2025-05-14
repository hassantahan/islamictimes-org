const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

let currentCoords = null;
let lastMethod = {};
const PRAYER_ORDER = ["fajr","sunrise","zuhr","asr","sunset","maghrib","isha","midnight"];

function validateCoords(lat, lon) {
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function validateAngles(a) {
    return a >= 0 && a <= 90;
}

function fmtTime(iso) {
    if (iso === "Does not exist") {
        return iso;
    }
    if (!iso || typeof iso !== "string" || !iso.includes("T")) {
        return "Does not exist";
    }
    try {
        const [_, rest] = iso.split("T");
        const [h, m] = rest.split(".")[0].split(":");
        return `${h}:${m}`;
    } catch {
        return "";
    }
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function round(val, decimals = 6) {
    return parseFloat(val.toFixed(decimals));
}

function formatLongDate(dateString) { 
    if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return "Select a date"; 
    }
    const dateObj = new Date(dateString + 'T00:00:00');
    const dayOfWeek = dateObj.toLocaleDateString(undefined, { weekday: 'long' });
    const dayOfMonth = dateObj.toLocaleDateString(undefined, { day: 'numeric' });
    const monthName = dateObj.toLocaleDateString(undefined, { month: 'long' });
    const yearNum = dateObj.toLocaleDateString(undefined, { year: 'numeric' });
    return `${dayOfWeek}, ${dayOfMonth} of ${monthName}, ${yearNum}`;
}

function renderTable(json) {
    Object.entries(json).forEach(([key, obj]) => {
        if (key === "method") return;
        const cell = document.getElementById(`time-${key}`);
        if (cell) cell.textContent = fmtTime(obj.time);
    });
    const methodDisplayElem = $("#method-display-bottom");
    if (methodDisplayElem) {
        methodDisplayElem.textContent = json.method.name;
    }
    lastMethod = json.method;
}  

function setMap(lat,lon) {
    const z=13;
    $("#map").src = `https://www.openstreetmap.org/export/embed.html?`+
                    `bbox=${lon-0.05},${lat-0.03},${lon+0.05},${lat+0.03}`+
                    `&layer=mapnik&marker=${lat},${lon}`;
}

async function fetchPrayers() {
    show($("#spinner"));
    const spinTimeout = setTimeout(() => show($("#spinner")), 250);

    try {
        const selectedDate = $("#date-picker").value;
        if ($("#current-date-display") && selectedDate) {
             $("#current-date-display").textContent = formatLongDate(selectedDate);
        }

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
                date: selectedDate, 
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
        li.className="px-3 py-2 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer";
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
    if(!e.target.closest("#city") && !e.target.closest("#autocomplete-suggestions")) { 
        hide($("#autocomplete-suggestions"));
    }
});

// Modal open/close
$("#open-adv").onclick = () => {
    show($("#adv-modal"));
    $("#method").dispatchEvent(new Event("change"));
};
$("#close-adv").onclick  = () => hide($("#adv-modal"));

// GPS button with reverse-geocode
$("#use-gps").onclick = () => {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }
    navigator.geolocation.getCurrentPosition(async ({coords}) => {
      let lat = clamp(coords.latitude,  -90,  90);
      let lon = clamp(coords.longitude, -180, 180);
      lat = round(lat);
      lon = round(lon);
  
      currentCoords = { lat, lon };
      $("#lat").value  = lat;
      $("#lon").value  = lon;
  
      try {
        const rev = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
        ).then(r=>r.json());
        $("#city").value = rev.display_name || "";
      } catch (err) {
        console.warn("Reverse geocoding failed", err);
        $("#city").value = "Current Location"; 
      }
  
      setMap(lat, lon);
      await fetchPrayers();
    }, ()=>{alert("GPS permission denied or unavailable.");});
};

// manual form
$("#manual-form").onsubmit = async e => {
    e.preventDefault();
    let lat = parseFloat($("#lat").value);
    let lon = parseFloat($("#lon").value);
    if (isNaN(lat) || isNaN(lon) || !validateCoords(lat, lon)) { 
        alert("Enter valid coordinates.");
        return;
    }
    lat = clamp(lat, -90,  90);
    lon = clamp(lon, -180, 180);
    lat = round(lat);
    lon = round(lon);
    $("#lat").value = lat;
    $("#lon").value = lon;

    try {
        const rev = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
        ).then(r => r.json());
        $("#city").value = rev.display_name || "";
    } catch { /* quietly ignore if reverse fails */ }

    currentCoords = { lat, lon };
    setMap(lat, lon);
    await fetchPrayers();
};  

$("#method").addEventListener("change", () => {
    const isCustom = $("#method").value === "CUSTOM";
    $$("#fajr_angle, #maghrib_angle, #isha_angle")
      .forEach(el => isCustom ? show(el) : hide(el));
    if (isCustom) {
      $("#fajr_angle").value    = 15;
      $("#maghrib_angle").value = 0;
      $("#isha_angle").value    = 15;
    } else {
      $("#midnight").value = $("#method").value === "JAFARI" ? "jafari" : "standard";
    }
});

// On load
window.addEventListener("DOMContentLoaded", async () => {
    // Theme toggle logic
    const themeToggleButton = document.getElementById("theme-toggle");
    const htmlRootElement = document.documentElement; // This is the <html> element

    function applyVisualTheme(themeName) { // themeName is 'light' or 'dark'
        if (themeName === "dark") {
            htmlRootElement.classList.add("dark");
            if(themeToggleButton) themeToggleButton.textContent = "🌞"; 
        } else { // themeName === 'light'
            htmlRootElement.classList.remove("dark");
            if(themeToggleButton) themeToggleButton.textContent = "🌙"; 
        }
    }

    // Determine and apply initial theme
    const storedThemePreference = localStorage.getItem("theme");
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    
    let initialTheme = "light"; 
    if (storedThemePreference === "dark" || (!storedThemePreference && systemPrefersDark)) {
        initialTheme = "dark";
    }
    // If you want to default to light unless explicitly set or system is dark:
    // if (storedThemePreference) {
    //    initialTheme = storedThemePreference;
    // } else {
    //    initialTheme = systemPrefersDark ? "dark" : "light";
    // }

    applyVisualTheme(initialTheme);

    // Add click listener for theme toggle
    if(themeToggleButton) {
        themeToggleButton.addEventListener("click", () => {
            const newTheme = htmlRootElement.classList.contains("dark") ? "light" : "dark";
            applyVisualTheme(newTheme);
            localStorage.setItem("theme", newTheme);
        });
    }
    // End of theme toggle logic

    // Initialize date picker to today
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayISO = `${year}-${month}-${day}`;
    
    if ($("#date-picker")) {
        $("#date-picker").value = todayISO;
    }

    // Initial IP lookup + field population
    try {
        const ip = await fetch("https://ipapi.co/json/").then(r => r.json());
        currentCoords = { lat: round(ip.latitude), lon: round(ip.longitude) }; 

        $("#lat").value = currentCoords.lat;
        $("#lon").value = currentCoords.lon;
        $("#city").value = [ip.city, ip.region, ip.country_name].filter(Boolean).join(", ");

        setMap(currentCoords.lat, currentCoords.lon);
        await fetchPrayers(); 
    } catch(err) {
        console.warn("IP lookup failed.", err);
        currentCoords = null; 
        if ($("#current-date-display") && $("#date-picker")) {
             $("#current-date-display").textContent = formatLongDate($("#date-picker").value);
        }
        if (!$("#city").value) $("#city").value = "Location not set";
    }

    $("#compute-btn").addEventListener("click", async (e) => {
        e.preventDefault();
        if (currentCoords) { 
            await fetchPrayers();
        } else {
            alert("Please set a location first.");
        }
        hide($("#adv-modal")); 
    });

    if ($("#date-picker")) {
        $("#date-picker").addEventListener("change", async () => {
            if (currentCoords && typeof currentCoords.lat === 'number' && typeof currentCoords.lon === 'number') {
                await fetchPrayers(); 
            } else {
                const selectedDate = $("#date-picker").value;
                if ($("#current-date-display") && selectedDate) {
                    $("#current-date-display").textContent = formatLongDate(selectedDate);
                }
            }
        });
    }
});

[
    { sel: "#lat",   min: -90,  max:  90,  dec: 6 },
    { sel: "#lon",   min: -180, max: 180,  dec: 6 },
    { sel: "#fajr_angle",   min: 0, max: 90, dec: 1 },
    { sel: "#maghrib_angle",min: 0, max: 90, dec: 1 },
    { sel: "#isha_angle",   min: 0, max: 90, dec: 1 }
].forEach(({sel, min, max, dec}) => {
    const el = $(sel); 
    if (!el) return;
    el.addEventListener("blur", () => {
        let v = parseFloat(el.value);
        if (isNaN(v)) { 
          return;
        }
        v = clamp(v, min, max);
        v = round(v, dec);
        el.value = v;
    });
});