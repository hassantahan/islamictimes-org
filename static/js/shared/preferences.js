const STORAGE_KEY = "islamic-times.preferences.v1";
const DEFAULTS = { theme: "traditional", clock: "24", city: "", daily: null, calendar: null, profiles: [] };

function readSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return data?.version === 1 && data.values && typeof data.values === "object" ? data.values : null;
  } catch {
    return null;
  }
}

function normalize(values) {
  return {
    theme: ["traditional", "system", "light", "dark"].includes(values.theme) ? values.theme : DEFAULTS.theme,
    clock: values.clock === "12" ? "12" : "24",
    city: typeof values.city === "string" || (values.city && typeof values.city === "object") ? values.city : "",
    daily: values.daily ?? null,
    calendar: values.calendar ?? null,
    profiles: Array.isArray(values.profiles) ? values.profiles : [],
  };
}

const saved = readSaved();
let enabled = saved !== null;
let preferences = normalize(saved ?? DEFAULTS);

export function getPreferences() {
  return preferences;
}

export function remembersPreferences() {
  return enabled;
}

function announceChange(keys) {
  document.documentElement.dataset.theme = preferences.theme;
  document.dispatchEvent(new CustomEvent("preferenceschange", { detail: { keys } }));
}

function writeSaved(values) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, values }));
}

export function updatePreferences(changes) {
  preferences = normalize({ ...preferences, ...changes });
  if (enabled) {
    const current = readSaved();
    try {
      if (current) writeSaved(normalize({ ...current, ...changes }));
      else enabled = false; // Another tab may already have withdrawn consent.
    } catch {
      enabled = false;
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage is unavailable. */ }
      reportStorageError();
    }
  }
  announceChange(Object.keys(changes));
}

const dialog = document.getElementById("preferences");
const theme = document.getElementById("preference-theme");
const clock = document.getElementById("preference-clock");
const remember = document.getElementById("preferences-enabled");
const status = document.getElementById("preference-status");
const clear = document.getElementById("clear-preferences");

function render() {
  theme.value = preferences.theme;
  clock.value = preferences.clock;
  remember.checked = enabled;
  clear.hidden = !enabled;
}

function reportStorageError() {
  status.textContent = "Browser storage unavailable.";
}

function stopSaving(reset) {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    reportStorageError();
    render();
    return;
  }
  enabled = false;
  if (reset) preferences = normalize(DEFAULTS);
  status.textContent = "Saved settings cleared.";
  announceChange(reset ? Object.keys(DEFAULTS) : []);
  render();
}

// Discard the old unconditional theme setting when upgrading the site.
try { localStorage.removeItem("theme"); } catch { /* Storage is unavailable. */ }

document.getElementById("open-preferences").addEventListener("click", () => dialog.showModal());
document.addEventListener("preferenceschange", render);
theme.addEventListener("change", () => updatePreferences({ theme: theme.value }));
clock.addEventListener("change", () => updatePreferences({ clock: clock.value }));
remember.addEventListener("change", () => {
  if (!remember.checked) {
    stopSaving(false);
    return;
  }
  try {
    writeSaved(preferences);
    enabled = true;
    status.textContent = "";
  } catch {
    reportStorageError();
  }
  announceChange([]);
});
clear.addEventListener("click", () => stopSaving(true));

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  const latest = readSaved();
  enabled = latest !== null;
  const previous = preferences;
  preferences = normalize(latest ?? DEFAULTS);
  status.textContent = "";
  const changed = Object.keys(DEFAULTS).filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(preferences[key]));
  announceChange(changed);
});

announceChange([]);
