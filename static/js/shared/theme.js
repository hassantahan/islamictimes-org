const toggleButton = document.getElementById("theme-toggle");
const root = document.documentElement;
const body = document.body;
const moonIcon = document.getElementById("theme-icon-moon");
const sunIcon = document.getElementById("theme-icon-sun");
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function getStoredTheme() {
  try {
    const stored = localStorage.getItem("theme");
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
}

function setStoredTheme(theme) {
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Storage can fail in privacy modes; theme still applies for the session.
  }
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  root.classList.toggle("dark", isDark);
  body?.classList.toggle("dark", isDark);
  root.setAttribute("data-theme", isDark ? "dark" : "light");
  moonIcon?.classList.toggle("hidden", isDark);
  sunIcon?.classList.toggle("hidden", !isDark);
}

const storedTheme = getStoredTheme();
const systemPrefersDark = systemThemeQuery.matches;
const initialTheme = storedTheme === "dark" || storedTheme === "light"
  ? storedTheme
  : (systemPrefersDark ? "dark" : "light");
applyTheme(initialTheme);

if (typeof systemThemeQuery.addEventListener === "function") {
  systemThemeQuery.addEventListener("change", ({ matches }) => {
    if (getStoredTheme()) return;
    applyTheme(matches ? "dark" : "light");
  });
}

if (toggleButton) {
  toggleButton.addEventListener("click", () => {
    const nextTheme = root.classList.contains("dark") ? "light" : "dark";
    applyTheme(nextTheme);
    setStoredTheme(nextTheme);
  });
}
