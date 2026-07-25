import { SYSTEM_APP_IDS } from "../apps/system-app-ids";

export const DATABASE_SCHEMA_VERSION = 7;
const RESERVED_SYSTEM_APP_SQL = Object.values(SYSTEM_APP_IDS).map((id) => `'${id}'`).join(",");

export const APP_STORAGE_SCHEMA_SQL = `
  CREATE TABLE installed_apps (
    app_id TEXT PRIMARY KEY,
    package_entry_id TEXT NOT NULL,
    digest TEXT NOT NULL CHECK (length(digest) = 64),
    version TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    approved_at INTEGER NOT NULL CHECK (approved_at >= 0)
  );
  CREATE TABLE app_storage (
    app_id TEXT NOT NULL REFERENCES installed_apps(app_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes >= 0),
    PRIMARY KEY (app_id, key)
  );
  PRAGMA user_version=3;
`;

export function migrateSchema2To3Sql(version: number): string {
  if (version !== 2) throw new Error(`Schema 3 migration requires version 2, received ${version}.`);
  return `BEGIN IMMEDIATE; ${APP_STORAGE_SCHEMA_SQL} COMMIT;`;
}

export const PREFERENCES_SCHEMA_SQL = `
  ALTER TABLE preferences ADD COLUMN search_all_desktops INTEGER NOT NULL DEFAULT 0 CHECK (search_all_desktops IN (0, 1));
  ALTER TABLE preferences ADD COLUMN onboarding_version INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_version >= 0);
  CREATE TABLE offline_pins (
    desktop_id TEXT NOT NULL REFERENCES desktops(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (desktop_id, entry_id)
  );
  PRAGMA user_version=4;
`;

export function migrateSchema3To4Sql(version: number): string {
  if (version !== 3) throw new Error(`Schema 4 migration requires version 3, received ${version}.`);
  return `BEGIN IMMEDIATE; ${PREFERENCES_SCHEMA_SQL} COMMIT;`;
}

export const APP_ASSOCIATIONS_SCHEMA_SQL = `
  ALTER TABLE app_storage RENAME TO app_storage_v4;
  ALTER TABLE installed_apps RENAME TO installed_apps_v4;
  CREATE TABLE installed_apps (
    app_id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('system', 'desktop')),
    package_entry_id TEXT,
    archive_path TEXT,
    digest TEXT NOT NULL CHECK (length(digest) = 64),
    version TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    approved_at INTEGER NOT NULL CHECK (approved_at >= 0),
    CHECK ((source = 'desktop' AND package_entry_id IS NOT NULL AND archive_path IS NULL) OR (source = 'system' AND package_entry_id IS NULL AND archive_path IS NOT NULL))
  );
  CREATE TABLE app_storage (
    app_id TEXT NOT NULL REFERENCES installed_apps(app_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes >= 0),
    PRIMARY KEY (app_id, key)
  );
  CREATE TABLE quarantined_apps (
    app_id TEXT PRIMARY KEY,
    package_entry_id TEXT NOT NULL,
    digest TEXT NOT NULL,
    version TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    approved_at INTEGER NOT NULL CHECK (approved_at >= 0),
    quarantined_at INTEGER NOT NULL CHECK (quarantined_at >= 0)
  );
  CREATE TABLE quarantined_app_storage (
    app_id TEXT NOT NULL REFERENCES quarantined_apps(app_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes >= 0),
    PRIMARY KEY (app_id, key)
  );
  INSERT INTO quarantined_apps(app_id,package_entry_id,digest,version,manifest_json,approved_at,quarantined_at)
    SELECT app_id,package_entry_id,digest,version,manifest_json,approved_at,CAST(strftime('%s','now') AS INTEGER)*1000 FROM installed_apps_v4 WHERE app_id IN (${RESERVED_SYSTEM_APP_SQL});
  INSERT INTO quarantined_app_storage SELECT app_id,key,value_json,bytes FROM app_storage_v4 WHERE app_id IN (${RESERVED_SYSTEM_APP_SQL});
  INSERT INTO installed_apps(app_id,source,package_entry_id,archive_path,digest,version,manifest_json,approved_at)
    SELECT app_id,'desktop',package_entry_id,NULL,digest,version,manifest_json,approved_at FROM installed_apps_v4 WHERE app_id NOT IN (${RESERVED_SYSTEM_APP_SQL});
  INSERT INTO app_storage SELECT * FROM app_storage_v4 WHERE app_id NOT IN (${RESERVED_SYSTEM_APP_SQL});
  DROP TABLE app_storage_v4;
  DROP TABLE installed_apps_v4;
  CREATE TABLE file_associations (
    matcher TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES installed_apps(app_id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL CHECK (created_at >= 0)
  );
  PRAGMA user_version=5;
`;

export function migrateSchema4To5Sql(version: number): string {
  if (version !== 4) throw new Error(`Schema 5 migration requires version 4, received ${version}.`);
  return `PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE; ${APP_ASSOCIATIONS_SCHEMA_SQL} COMMIT; PRAGMA foreign_keys=ON;`;
}

export const MINIMAP_PREFERENCE_SCHEMA_SQL = `
  ALTER TABLE preferences ADD COLUMN show_desktop_minimap INTEGER NOT NULL DEFAULT 1 CHECK (show_desktop_minimap IN (0, 1));
  PRAGMA user_version=6;
`;

export function migrateSchema5To6Sql(version: number): string {
  if (version !== 5) throw new Error(`Schema 6 migration requires version 5, received ${version}.`);
  return `BEGIN IMMEDIATE; ${MINIMAP_PREFERENCE_SCHEMA_SQL} COMMIT;`;
}

export const EXPLORER_VIEW_PREFERENCE_SCHEMA_SQL = `
  ALTER TABLE preferences ADD COLUMN explorer_view TEXT NOT NULL DEFAULT 'list' CHECK (explorer_view IN ('list', 'grid'));
  PRAGMA user_version=7;
`;

export function migrateSchema6To7Sql(version: number): string {
  if (version !== 6) throw new Error(`Schema 7 migration requires version 6, received ${version}.`);
  return `BEGIN IMMEDIATE; ${EXPLORER_VIEW_PREFERENCE_SCHEMA_SQL} COMMIT;`;
}
