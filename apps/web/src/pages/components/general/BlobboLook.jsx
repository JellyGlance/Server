import React, { useEffect, useRef, useState } from "react";
import { IDLE_FPS, applyIdle } from "../../../lib/blobbo-idle";

const cache = new Map();
const loadSvg = (src) => {
  if (!cache.has(src)) cache.set(src, fetch(src).then((r) => (r.ok ? r.text() : Promise.reject(r.status))));
  return cache.get(src);
};

// Renders a look's sticky SVG inline and plays the mild idle on its groups, so the
// costume is part of the body and never slips. Falls back to the still image.
export default function BlobboLook({ svg, still, size = 72, animate = true }) {
  const host = useRef(null);
  const [markup, setMarkup] = useState(null);

  useEffect(() => {
    let live = true;
    setMarkup(null);
    loadSvg(svg).then((txt) => live && setMarkup(txt.replace('viewBox="-10 -40 220 245"', 'viewBox="-24 -56 248 264"'))).catch(() => {});
    return () => { live = false; };
  }, [svg]);

  useEffect(() => {
    const el = host.current?.querySelector("svg");
    if (!el) return undefined;
    el.setAttribute("width", size);
    el.setAttribute("height", size);
    applyIdle(el, 0, size);
    if (!animate) return undefined;
    let raf, start;
    const tick = (now) => {
      if (start === undefined) start = now;
      applyIdle(el, ((now - start) / 1000) * IDLE_FPS, size);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [markup, animate, size]);

  if (!markup) return <img src={still} alt="" width={size} height={size} draggable="false" />;
  return <span className="blobbo-look-svg" ref={host} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}
