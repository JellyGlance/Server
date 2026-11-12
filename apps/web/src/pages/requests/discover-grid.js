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

