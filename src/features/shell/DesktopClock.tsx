import { formatDesktopClock } from "./clock";
import { useTickingDate } from "../../ui/use-ticking-date";

/** Renders the desktop clock and keeps it aligned to minute boundaries. */
export function DesktopClock() {
  const clock = useTickingDate();

  return <time className="menu-bar__clock" dateTime={clock.toISOString()}>{formatDesktopClock(clock)}</time>;
}
