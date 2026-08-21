import type { AccountAppsSnapshot, AccountResource } from "../lib/account-apps";
import type { DesktopSearchResponse } from "../lib/search";
import type { ShortLink } from "../lib/short-links";

/** Keeps account synchronization disabled in browser-local deployments. */
export const createAccountAppsClient = () => null;

/** Projects no server-owned account resources in browser-local deployments. */
export function accountResources(_snapshot: AccountAppsSnapshot): AccountResource[] {
  void _snapshot;
  return [];
}

/** Rejects server-owned account resource downloads in browser-local deployments. */
export async function downloadAccountResource(_resource: AccountResource, _directBlobOrigin: string): Promise<Blob> {
  void _resource;
  void _directBlobOrigin;
  throw new Error("Account resources require a Hiraya server.");
}

/** Performs no authentication bookkeeping when no server owns the session. */
export function lockAuthBootstrap(): void {}

/** Returns no remote results when the desktop has no server authority. */
export async function searchAccessibleDesktops(query: string, _signal: AbortSignal): Promise<DesktopSearchResponse> {
  void _signal;
  return { query, limit: 0, truncated: false, results: [] };
}

/** Rejects short-link listing when no server owns short links. */
export async function listShortLinks(): Promise<ShortLink[]> {
  throw new Error("Short links require a Hiraya server.");
}

/** Rejects short-link creation when no server owns short links. */
export async function createShortLink(_input: { slug?: string; destinationUrl: string }): Promise<ShortLink> {
  void _input;
  throw new Error("Short links require a Hiraya server.");
}

/** Rejects short-link updates when no server owns short links. */
export async function updateShortLink(_slug: string, _input: { destinationUrl?: string; enabled?: boolean }): Promise<ShortLink> {
  void _slug;
  void _input;
  throw new Error("Short links require a Hiraya server.");
}

/** Rejects short-link deletion when no server owns short links. */
export async function deleteShortLink(_slug: string): Promise<void> {
  void _slug;
  throw new Error("Short links require a Hiraya server.");
}
