import { apiResponse, civilDate, shiftDate } from "./timetable.js";

const FIRST_DATE = "1900-01-01";
const LAST_DATE = "2100-12-31";
const FIRST_MONDAY = "1970-01-05";
const DAY_MOVES = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const byId = (id) => document.getElementById(id);

function monthDate(year, month, day = 1) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function setupDatePicker(selectDate) {
  const dialog = byId("date-dialog");
  const yearField = byId("date-year");
  const previous = byId("date-previous");
  const next = byId("date-next");
  const monthName = byId("date-month-name");
  const days = byId("date-days");
  const apply = byId("date-apply");
  const hijriMonths = byId("date-hijri-months");
  const status = byId("date-picker-status");
  let draft;
  let today;
  let month;
  let year;
  let request;

  for (let index = 0; index < 7; index += 1) {
    const date = shiftDate(FIRST_MONDAY, index);
    const heading = document.createElement("th");
    heading.scope = "col";
    heading.textContent = civilDate(date, { weekday: "narrow" });
    heading.setAttribute("aria-label", civilDate(date, { weekday: "long" }));
    byId("date-weekdays").append(heading);
  }

  function stageDate(date) {
    draft = date;
    const day = days.querySelector('[data-date="' + date + '"]');
    if (!day) {
      showMonth(date, true);
      return;
    }
    days.querySelector('[aria-pressed="true"]')?.setAttribute("aria-pressed", "false");
    day.setAttribute("aria-pressed", "true");
    focusDay(day, true);
    apply.disabled = false;
  }

  function focusDay(button, moveFocus) {
    days.querySelector('[tabindex="0"]')?.setAttribute("tabindex", "-1");
    button.tabIndex = 0;
    if (moveFocus) button.focus();
  }

  function render(target, moveFocus = false) {
    const first = monthDate(year, month);
    const offset = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const buttons = [];
    days.replaceChildren();
    monthName.textContent = civilDate(first, { month: "long" });
    yearField.value = year;
    previous.disabled = first === FIRST_DATE;
    next.disabled = first.slice(0, 7) === LAST_DATE.slice(0, 7);
    apply.disabled = !draft.startsWith(first.slice(0, 7));
    hijriMonths.textContent = "";
    status.textContent = "";

    for (let cell = 0; cell < Math.ceil((offset + count) / 7) * 7; cell += 1) {
      if (cell % 7 === 0) days.insertRow();
      const day = cell - offset + 1;
      const td = days.lastElementChild.insertCell();
      if (day < 1 || day > count) continue;
      const date = monthDate(year, month, day);
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.date = date;
      button.tabIndex = -1;
      button.setAttribute("aria-pressed", String(date === draft));
      if (date === today) button.setAttribute("aria-current", "date");
      const gregorian = document.createElement("span");
      gregorian.textContent = day;
      const hijri = document.createElement("span");
      hijri.className = "date-hijri";
      button.append(gregorian, hijri);
      button.setAttribute("aria-label", civilDate(date, { dateStyle: "full" }));
      td.append(button);
      buttons.push(button);
    }

    const targetButton = buttons.find(({ dataset }) => dataset.date === target) ??
      buttons.find(({ dataset }) => dataset.date === draft) ?? buttons[0];
    focusDay(targetButton, moveFocus);

    request?.abort();
    const monthRequest = new AbortController();
    request = monthRequest;
    status.textContent = "Loading Hijri dates…";
    apiResponse("/hijri_month/" + year + "/" + (month + 1), undefined, monthRequest.signal)
      .then((response) => response.json())
      .then((dates) => {
        if (monthRequest.signal.aborted) return;
        const months = new Set();
        dates.forEach(({ day, month_name: name, year: hijriYear }, index) => {
          const button = buttons[index];
          button.lastElementChild.textContent = day;
          button.setAttribute("aria-label", button.getAttribute("aria-label") + ", " + day + " " + name + " " + hijriYear + " AH");
          months.add(name + " " + hijriYear + " AH");
        });
        hijriMonths.textContent = [...months].join(" / ");
        status.textContent = "";
      })
      .catch(() => {
        if (!monthRequest.signal.aborted) status.textContent = "Hijri dates unavailable.";
      });
  }

  function showMonth(date, moveFocus = false) {
    [year, month] = date.split("-").map(Number);
    month -= 1;
    render(date, moveFocus);
  }

  function browse(delta, day = 1, moveFocus = false) {
    const first = monthDate(year, month + delta);
    if (first < FIRST_DATE || first > LAST_DATE) return;
    const lastDay = new Date(Date.UTC(year, month + delta + 1, 0)).getUTCDate();
    showMonth(monthDate(year, month + delta, Math.min(day, lastDay)), moveFocus);
  }

  previous.addEventListener("click", () => browse(-1));
  next.addEventListener("click", () => browse(1));
  function jumpToYear() {
    if (!yearField.value || !yearField.reportValidity()) {
      yearField.value = year;
      return;
    }
    if (yearField.valueAsNumber !== year) showMonth(monthDate(yearField.valueAsNumber, month));
  }

  yearField.addEventListener("change", jumpToYear);
  yearField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      jumpToYear();
    }
  });
  byId("date-today").addEventListener("click", () => stageDate(today));
  apply.addEventListener("click", () => {
    dialog.close();
    selectDate(draft);
  });
  dialog.addEventListener("close", () => request?.abort());
  days.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (button) stageDate(button.dataset.date);
  });
  days.addEventListener("keydown", (event) => {
    const date = event.target.dataset.date;
    if (!date) return;
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      browse(event.key === "PageUp" ? -1 : 1, Number(date.slice(-2)), true);
      return;
    }
    if (!Object.hasOwn(DAY_MOVES, event.key)) return;
    event.preventDefault();
    const target = shiftDate(date, DAY_MOVES[event.key]);
    if (target < FIRST_DATE || target > LAST_DATE) return;
    const button = days.querySelector('[data-date="' + target + '"]');
    if (button) focusDay(button, true);
    else showMonth(target, true);
  });

  return {
    open(date, currentDate) {
      draft = date;
      today = currentDate;
      dialog.showModal();
      showMonth(date, true);
    },
  };
}
