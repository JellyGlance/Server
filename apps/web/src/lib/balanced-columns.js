// Column count for a row of equal tiles that avoids a lone tile on the last
// row. Returns { columns, scroll }: when every grid that fits would leave a
// single tile on its own row, scroll is true and the tiles go in one
// horizontally scrolling row with `columns` tiles in view instead.
export function balancedColumns(count, width, minTile, gap) {
  const n = Math.max(0, Math.floor(count));
  const maxCols = Math.max(1, Math.floor((width + gap) / (minTile + gap)));
  if (n <= 1) return { columns: 1, scroll: false };
  if (n <= maxCols) return { columns: n, scroll: false };
  if (maxCols === 1) return { columns: 1, scroll: false };
  for (let cols = maxCols; cols >= 2; cols -= 1) {
    const rows = Math.ceil(n / cols);
    const even = Math.ceil(n / rows);
    if (n % even !== 1) return { columns: even, scroll: false };
  }
  return { columns: maxCols, scroll: true };
}
