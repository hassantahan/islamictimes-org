import { rememberCity, setupLocation } from "./shared/location.js";
import { getPreferences, remembersPreferences, updatePreferences } from "./shared/preferences.js";
import { apiResponse, applySelect, civilDate, formatTime, localISO, PRAYERS } from "./shared/timetable.js";

const byId = (id) => document.getElementById(id);
const form = byId("calendar-form");
const locationFields = setupLocation(form);
const start = byId("calendar-start");
const end = byId("calendar-end");
const profileSelect = byId("profile-select");
const profileEditor = byId("profile-editor");
const profileName = byId("profile-name");
const method = byId("calendar-method");
const asr = byId("calendar-asr");
const offsets = [...form.querySelectorAll("[data-offset]")];
const profileStatus = byId("profile-status");
const saveProfile = byId("save-profile");
const deleteProfile = byId("delete-profile");
const buttons = [...document.querySelectorAll("[data-download]")];
const generate = byId("generate-calendar");
const status = byId("calendar-status");
const metadata = byId("calendar-meta");
const wrapper = byId("calendar-table-wrapper");
const scrollHint = byId("calendar-scroll-hint");
const legend = byId("calendar-legend");
const tbody = document.querySelector("#calendar-table tbody");
let profiles = [];
let result;
let request;
let snapshot;
let downloadPending = false;

start.value = localISO().slice(0, 7) + "-01";
const endOfMonth = new Date();
endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0);
end.value = localISO(endOfMonth);

function syncProfileOptions(selected = profileSelect.value) {
  profiles = getPreferences().profiles.filter((profile) => typeof profile?.id === "string" && typeof profile.name === "string");
  profileSelect.replaceChildren(new Option("No saved profile", ""));
  for (const profile of profiles) profileSelect.add(new Option(profile.name, profile.id));
  applySelect(profileSelect, selected);
  deleteProfile.hidden = !profileSelect.value;
  saveProfile.textContent = profileSelect.value ? "Update profile" : "Save profile";
}

function applyProfile() {
  const profile = profiles.find(({ id }) => id === profileSelect.value);
  const setting = profile || getPreferences().calendar;
  applySelect(method, "ISNA");
  applySelect(method, setting?.method ?? getPreferences().daily?.name);
  applySelect(asr, setting?.asr_type ?? getPreferences().daily?.asr_type ?? 0);
  profileName.value = profile?.name || "";
  for (const input of offsets) input.value = profile?.offset_minutes?.[input.dataset.offset] ?? 0;
  profileStatus.textContent = "";
  if (profile) profileEditor.open = true;
}

function readProfile(requireName) {
  const name = profileName.value.trim();
  if (requireName && !name) {
    profileName.focus();
    throw new Error("Enter a name for this mosque profile.");
  }
  const offsetMinutes = {};
  for (const input of offsets) {
    if (!input.reportValidity()) throw new Error("Offsets must be whole minutes from −180 to 180.");
    if (input.valueAsNumber) offsetMinutes[input.dataset.offset] = input.valueAsNumber;
  }
  return { name: name || "Islamic Times", offset_minutes: offsetMinutes };
}

