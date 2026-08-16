import { openFilesystemDatabase } from "../../filesystem/database";
import { openWorkspaceCatalog, type WorkspaceCatalog, type WorkspaceCatalogEnvironment } from "./workspace-catalog";

export const LOCAL_WEB2_ACCOUNT_ID = "00000000-0000-4000-8000-000000000000";

export type LocalWeb2Startup = {
  accountId: typeof LOCAL_WEB2_ACCOUNT_ID;
  deviceId: string;
  activeWorkspaceId: string;
  catalog: WorkspaceCatalog;
};

export async function initializeLocalWeb2Storage(environment: WorkspaceCatalogEnvironment = {}): Promise<LocalWeb2Startup> {
  const database = await openFilesystemDatabase(LOCAL_WEB2_ACCOUNT_ID, environment);
  let deviceId: string;
  try {
    deviceId = await database.getOrCreateDeviceId();
  } finally {
    database.close();
  }
  const catalog = await openWorkspaceCatalog(LOCAL_WEB2_ACCOUNT_ID, deviceId, environment);
  try {
    await catalog.ensureInitialWorkspace();
    const active = await catalog.resolveActiveWorkspace();
    return { accountId: LOCAL_WEB2_ACCOUNT_ID, deviceId, activeWorkspaceId: active.id, catalog };
  } catch (error) {
    catalog.close();
    throw error;
  }
}
