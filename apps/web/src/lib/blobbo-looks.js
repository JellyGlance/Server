// Blobbo looks: the locked seasonal outfits and costumes, which one is showing,
// and how a look is picked. A look the user chooses is kept in this browser
// (Blobbo prefs, key "look"); with no choice, Blobbo dresses for the calendar.

export const BLOBBO_LOOKS = [
  { id: "base", label: "Classic", emoji: "\u{1FAE7}", kind: "seasonal" },
  { id: "halloween", label: "Halloween", emoji: "\u{1F383}", kind: "seasonal" },
  { id: "winter", label: "Festive winter", emoji: "\u2744\uFE0F", kind: "seasonal" },
  { id: "hearts", label: "Valentine's hearts", emoji: "\u{1F497}", kind: "seasonal" },
  { id: "summer", label: "Summer shades", emoji: "\u{1F60E}", kind: "seasonal" },
  { id: "newyear", label: "New Year", emoji: "\u{1F389}", kind: "costume" },
  { id: "easter", label: "Easter bunny", emoji: "\u{1F430}", kind: "costume" },
  { id: "pride", label: "Pride", emoji: "\u{1F308}", kind: "costume" },
  { id: "birthday", label: "Birthday", emoji: "\u{1F382}", kind: "costume" },
  { id: "gaming", label: "Gaming", emoji: "\u{1F3AE}", kind: "costume" },
  { id: "stpatricks", label: "St Patrick's", emoji: "\u2618\uFE0F", kind: "costume" },
  { id: "harvest", label: "Harvest", emoji: "\u{1F342}", kind: "costume" },
  { id: "cozy", label: "Cozy night", emoji: "\u{1F319}", kind: "costume" },
  { id: "chef", label: "Chef", emoji: "\u{1F468}\u200D\u{1F373}", kind: "costume" },
  { id: "space", label: "Space", emoji: "\u{1FA90}", kind: "costume" },
  { id: "music", label: "Music", emoji: "\u{1F3A7}", kind: "costume" },
  { id: "bookworm", label: "Bookworm", emoji: "\u{1F4D6}", kind: "costume" },
  { id: "sports", label: "Sports", emoji: "\u26BD", kind: "costume" },
  { id: "wizard", label: "Wizard", emoji: "\u{1FA84}", kind: "costume" },
  { id: "movie", label: "Movie night", emoji: "\u{1F37F}", kind: "costume" },
];

const BY_ID = Object.fromEntries(BLOBBO_LOOKS.map((l) => [l.id, l]));
export const getLook = (id) => BY_ID[id] || BY_ID.base;
export const isLookId = (id) => Boolean(BY_ID[id]);

export const lookAssets = (id) => {
  const look = getLook(id).id;
  const dir = "/blobbo/looks/";
  return {
    svg: `${dir}${look}.svg`,
    overlay: look === "base" ? null : `${dir}${look}-overlay.svg`,
    thumb: `${dir}${look}-thumb.png`,
    still: `${dir}${look}-still.png`,
    idle: `${dir}${look}-idle.webp`,
  };
};

// Easter Sunday (Gregorian, anonymous algorithm) as [month, day].
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const dayOfYear = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);

// Calendar rules, first match wins. Manual-only looks (birthday, gaming, chef,
// space, music, bookworm, sports, wizard, movie) never turn on by themselves.
export const CALENDAR_RULES = [
  { id: "newyear", when: "31 Dec \u2013 1 Jan", test: (m, d) => (m === 12 && d === 31) || (m === 1 && d === 1) },
  { id: "winter", when: "1\u201330 Dec", test: (m) => m === 12 },
  { id: "cozy", when: "2\u201331 Jan", test: (m) => m === 1 },
  { id: "hearts", when: "7\u201314 Feb", test: (m, d) => m === 2 && d >= 7 && d <= 14 },
  { id: "stpatricks", when: "15\u201317 Mar", test: (m, d) => m === 3 && d >= 15 && d <= 17 },
  { id: "easter", when: "Palm Sunday \u2013 Easter Monday", test: (m, d, y) => { const [em, ed] = easterSunday(y); const t = dayOfYear(y, m, d) - dayOfYear(y, em, ed); return t >= -7 && t <= 1; } },
  { id: "pride", when: "24\u201330 Jun", test: (m, d) => m === 6 && d >= 24 },
  { id: "summer", when: "Jun \u2013 Aug", test: (m) => m >= 6 && m <= 8 },
  { id: "harvest", when: "22 Sep \u2013 19 Oct", test: (m, d) => (m === 9 && d >= 22) || (m === 10 && d < 20) },
  { id: "halloween", when: "20\u201331 Oct", test: (m, d) => m === 10 && d >= 20 },
];

export function autoLook(date = new Date()) {
  const m = date.getMonth() + 1, d = date.getDate(), y = date.getFullYear();
  const rule = CALENDAR_RULES.find((r) => r.test(m, d, y));
  return rule ? rule.id : "base";
}

// prefs.look: null/undefined = auto (calendar). prefs.seasonal=false keeps auto on Classic.
export function resolveLook(prefs = {}, date = new Date()) {
  if (prefs.look && isLookId(prefs.look)) return { id: prefs.look, source: "picked" };
  if (prefs.seasonal === false) return { id: "base", source: "auto" };
  return { id: autoLook(date), source: "auto" };
}
