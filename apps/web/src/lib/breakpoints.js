import { useEffect, useState } from "react";

// Mirrors the CSS media queries; CSS variables can't be used inside @media, so keep these in sync by hand.
export const PHONE = "(max-width: 599px)";
export const TABLET_UP = "(min-width: 600px)";
export const TABLET = "(min-width: 600px) and (max-width: 1179px)";
export const MOBILE_SHELL = "(max-width: 900px), (max-width: 1024px) and (hover: none) and (pointer: coarse)";
export const DESKTOP_SHELL = "(min-width: 1025px), (min-width: 901px) and (hover: hover)";

function matches(query) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false;
}

export function useMediaQuery(query) {
  const [isMatch, setIsMatch] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(query);
    const update = () => setIsMatch(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return isMatch;
}

export const useCompactChart = () => useMediaQuery(PHONE);
