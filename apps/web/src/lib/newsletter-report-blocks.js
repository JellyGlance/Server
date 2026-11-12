export function reorderBlocks(blocks, from, to) {
  if (!Array.isArray(blocks)) return [];
  const start = Number(from);
  const end = Number(to);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return [...blocks];
  if (start === end || start < 0 || end < 0 || start >= blocks.length || end >= blocks.length) {
    return [...blocks];
  }
  const next = [...blocks];
  const [item] = next.splice(start, 1);
  next.splice(end, 0, item);
  return next;
}

export function moveBlockBy(blocks, index, delta) {
  return reorderBlocks(blocks, index, index + Number(delta || 0));
}
