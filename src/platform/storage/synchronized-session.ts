import type { AuthSession } from "../../lib/auth";

let selected: AuthSession | undefined;
/** Tracks account apps listeners. */
const accountAppsListeners = new Set<(revision: number) => void>();

/** Configures synchronized session. */
export function configureSynchronizedSession(session: AuthSession) {
  if (selected && (selected.accountId !== session.accountId || selected.storageId !== session.storageId)) throw new Error("The synchronized account cannot change after startup.");
  selected = session;
}

/** Returns synchronized session. */
export function synchronizedSession() {
  if (!selected) throw new Error("The synchronized desktop was prepared before authentication completed.");
  return selected;
}

/** Publishes synchronized account apps revision. */
export function publishSynchronizedAccountAppsRevision(revision: number) {
  accountAppsListeners.forEach((listener) => listener(revision));
}

/** Subscribes to synchronized account apps revision. */
export function subscribeSynchronizedAccountAppsRevision(listener: (revision: number) => void) {
  accountAppsListeners.add(listener);
  return () => accountAppsListeners.delete(listener);
}
