import { useEffect, useState } from "react";

/** Returns a date value refreshed at the requested interval. */
export function useTickingDate(interval = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);
  return now;
}
