/** Returns safe return path. */
export function safeReturnPath(location: Pick<Location, "pathname" | "search" | "hash"> = window.location) {
  const path = `${location.pathname}${location.search}${location.hash}`;
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

/** Returns login URL. */
export function loginUrl(location?: Pick<Location, "pathname" | "search" | "hash">) {
  return `/login?${new URLSearchParams({ returnTo: safeReturnPath(location) })}`;
}
