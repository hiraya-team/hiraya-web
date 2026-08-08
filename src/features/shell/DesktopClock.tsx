import { formatDesktopClock } from "./clock";
import { useTickingDate } from "../../ui/use-ticking-date";

export function DesktopClock() {
  const clock = useTickingDate();

  return <time className="menu-bar__clock" dateTime={clock.toISOString()}>{formatDesktopClock(clock)}</time>;
}