function renderRows() {
  if (!result) return;
  const fragment = document.createDocumentFragment();
  for (const day of result.days) {
    const row = document.createElement("tr");
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = civilDate(day.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    const hijri = document.createElement("small");
    hijri.textContent = day.hijri + " AH";
    heading.append(hijri);
    row.append(heading);
    for (const key of Object.keys(PRAYERS)) {
      const { time, status: timeStatus, day_offset: dayOffset } = day.prayers[key];
      const td = row.insertCell();
      td.textContent = formatTime(time);
      if (dayOffset || timeStatus === "estimated") {
        const annotation = document.createElement("small");
        const delta = dayOffset ? (dayOffset > 0 ? "+" : "−") + Math.abs(dayOffset) + "d" : "";
        annotation.textContent = delta + (timeStatus === "estimated" ? " †" : "");
        td.append(annotation);
      }
    }
    fragment.append(row);
  }
  tbody.replaceChildren(fragment);
}

function updateButtons() {
  for (const button of buttons) button.disabled = !snapshot || downloadPending;
}

function clearResult() {
  if (!result && !request) return;
  request?.abort();
  request = null;
  generate.disabled = false;
  result = null;
  snapshot = null;
  metadata.textContent = "";
  wrapper.hidden = true;
  scrollHint.hidden = true;
  legend.hidden = true;
  status.textContent = "Settings changed. Generate a timetable to update the preview.";
  updateButtons();
}

profileSelect.addEventListener("change", () => {
  syncProfileOptions();
  applyProfile();
});
saveProfile.addEventListener("click", () => {
  try {
    const data = readProfile(true);
    const existingId = profileSelect.value;
    if (!existingId && profiles.length >= 20) throw new Error("Remove a profile before adding another. This browser can keep up to 20.");
    if (profiles.some((profile) => profile.id !== existingId && profile.name.toLocaleLowerCase() === data.name.toLocaleLowerCase())) {
      throw new Error("A profile already uses this name.");
    }
    const id = existingId || crypto.randomUUID();
    const saved = { id, ...data, method: method.value, asr_type: Number(asr.value) };
    updatePreferences({ profiles: existingId ? profiles.map((profile) => profile.id === id ? saved : profile) : [...profiles, saved] });
    syncProfileOptions(id);
    profileStatus.textContent = remembersPreferences() ? "Profile saved in this browser." : "Profile added for this page. Enable remembering in Preferences to keep it.";
  } catch (error) {
    profileStatus.textContent = error.message;
  }
});
deleteProfile.addEventListener("click", () => {
  updatePreferences({ profiles: profiles.filter(({ id }) => id !== profileSelect.value) });
  syncProfileOptions("");
  applyProfile();
  clearResult();
  profileStatus.textContent = "Profile removed.";
});

form.addEventListener("input", clearResult);
form.addEventListener("change", clearResult);
form.addEventListener("locationchange", clearResult);
form.addEventListener("invalid", ({ target }) => {
  for (let details = target.closest("details"); details; details = details.parentElement.closest("details")) {
    details.open = true;
  }
}, true);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  let location;
  let input;
  try {
    location = locationFields.read();
    const range = (Date.parse(end.value) - Date.parse(start.value)) / 86400000;
    if (range < 0 || range >= 366) throw new Error("Choose an inclusive date range of up to 366 days.");
    input = {
      lat: location.lat,
      lon: location.lon,
      start: start.value,
      end: end.value,
      method: method.value,
      asr_type: Number(asr.value),
      profile: readProfile(false),
    };
  } catch (error) {
    status.textContent = error.message;
    return;
  }
  request?.abort();
  const controller = new AbortController();
  request = controller;
  generate.disabled = true;
  snapshot = null;
  updateButtons();
  status.textContent = "Calculating your timetable…";
  try {
    const data = await (await apiResponse("/calendar/schedule", input, controller.signal)).json();
    if (controller.signal.aborted) return;
    result = data;
    snapshot = input;
    rememberCity(location);
    updatePreferences({ calendar: { method: input.method, asr_type: input.asr_type } });
    metadata.textContent = location.label + " · " + data.timezone + (input.profile.name !== "Islamic Times" ? " · " + data.profile : "");
    renderRows();
    wrapper.hidden = false;
    scrollHint.hidden = false;
    legend.hidden = false;
    status.textContent = data.days.length + (data.days.length === 1 ? " day ready to download." : " days ready to download.");
  } catch (error) {
    if (!controller.signal.aborted) status.textContent = error.message;
  } finally {
    if (!controller.signal.aborted) {
      request = null;
      generate.disabled = false;
      updateButtons();
    }
  }
});

for (const button of buttons) {
  button.addEventListener("click", async () => {
    if (!snapshot) return;
    const input = snapshot;
    const format = button.dataset.download;
    downloadPending = true;
    updateButtons();
    try {
      const response = await apiResponse("/calendar/export/" + format, input);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = ["prayer-calendar", input.start, input.end].join("-") + "." + format;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      if (input === snapshot) status.textContent = error.message;
    } finally {
      downloadPending = false;
      updateButtons();
    }
  });
}

document.addEventListener("preferenceschange", ({ detail }) => {
  if (detail.keys.includes("clock")) renderRows();
  if (detail.keys.includes("profiles")) {
    const previouslySelected = profileSelect.value;
    syncProfileOptions();
    if (previouslySelected && previouslySelected !== profileSelect.value) {
      applyProfile();
      clearResult();
    }
  }
});

syncProfileOptions();
applyProfile();
