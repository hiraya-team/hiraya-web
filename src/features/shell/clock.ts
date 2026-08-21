/** Formats a date for the compact desktop menu-bar clock. */
export function formatDesktopClock(date: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(date);
}
