// Blobbo preferences and memory. Everything here stays in this browser only
// (localStorage); nothing is sent to the server.
const KEY = "jellyglance.blobbo.";
export const BLOBBO_PREFS_EVENT = "jellyglance-blobbo-prefs";

const read = (name, fallback) => {
  try {
    const raw = localStorage.getItem(KEY + name);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};
const write = (name, value) => {
  try {
    localStorage.setItem(KEY + name, JSON.stringify(value));
    window.dispatchEvent(new Event(BLOBBO_PREFS_EVENT));
  } catch {
    /* storage full or blocked: Blobbo simply forgets */
  }
};

export const HISTORY_MAX = 5;
export const getHistory = () => (Array.isArray(read("history", [])) ? read("history", []) : []).slice(0, HISTORY_MAX);
export function rememberQuestion(text, intentId) {
  const q = String(text || "").trim();
  if (!q) return getHistory();
  const next = [{ text: q, intentId: intentId || null }, ...getHistory().filter((h) => h.text.toLowerCase() !== q.toLowerCase())].slice(0, HISTORY_MAX);
  write("history", next);
  return next;
}
export const clearHistory = () => write("history", []);

export const DEFAULT_PREFS = { kidsSafe: false, seasonal: true, voice: false, language: "auto" };
export const getPrefs = () => ({ ...DEFAULT_PREFS, ...(read("prefs", {}) || {}) });
export const setPref = (name, value) => write("prefs", { ...getPrefs(), [name]: value });

export const getFlag = (name) => read(`flag.${name}`, null);
export const setFlag = (name, value) => write(`flag.${name}`, value);

// Seasonal skin: picked from today's date, shown as a small badge on Blobbo.
export function currentSeason(date = new Date()) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m === 10 && d >= 20) return { id: "halloween", badge: "🎃", label: "Spooky season" };
  if (m === 12) return { id: "winter", badge: "❄️", label: "Festive frost" };
  if (m === 2 && d <= 14 && d >= 7) return { id: "hearts", badge: "💗", label: "Valentine's week" };
  if (m >= 6 && m <= 8) return { id: "summer", badge: "😎", label: "Summer shades" };
  return null;
}

// Kids-safe answers: hide anything that reads as grown-up in titles or names.
const MATURE = /\b(sex\w*|porn\w*|nud(e|ity)|xxx|erotic\w*|fuck\w*|shit\w*|bitch\w*|cunt\w*|dick\w*|bastard\w*|slasher\w*|gore\w*|kill(er|ers|ing)?|murder\w*|blood\w*|horror\w*|drug\w*|cocaine|heroin)\b/i;
export const isMature = (text) => MATURE.test(String(text || ""));
export function kidsSafeReply(reply) {
  if (!reply || typeof reply !== "object") return reply;
  let hidden = 0;
  const lines = Array.isArray(reply.lines)
    ? reply.lines.filter((l) => {
        const bad = isMature(typeof l === "string" ? l : l?.text);
        if (bad) hidden += 1;
        return !bad;
      })
    : reply.lines;
  const text = isMature(reply.text) ? "I found something, but it isn't suitable while kids-safe mode is on." : reply.text;
  const note = hidden ? `${hidden} ${hidden === 1 ? "result was" : "results were"} hidden by kids-safe mode.` : reply.note;
  return { ...reply, text, lines, note };
}

// Read answers aloud with the browser's own speech voices (no downloads).
export function speak(text) {
  if (!text || typeof window === "undefined" || !window.speechSynthesis) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).slice(0, 400));
  const voice = window.speechSynthesis.getVoices().find((v) => /en-GB/i.test(v.lang));
  if (voice) u.voice = voice;
  u.pitch = 1.3;
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
  return true;
}
