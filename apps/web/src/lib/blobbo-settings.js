// Blobbo visibility lives in Settings -> General only. The setting writes this
// key and fires BLOBBO_SETTING_EVENT so the mascot updates without a reload.
export const BLOBBO_HIDDEN_KEY = "jellyglance.blobbo.hidden";
export const BLOBBO_SETTING_EVENT = "jellyglance-blobbo-updated";

export const isBlobboHidden = () => localStorage.getItem(BLOBBO_HIDDEN_KEY) === "true";

export function setBlobboHidden(hidden) {
  localStorage.setItem(BLOBBO_HIDDEN_KEY, hidden ? "true" : "false");
  window.dispatchEvent(new Event(BLOBBO_SETTING_EVENT));
}
