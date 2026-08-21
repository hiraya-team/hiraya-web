import { useEffect, useState } from "react";

/** Matches devices that support the windowed desktop layout. */
export const WINDOWED_DESKTOP_QUERY = "(any-hover: hover) and (any-pointer: fine)";

/** Tracks whether a browser media query currently matches. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}
