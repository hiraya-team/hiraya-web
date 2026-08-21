import { AccountAppsClient } from "../features/app-management/account-sync";

/** Creates the synchronized account-app client used by server-backed desktops. */
export const createAccountAppsClient = (directBlobOrigin: string) => new AccountAppsClient(directBlobOrigin);

export { accountResources } from "../lib/account-apps";
export { downloadAccountResource } from "../lib/account-apps-remote";
export { lockAuthBootstrap } from "../lib/auth";
export { searchAccessibleDesktops } from "../lib/search";
export { createShortLink, deleteShortLink, listShortLinks, updateShortLink } from "../lib/short-links";
