const $ = sel => document.querySelector(sel);

// Fixed, numerical order of Hijri months
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

// Fetch the upcoming Hijri date from the server
async function getUpcomingHijri() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const res = await fetch(`/upcoming_hijri?date=${todayISO}`);
  if (!res.ok) throw new Error("Failed to fetch upcoming Hijri");
  return res.json(); // { month: "<Name>", year: <Number> }
}

// Populate separate month + year <select>s and display the correct image
async function buildSelects() {
  // 1) Fetch the precomputed‐maps index
  const data = await fetch("/maps_index").then(r => r.json());

  // 2) Derive unique months & years from the index
  const availableMonthsSet = new Set(data.map(e => e.month));
  const availableYearsSet  = new Set(data.map(e => e.year));

  // 3) Populate the month <select> in numerical order
  const monthSel = $("#month-select");
  HIJRI_MONTHS.forEach(monName => {
    if (availableMonthsSet.has(monName)) {
      const opt = document.createElement("option");
      opt.value = monName;
      opt.textContent = monName;
      monthSel.append(opt);
    }
  });

  // 4) Populate the year <select> in ascending order
  const yearSel = $("#year-select");
  Array.from(availableYearsSet)
       .sort((a, b) => a - b)
       .forEach(yr => {
         const opt = document.createElement("option");
         opt.value = yr;
         opt.textContent = yr;
         yearSel.append(opt);
       });

  // 5) Attempt to pre-select the upcoming Hijri month/year
  //    But only if that exact combination exists in our index.
  try {
    const { month: upMonth, year: upYear } = await getUpcomingHijri();

    // If that month is available, select it; otherwise stay at first option
    if (availableMonthsSet.has(upMonth)) {
      monthSel.value = upMonth;
    } else {
      monthSel.value = monthSel.options[0].value;
    }

    // If that year is available, select it; otherwise stay at first option
    if (availableYearsSet.has(upYear)) {
      yearSel.value = upYear;
    } else {
      yearSel.value = yearSel.options[0].value;
    }
  } catch (err) {
    console.error("Could not fetch upcoming Hijri:", err);
    // Fallback: leave both selects at their first options
    monthSel.value = monthSel.options[0].value;
    yearSel.value  = yearSel.options[0].value;
  }

  // 6) Immediately show the map for the chosen combination
  showMap(data);

  // 7) When the user changes either dropdown, update the displayed image
  monthSel.onchange = () => showMap(data);
  yearSel.onchange  = () => showMap(data);
}

// Find and display the image matching the selected month+year
function showMap(indexData) {
  const selMonth = $("#month-select").value;
  const selYear  = parseInt($("#year-select").value, 10);

  // Look for an index entry whose month AND year match
  const entry = indexData.find(item =>
    item.month === selMonth && item.year === selYear
  );

  if (entry) {
    $("#map-output").src =
      `https://islamictimes-maps.onrender.com/${entry.file}`;
  } else {
    // If no match, fall back to a “not found” placeholder
    $("#map-output").src = "/static/img/not-found.png";
  }
}

window.addEventListener("DOMContentLoaded", buildSelects);