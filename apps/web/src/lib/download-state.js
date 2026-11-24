// Download clients report their own internal state names ("stoppedUP", "stalledDL",
// "Queued", "Downloading"). Show plain words; anything unknown is shown as given.
export const DOWNLOAD_STATE_LABELS = {
  downloading: "Downloading",
  forceddl: "Downloading (forced)",
  metadl: "Fetching metadata",
  forcedmetadl: "Fetching metadata",
  stalleddl: "Stalled",
  queueddl: "Queued",
  pauseddl: "Paused",
  stoppeddl: "Paused",
  checkingdl: "Checking",
  checkingup: "Checking",
  checkingresumedata: "Checking",
  allocating: "Allocating space",
  moving: "Moving files",
  uploading: "Seeding",
  forcedup: "Seeding (forced)",
  stalledup: "Seeding (idle)",
  queuedup: "Queued to seed",
  pausedup: "Finished",
  stoppedup: "Finished",
  missingfiles: "Files missing",
  error: "Error",
};

export function downloadStateLabel(state) {
  const raw = String(state || "").trim();
  return DOWNLOAD_STATE_LABELS[raw.toLowerCase().replace(/[^a-z]/g, "")] || raw;
}
