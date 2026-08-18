import type { AuthSession } from "../../lib/auth";

let selected: AuthSession | undefined;

export function configureSynchronizedSession(session: AuthSession) {
  if (selected && (selected.accountId !== session.accountId || selected.storageId !== session.storageId)) throw new Error("The synchronized account cannot change after startup.");
  selected = session;
}

export function synchronizedSession() {
  if (!selected) throw new Error("The synchronized desktop was prepared before authentication completed.");
  return selected;
}
