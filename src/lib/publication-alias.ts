export type PublicAuthority = { desktopAlias: string; itemAlias?: string };

/** Reports whether a value is a valid publication alias. */
export function isValidPublicationAlias(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(value);
}

/** Computes public authority from path. */
export function publicAuthorityFromPath(pathname: string): PublicAuthority | null {
  const match = /^\/published\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  return match && isValidPublicationAlias(match[1]) && (!match[2] || isValidPublicationAlias(match[2])) ? { desktopAlias: match[1], ...(match[2] ? { itemAlias: match[2] } : {}) } : null;
}
