import type { AuthSession } from "../lib/auth";
import { publicAuthorityFromPath, type PublicAuthority } from "../lib/publication-alias";
import { configureAccountStorage } from "../platform/storage/account-storage";

const frontendOnly = import.meta.env.HIRAYA_FRONTEND_ONLY === "true";

export type DesktopStart = { session: AuthSession | null; warmStart?: boolean };
export type ShellStartup =
  | { kind: "desktop"; start: DesktopStart }
  | { kind: "public"; authority: PublicAuthority };

export async function startShell(): Promise<ShellStartup> {
  const authority = publicAuthorityFromPath(window.location.pathname);
  if (authority) return { kind: "public", authority };

  if (frontendOnly) {
    const { LOCAL_WEB2_ACCOUNT_ID } = await import("../platform/storage/local-identity");
    configureAccountStorage(LOCAL_WEB2_ACCOUNT_ID, LOCAL_WEB2_ACCOUNT_ID);
    return { kind: "desktop", start: { session: null, warmStart: false } };
  }

  const { bootstrapSession, readCachedSession } = await import("../lib/auth");
  const cachedSession = readCachedSession();
  const sessionRequest = bootstrapSession(false);
  const session = cachedSession ?? await sessionRequest;
  if (!session) throw new Error("Authentication did not return a Web2 session.");
  const { configureSynchronizedSession } = await import("../platform/storage/synchronized-session");
  configureAccountStorage(session.accountId, session.storageId);
  configureSynchronizedSession(session);
  if (cachedSession) void sessionRequest.then((fresh) => {
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(cachedSession)) window.location.reload();
  }).catch(() => undefined);
  return { kind: "desktop", start: { session, warmStart: cachedSession !== null } };
}
