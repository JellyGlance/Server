/* eslint-disable react/prop-types */
// Empty state with Blobbo at 96px on the mild idle (still when motion is reduced).
// Decorative only; the text carries the meaning.
import { useEffect, useState } from "react";
import BlobboLook from "../components/general/BlobboLook";
import { lookAssets, resolveLook } from "../../lib/blobbo-looks";
import { getPrefs } from "../../lib/blobbo-prefs";

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return undefined;
    const onChange = (event) => setReduced(event.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export default function BlobboEmpty({ title, children, action }) {
  const reduced = usePrefersReducedMotion();
  const art = lookAssets(resolveLook(getPrefs()).id);
  return (
    <div className="rq-state is-empty">
      <span className="rq-state-art" aria-hidden="true">
        <BlobboLook svg={art.svg} still={art.still} size={96} animate={!reduced} />
      </span>
      <strong>{title}</strong>
      <span>{children}</span>
      {action}
    </div>
  );
}
