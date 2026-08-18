import { openFilesystemDatabase } from "../../filesystem/database";
import { configureAccountStorage } from "./account-storage";
import { openWorkspaceCatalog, type WorkspaceCatalog, type WorkspaceCatalogEnvironment } from "./workspace-catalog";
import { LOCAL_WEB2_ACCOUNT_ID } from "./local-identity";

export { LOCAL_WEB2_ACCOUNT_ID } from "./local-identity";

export type LocalWeb2Startup = {
  accountId: string;
  storageId: string;
  deviceId: string;
  activeWorkspaceId: string;
  catalog: WorkspaceCatalog;
};

export async function initializeLocalWeb2Storage(environment: Omit<WorkspaceCatalogEnvironment, "storageId"> = {}): Promise<LocalWeb2Startup> {
  configureAccountStorage(LOCAL_WEB2_ACCOUNT_ID, LOCAL_WEB2_ACCOUNT_ID);
  const localEnvironment = { ...environment, storageId: LOCAL_WEB2_ACCOUNT_ID };
  const database = await openFilesystemDatabase(LOCAL_WEB2_ACCOUNT_ID, localEnvironment);
  let deviceId: string;
  try {
    deviceId = await database.getOrCreateDeviceId();
  } finally {
    database.close();
  }
  const catalog = await openWorkspaceCatalog(LOCAL_WEB2_ACCOUNT_ID, deviceId, localEnvironment);
  try {
    await catalog.ensureInitialWorkspace("Desktop", false);
    const active = await catalog.resolveActiveWorkspace();
    return { accountId: LOCAL_WEB2_ACCOUNT_ID, storageId: LOCAL_WEB2_ACCOUNT_ID, deviceId, activeWorkspaceId: active.id, catalog };
  } catch (error) {
    catalog.close();
    throw error;
  }
}
