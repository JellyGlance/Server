import { MEET_BLOBBO_SEEN_KEY, MEET_BLOBBO_VERSION_LINE, WHATS_NEW_SEEN_VERSION_KEY } from "./events.js";
import { isVersionLine } from "./release-channel.js";

export function hasSeenMeetBlobbo() {
  try {
    return localStorage.getItem(MEET_BLOBBO_SEEN_KEY) === MEET_BLOBBO_VERSION_LINE;
  } catch {
    return false;
  }
}

export function markMeetBlobboSeen() {
  try {
    localStorage.setItem(MEET_BLOBBO_SEEN_KEY, MEET_BLOBBO_VERSION_LINE);
  } catch {
    /* storage blocked: the intro may appear again next visit */
  }
}

export function shouldOfferMeetBlobbo(version, { hidden = false } = {}) {
  if (hidden || !version) return false;
  if (!isVersionLine(version, MEET_BLOBBO_VERSION_LINE)) return false;
  return !hasSeenMeetBlobbo();
}

export function shouldWaitForWhatsNew(version) {
  if (!version) return true;
  try {
    return localStorage.getItem(WHATS_NEW_SEEN_VERSION_KEY) !== version;
  } catch {
    return false;
  }
}
