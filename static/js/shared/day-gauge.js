import { civilDate, formatRange, formatTime, localISO, nextDayMarker, PRAYERS, setupTimetableNote } from "./timetable.js";

const gaugeSignatures = new WeakMap();

export function highlightDayGauge(gauge, key) {
  gauge.dataset.highlightedPrayer = key;
  for (const band of gauge.querySelectorAll(".gauge-band")) {
    band.classList.toggle("is-highlighted", band.dataset.prayers.split(" ").includes(key));
  }
}

function makeBand({ kind, from, to, keys, name, time, estimated }, index, gauge) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gauge-band gauge-" + kind;
  button.dataset.prayers = keys.join(" ");
  button.style.insetInlineStart = from + "%";
  if (to !== null) button.style.insetInlineEnd = (100 - to) + "%";
  button.setAttribute("aria-label", name + ", " + (estimated ? "estimated " : "") + time);
  button.setAttribute("aria-expanded", "false");
  const id = "gauge-note-" + index;
  button.setAttribute("popovertarget", id);

  const note = document.createElement("div");
  note.id = id;
  note.className = "timetable-note gauge-note";
  note.setAttribute("popover", "auto");
  const heading = document.createElement("h3");
  heading.textContent = name;
  const reading = document.createElement("p");
  reading.textContent = (estimated ? "≈ " : "") + time;
  note.append(heading, reading);
  setupTimetableNote(button, note, { center: true, keepClear: gauge });
  return [button, note];
}

export function renderDayGauge(gauge, date, timeZone, now, schedule, currentName, fadilah) {
  const clock = new Intl.DateTimeFormat("en", {
    timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  function position(instant) {
    const day = localISO(new Date(instant), timeZone);
    if (day < date) return 0;
    if (day > date) return 100;
    const [hour, minute, second] = clock.format(instant).split(":").map(Number);
    return (hour * 3600 + minute * 60 + second) / 86400 * 100;
  }

  const displayTime = (time) => formatTime(date + "T" + time);
  const clockLabels = ["00:00", "06:00", "12:00", "18:00", "00:00"].map(displayTime);
  const bands = [];
  const boundaries = new Set();
  function addBand(kind, start, end, keys, estimated = false) {
    const from = position(start);
    const to = end === null ? null : position(end);
    if (to !== null ? to <= from : from === 100) return;
    const name = keys.map((key) => PRAYERS[key]).join(" & ") + (kind === "period" ? "" : " faḍīlah");
    const time = end === null ? "Starts " + displayTime(clock.format(start)) : formatRange({
      start: date + "T" + clock.format(start), end: date + "T" + clock.format(end),
    });
    bands.push({ kind, from, to, keys, name, time, estimated });
    if (kind === "period") {
      boundaries.add(from);
      boundaries.add(to);
    }
  }

  // A reminder for a preferred window does not end the preceding prayer period.
  const prayers = schedule.filter(({ preferredWindow }) => !preferredWindow);
  prayers.forEach((prayer, index) => {
    const next = prayers[index + 1]?.when ?? Infinity;
    const end = Math.min(Number.isFinite(prayer.ends) ? prayer.ends : Infinity, next);
    if (!Number.isFinite(end) || end <= prayer.when) return;
    const keys = prayer.sharedWith ? [prayer.key, prayer.sharedWith] : [prayer.key];
    addBand("period", prayer.when, end, keys);
  });

  const preferred = {};
  for (const [key, window] of Object.entries(fadilah ?? {})) {
    const start = Date.parse(window.start);
    if (!Number.isFinite(start)) continue;
    if (key === "fajr" && window.end === null) {
      addBand("preferred-start", start, null, [key]);
      continue;
    }
    const end = Date.parse(window.end);
    if (!Number.isFinite(end) || end <= start) continue;
    preferred[key] = { start, end };
    addBand("preferred", start, end, [key], window.estimated);
  }
  const transitions = [];
  if (preferred.zuhr && preferred.asr) {
    const start = Math.max(preferred.zuhr.start, preferred.asr.start);
    const end = Math.min(preferred.zuhr.end, preferred.asr.end);
    if (start < end) {
      addBand("preferred-overlap", start, end, ["zuhr", "asr"]);
      transitions.push((position(start) + position(end)) / 2);
    }
  }
  if (preferred.maghrib && preferred.isha) transitions.push(position(preferred.isha.start));

  // Update only the current-time indicator on a clock tick so open notes and focus survive.
  const signature = JSON.stringify([clockLabels, bands, transitions]);
  if (gaugeSignatures.get(gauge) !== signature) {
    gaugeSignatures.set(gauge, signature);
    gauge.setAttribute("role", "group");
    gauge.querySelector(".gauge-track").removeAttribute("aria-hidden");
    const contents = bands.sort((left, right) => left.from - right.from).flatMap((band, index) => makeBand(band, index, gauge));
    for (const at of new Set([...boundaries, ...transitions])) {
      if (at === 0 || at === 100) continue;
      const tick = document.createElement("span");
      tick.className = "gauge-tick";
      if (!boundaries.has(at)) tick.classList.add("gauge-preferred-tick");
      tick.style.insetInlineStart = at + "%";
      contents.push(tick);
    }
    gauge.querySelector(".gauge-periods").replaceChildren(...contents);
    const labels = clockLabels.map((time) => {
      const label = document.createElement("span");
      label.textContent = time;
      return label;
    });
    labels.at(-1).append(nextDayMarker());
    gauge.querySelector(".gauge-labels").replaceChildren(...labels);
    highlightDayGauge(gauge, gauge.dataset.highlightedPrayer ?? "");
  }
  const marker = gauge.querySelector(".gauge-now");
  marker.hidden = now === null;
  if (marker.hidden) {
    gauge.setAttribute("aria-label", "Prayer timeline for " + civilDate(date, { dateStyle: "long" }));
  } else {
    marker.style.insetInlineStart = position(now) + "%";
    gauge.setAttribute("aria-label", "Prayer timeline. Local time " + displayTime(clock.format(now)) + ". " + currentName + ".");
  }
}
