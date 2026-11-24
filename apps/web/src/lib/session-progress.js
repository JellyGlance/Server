// Playback position, runtime, time left and progress for an Active Sessions card.
// Every label on the card comes from the same normalised tick values so they can't disagree.

export const TICKS_PER_SECOND = 10_000_000;

function toTicks(value) {
  if (value === null || value === undefined || value === "") return null;
  const ticks = Number(value);
  return Number.isFinite(ticks) && ticks >= 0 ? ticks : null;
}

export function formatTicks(ticks) {
  const safe = toTicks(ticks);
  if (safe === null) return "--:--:--";
  const seconds = Math.floor(safe / TICKS_PER_SECOND);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

export function getSessionProgress(nowPlaying = {}, playState = {}, now = Date.now()) {
  const runtimeTicks = toTicks(nowPlaying?.RunTimeTicks) || null;
  let positionTicks = toTicks(playState?.PositionTicks);
  if (positionTicks !== null && runtimeTicks) positionTicks = Math.min(positionTicks, runtimeTicks);

  const isPaused = Boolean(playState?.IsPaused);
  const known = positionTicks !== null && runtimeTicks !== null;
  const remainingTicks = known ? Math.max(0, runtimeTicks - positionTicks) : null;
  const percent = known ? (positionTicks / runtimeTicks) * 100 : 0;
  // A paused stream doesn't finish at a fixed clock time, so only playing streams get an end time.
  const endsAt = remainingTicks !== null && !isPaused ? new Date(now + remainingTicks / 10_000) : null;

  return { positionTicks, runtimeTicks, remainingTicks, percent, endsAt, isPaused, known };
}
