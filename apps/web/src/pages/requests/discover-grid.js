// How many tiles a Discover shelf shows. Pure, so it is easy to test.
// Columns the shelf grid will have: floor((width + gap) / (min + gap)), read from the
// same CSS variables the grid uses, so the tile count always fills whole rows.
export function countColumns(width, min, gap) {
  if (!(width > 0) || !(min > 0)) return 2;
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

// Whole rows only: with more to show the last cell is the More tile; without, drop the
// few titles that would leave a short last row.
export function visibleTiles(loaded, cols, rows, serverHasMore) {
  const capacity = cols * rows;
  const more = loaded.length > capacity || serverHasMore;
  let shown = loaded.slice(0, more ? capacity - 1 : capacity);
  if (!more && shown.length > cols) shown = shown.slice(0, shown.length - (shown.length % cols));
  return { shown, more };
}


// Sideways shelves. Which arrows to show for a scroller at this position: none when
// everything fits, no "previous" at the start, no "next" at the end. The 1px slack
// covers sub-pixel scroll positions on zoomed screens.
export function scrollEdges(scrollLeft, clientWidth, scrollWidth) {
  const max = Math.max(0, scrollWidth - clientWidth);
  if (max <= 1) return { canPrev: false, canNext: false };
  return { canPrev: scrollLeft > 1, canNext: scrollLeft < max - 1 };
}

// How far an arrow moves a shelf: a whole number of tiles that fit, at least one, so the
// next position lines up with a snap point.
export function scrollStep(clientWidth, tileWidth, gap) {
  const unit = tileWidth + gap;
  if (!(unit > 0) || !(clientWidth > 0)) return 0;
  return Math.max(1, Math.floor((clientWidth + gap) / unit)) * unit;
}

// ?section=<key>&chip=<id> of the Discover tab. Keys are plain slugs; anything else is dropped.
export function discoverSectionFromSearch(search = "") {
  const params = new URLSearchParams(search);
  const clean = (value, pattern) => (pattern.test(String(value || "")) ? String(value) : "");
  return { section: clean(params.get("section"), /^[a-z0-9-]{1,40}$/), chip: clean(params.get("chip"), /^[0-9]{1,10}$/) };
}
