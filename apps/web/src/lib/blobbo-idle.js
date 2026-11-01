// Blobbo mild idle (locked 2026-11-01). One 2.4 s loop: 60 frames at 25 fps.
// The look SVG itself is animated so outfits stay on through the motion:
//   #blobbo-root      translateY(dy)
//   #canopy-squash    scale(1+k, 1-k) about (100,104); #costume-attach rides inside it
//   #costume-attach-back gets the same squash, #face blinks on frames 36-41.
export const IDLE_FRAMES = 60;
export const IDLE_FPS = 25;
export const PIVOT = [100, 104];
export const BLINK_Y = 77;
export const AMBIENT_MIN_PX = 48;

export function idleFrame(frame) {
  const f = ((Math.floor(frame) % IDLE_FRAMES) + IDLE_FRAMES) % IDLE_FRAMES;
  const p = (2 * Math.PI * f) / IDLE_FRAMES;
  const dy = -6 * Math.sin(p) - 2;
  const k = 0.035 * Math.sin(p) + 0.01 * Math.cos(2 * p);
  const sway = 5 * Math.sin(p) + 1.8 * Math.sin(3 * p);
  const shadow = 1 - 0.14 * Math.sin(p);
  let blink = 1;
  if (f >= 36 && f <= 41) blink = [0.6, 0.15, 0.05, 0.15, 0.6, 0.9][f - 36];
  return { frame: f, dy, k, sway, shadow, blink };
}

const about = ([x, y], inner) => `translate(${x} ${y}) ${inner} translate(${-x} ${-y})`;

export function idleTransforms(frame) {
  const s = idleFrame(frame);
  const squash = about(PIVOT, `scale(${(1 + s.k).toFixed(4)} ${(1 - s.k).toFixed(4)})`);
  return {
    ...s,
    root: `translate(0 ${s.dy.toFixed(2)})`,
    squash,
    shadowT: `translate(100 196) scale(${s.shadow.toFixed(3)} 1) translate(-100 -196)`,
    face: about([100, BLINK_Y], `scale(1 ${s.blink})`),
  };
}

// Apply one frame to an inline look SVG. Tentacles each sway about their root point.
export function applyIdle(svg, frame, sizePx = 72) {
  if (!svg) return;
  const t = idleTransforms(frame);
  const q = (id) => svg.querySelector(`#${id}`);
  q("blobbo-root")?.setAttribute("transform", t.root);
  q("canopy-squash")?.setAttribute("transform", t.squash);
  q("costume-attach-back")?.setAttribute("transform", t.squash);
  q("ground-shadow")?.setAttribute("transform", t.shadowT);
  q("face")?.setAttribute("transform", t.face);
  const amb = q("costume-ambient");
  if (amb) amb.style.display = sizePx < AMBIENT_MIN_PX ? "none" : "";
  svg.querySelectorAll("#tentacles path").forEach((path, i) => {
    const m = /M\s*([-\d.]+)[ ,]([-\d.]+)/.exec(path.getAttribute("d") || "");
    if (!m) return;
    const dir = i % 2 ? -1 : 1;
    path.setAttribute("transform", `rotate(${(t.sway * dir).toFixed(2)} ${m[1]} ${m[2]})`);
  });
}
