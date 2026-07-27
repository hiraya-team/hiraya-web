import { useEffect, useState } from "react";
import { formatDesktopClock } from "./clock";

export function DesktopClock() {
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return <time className="menu-bar__clock" dateTime={clock.toISOString()}>{formatDesktopClock(clock)}</time>;
}
