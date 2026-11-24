// Date helpers for the Requests calendar. Plain date keys ("2026-11-12"), no time zones:
// the server decides what "today" is for its data, the browser for the strip it shows.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parts = (key) => String(key).split("-").map(Number);
const utc = (key) => {
  const [y, m, d] = parts(key);
  return new Date(Date.UTC(y, m - 1, d));
};

export function todayKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function shiftDays(key, days) {
  return new Date(utc(key).getTime() + days * 86400000).toISOString().slice(0, 10);
}

export function weekdayLabel(key) {
  return WEEKDAYS[utc(key).getUTCDay()];
}

export function dayNumber(key) {
  return parts(key)[2];
}

// "12 Nov", "12 \u2013 18 Nov" or "28 Nov \u2013 4 Dec".
export function rangeLabel(from, to) {
  const [, fm, fd] = parts(from);
  const [, tm, td] = parts(to);
  if (from === to) return `${fd} ${MONTHS[fm - 1]}`;
  return fm === tm ? `${fd} \u2013 ${td} ${MONTHS[tm - 1]}` : `${fd} ${MONTHS[fm - 1]} \u2013 ${td} ${MONTHS[tm - 1]}`;
}

export function dayHeading(key, today) {
  const [, m, d] = parts(key);
  const base = `${weekdayLabel(key)} ${d} ${MONTHS[m - 1]}`;
  if (key === today) return `Today \u00b7 ${base}`;
  if (key === shiftDays(today, 1)) return `Tomorrow \u00b7 ${base}`;
  return base;
}

// Short chip text for one calendar item.
export function itemKindLabel(item) {
  if (item?.kind === "Episode") return item.label || "Episode";
  return item?.kind || "Release";
}

// Days to render: all of them, or just the picked one.
export function visibleDays(days, picked) {
  const list = Array.isArray(days) ? days : [];
  return picked ? list.filter((day) => day.date === picked) : list;
}
