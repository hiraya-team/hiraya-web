import { parseStableId } from "../../filesystem/ids";

export type AccountStorageContext = {
  accountId: string;
  storageId: string;
};

let selected: AccountStorageContext | undefined;

/** Configures account storage. */
export function configureAccountStorage(accountIdValue: string, storageIdValue: string) {
  const next = {
    accountId: parseStableId(accountIdValue, "The selected account ID is invalid."),
    storageId: parseStableId(storageIdValue, "The selected account storage ID is invalid."),
  };
  if (selected && (selected.accountId !== next.accountId || selected.storageId !== next.storageId)) throw new Error("The selected account storage cannot change after startup.");
  selected = next;
  return next;
}

/** Returns account storage. */
export function accountStorage() {
  if (!selected) throw new Error("Account storage was used before an account was selected.");
  return selected;
}
