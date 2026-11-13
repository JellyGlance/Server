// Which layout the request list opens in, and remembering the choice.
// Cards are the default everywhere. The key carries a version so a "rows" value saved
// under the old key doesn't pin anyone to rows: it is dropped once, and from then on
// whatever the person picks (cards or rows) is kept.
export const VIEW_KEY = "jellyglance_requests_view_v2";
export const LEGACY_VIEW_KEY = "jellyglance_requests_view";
export const VIEWS = ["cards", "list"];

export function readQueueView(storage) {
  try {
    storage?.removeItem?.(LEGACY_VIEW_KEY);
    const saved = storage?.getItem?.(VIEW_KEY);
    return VIEWS.includes(saved) ? saved : "cards";
  } catch {
    return "cards";
  }
}

export function saveQueueView(storage, view) {
  if (!VIEWS.includes(view)) return;
  try {
    storage?.setItem?.(VIEW_KEY, view);
  } catch {
    // storage can be unavailable (private mode); the choice just lasts for the visit
  }
}
