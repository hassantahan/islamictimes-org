const $  = sel => document.querySelector(sel);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

// Shared map-generation logic
async function generateMap() {
  const payload = {
    month:      +$("#month").value,
    year:       +$("#year").value,
    days:       +$("#days").value,
    criterion:  +$("#criterion").value,
    resolution: +$("#resolution").value
  };
  show($("#map-spinner"));
  try {
    const r = await fetch("/generate_map", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw await r.text();
    const {url} = await r.json();
    $("#map-output").src = url + "?t=" + Date.now();
  } catch (e) {
    console.error(e);
    alert("Failed to generate map.");
  } finally {
    hide($("#map-spinner"));
  }
}

// Fetch upcoming Hijri month/year and set controls
async function setUpcomingHijri() {
  const todayISO = new Date().toISOString().slice(0,10);
  try {
    const res = await fetch(`/upcoming_hijri?date=${todayISO}`);
    if (!res.ok) throw new Error("Bad response");
    const {month, year} = await res.json();
    $("#month").value = month;
    $("#year").value  = year;
  } catch (e) {
    console.error("Could not fetch upcoming Hijri:", e);
  }
}

// Wire up UI
window.addEventListener("DOMContentLoaded", async () => {
  await setUpcomingHijri();
  $("#days").value = "3";       // force default of 3 days
  await generateMap();
});

$("#upcoming-month").onclick = async () => {
  await setUpcomingHijri();
  await generateMap();
};

$("#create-map").onclick = generateMap;
