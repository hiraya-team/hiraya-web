import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createStorageDbRequest, parseOfflinePinResponse, parseStorageProtocol, validateOfflinePinRequest } from "../src/lib/opfs-db-protocol";
import { STORAGE_PROTOCOL_VERSION } from "../src/lib/storage-worker";
import { APP_ASSOCIATIONS_SCHEMA_SQL, APP_STORAGE_SCHEMA_SQL, DATABASE_SCHEMA_VERSION, EXPLORER_VIEW_PREFERENCE_SCHEMA_SQL, migrateSchema2To3Sql, migrateSchema3To4Sql, migrateSchema4To5Sql, migrateSchema5To6Sql, migrateSchema6To7Sql, migrateSchema7To8Sql, MINIMAP_PREFERENCE_SCHEMA_SQL, PREFERENCES_SCHEMA_SQL } from "../src/lib/opfs-schema";

describe("storage worker request context", () => {
  test("keeps concurrent tab requests explicitly scoped to their desktops", () => {
    const first = createStorageDbRequest(1, "desktop-a", "readDesktop", { desktopId: "desktop-a" });
    const second = createStorageDbRequest(2, "desktop-b", "readDesktop", { desktopId: "desktop-b" });
    expect(first).toEqual({ id: 1, desktopId: "desktop-a", method: "readDesktop", params: { desktopId: "desktop-a" } });
    expect(second).toEqual({ id: 2, desktopId: "desktop-b", method: "readDesktop", params: { desktopId: "desktop-b" } });
  });
});

describe("local schema 8", () => {
  test("adds app approvals and isolated storage without changing desktop tables", () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(8);
    expect(APP_STORAGE_SCHEMA_SQL).toContain("CREATE TABLE installed_apps");
    expect(APP_STORAGE_SCHEMA_SQL).toContain("CREATE TABLE app_storage");
    expect(APP_STORAGE_SCHEMA_SQL).toContain("ON DELETE CASCADE");
    expect(APP_STORAGE_SCHEMA_SQL).toContain("PRAGMA user_version=3");
    expect(migrateSchema2To3Sql(2)).toMatch(/^BEGIN IMMEDIATE;[\s\S]+COMMIT;$/);
    expect(() => migrateSchema2To3Sql(1)).toThrow("requires version 2");
  });

  test("migrates app sources and normalized browser-local associations without dropping app storage", () => {
    expect(APP_ASSOCIATIONS_SCHEMA_SQL).toContain("source TEXT NOT NULL");
    expect(APP_ASSOCIATIONS_SCHEMA_SQL).toContain("CREATE TABLE file_associations");
    expect(APP_ASSOCIATIONS_SCHEMA_SQL).toContain("INSERT INTO app_storage SELECT * FROM app_storage_v4");
    expect(APP_ASSOCIATIONS_SCHEMA_SQL).toContain("ON DELETE CASCADE");
    expect(migrateSchema4To5Sql(4)).toMatch(/^PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;[\s\S]+PRAGMA foreign_keys=ON;$/);
    expect(() => migrateSchema4To5Sql(3)).toThrow("requires version 4");
  });

  test("executes the schema 4 to 5 migration and preserves app data across updates", () => {
    const db = new Database(":memory:");
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE desktops(id TEXT PRIMARY KEY);
      CREATE TABLE preferences(singleton INTEGER PRIMARY KEY, auto_update INTEGER, external_embedded_previews INTEGER);
      ${APP_STORAGE_SCHEMA_SQL}
      ${PREFERENCES_SCHEMA_SQL}
      INSERT INTO installed_apps VALUES ('test.editor', 'package', '${"a".repeat(64)}', '1.0.0', '{}', 1);
      INSERT INTO app_storage VALUES ('test.editor', 'draft', '{"text":"kept"}', 15);
    `);
    db.exec(migrateSchema4To5Sql(4));
    db.exec(`UPDATE installed_apps SET source='system', package_entry_id=NULL, archive_path='system-apps/text-editor.hiraya.app', digest='${"b".repeat(64)}', version='2.0.0' WHERE app_id='test.editor'`);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 5 });
    expect(db.query("SELECT value_json FROM app_storage WHERE app_id='test.editor'").get()).toEqual({ value_json: '{"text":"kept"}' });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("losslessly quarantines schema-4 apps colliding with reserved system identities", () => {
    const db = new Database(":memory:");
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE desktops(id TEXT PRIMARY KEY);
      CREATE TABLE preferences(singleton INTEGER PRIMARY KEY, auto_update INTEGER, external_embedded_previews INTEGER);
      ${APP_STORAGE_SCHEMA_SQL}
      ${PREFERENCES_SCHEMA_SQL}
      INSERT INTO installed_apps VALUES ('app.hiraya.text-editor', 'user-package', '${"a".repeat(64)}', '1.0.0', '{"name":"Original editor"}', 1);
      INSERT INTO app_storage VALUES ('app.hiraya.text-editor', 'draft', '{"text":"bytes survive"}', 24);
    `);
    db.exec(migrateSchema4To5Sql(4));
    expect(db.query("SELECT * FROM installed_apps WHERE app_id='app.hiraya.text-editor'").get()).toBeNull();
    expect(db.query("SELECT * FROM app_storage WHERE app_id='app.hiraya.text-editor'").get()).toBeNull();
    expect(db.query("SELECT app_id,package_entry_id,digest,version,manifest_json,approved_at FROM quarantined_apps").get()).toEqual({ app_id: "app.hiraya.text-editor", package_entry_id: "user-package", digest: "a".repeat(64), version: "1.0.0", manifest_json: '{"name":"Original editor"}', approved_at: 1 });
    expect(db.query("SELECT app_id,key,value_json,bytes FROM quarantined_app_storage").get()).toEqual({ app_id: "app.hiraya.text-editor", key: "draft", value_json: '{"text":"bytes survive"}', bytes: 24 });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("cascades removable app storage and associations", () => {
    const db = new Database(":memory:");
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE installed_apps(app_id TEXT PRIMARY KEY);
      CREATE TABLE app_storage(app_id TEXT REFERENCES installed_apps(app_id) ON DELETE CASCADE, key TEXT, PRIMARY KEY(app_id, key));
      CREATE TABLE file_associations(matcher TEXT PRIMARY KEY, app_id TEXT REFERENCES installed_apps(app_id) ON DELETE CASCADE, created_at INTEGER);
      INSERT INTO installed_apps VALUES ('user.viewer');
      INSERT INTO app_storage VALUES ('user.viewer', 'state');
      INSERT INTO file_associations VALUES ('.sample', 'user.viewer', 1);
      DELETE FROM installed_apps WHERE app_id='user.viewer';
    `);
    expect(db.query("SELECT * FROM app_storage").all()).toEqual([]);
    expect(db.query("SELECT * FROM file_associations").all()).toEqual([]);
    db.close();
  });

  test("migrates namespaced preferences once and reserves normalized offline pins", () => {
    expect(PREFERENCES_SCHEMA_SQL).toContain("search_all_desktops");
    expect(PREFERENCES_SCHEMA_SQL).toContain("onboarding_version");
    expect(PREFERENCES_SCHEMA_SQL).toContain("CREATE TABLE offline_pins");
    expect(PREFERENCES_SCHEMA_SQL).toContain("PRAGMA user_version=4");
    expect(migrateSchema3To4Sql(3)).toMatch(/^BEGIN IMMEDIATE;[\s\S]+COMMIT;$/);
    expect(() => migrateSchema3To4Sql(2)).toThrow("requires version 3");
  });

  test("defaults the device-local desktop minimap preference to visible", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE preferences(singleton INTEGER PRIMARY KEY, auto_update INTEGER NOT NULL, external_embedded_previews INTEGER NOT NULL, search_all_desktops INTEGER NOT NULL, onboarding_version INTEGER NOT NULL);
      INSERT INTO preferences VALUES (1, 1, 1, 0, 1);
      PRAGMA user_version=5;
    `);
    db.exec(migrateSchema5To6Sql(5));
    expect(MINIMAP_PREFERENCE_SCHEMA_SQL).toContain("show_desktop_minimap");
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 6 });
    expect(db.query("SELECT show_desktop_minimap FROM preferences").get()).toEqual({ show_desktop_minimap: 1 });
    db.exec("UPDATE preferences SET show_desktop_minimap=0");
    expect(db.query("SELECT show_desktop_minimap FROM preferences").get()).toEqual({ show_desktop_minimap: 0 });
    expect(() => migrateSchema5To6Sql(4)).toThrow("requires version 5");
    db.close();
  });

  test("defaults and constrains the device-local folder explorer view", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE preferences(singleton INTEGER PRIMARY KEY, auto_update INTEGER NOT NULL, external_embedded_previews INTEGER NOT NULL, search_all_desktops INTEGER NOT NULL, onboarding_version INTEGER NOT NULL, show_desktop_minimap INTEGER NOT NULL);
      INSERT INTO preferences VALUES (1, 1, 1, 0, 1, 1);
      PRAGMA user_version=6;
    `);
    db.exec(migrateSchema6To7Sql(6));
    expect(EXPLORER_VIEW_PREFERENCE_SCHEMA_SQL).toContain("explorer_view");
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 7 });
    expect(db.query("SELECT explorer_view FROM preferences").get()).toEqual({ explorer_view: "list" });
    db.exec("UPDATE preferences SET explorer_view='grid'");
    expect(db.query("SELECT explorer_view FROM preferences").get()).toEqual({ explorer_view: "grid" });
    expect(() => db.exec("UPDATE preferences SET explorer_view='columns'")).toThrow();
    expect(() => migrateSchema6To7Sql(5)).toThrow("requires version 6");
    db.close();
  });

  test("migrates implicit external embeds off and adds opt-in browser pinch zoom", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE preferences(singleton INTEGER PRIMARY KEY, auto_update INTEGER NOT NULL, external_embedded_previews INTEGER NOT NULL, search_all_desktops INTEGER NOT NULL, onboarding_version INTEGER NOT NULL, show_desktop_minimap INTEGER NOT NULL, explorer_view TEXT NOT NULL);
      INSERT INTO preferences VALUES (1, 1, 1, 0, 1, 1, 'list');
      PRAGMA user_version=7;
    `);
    db.exec(migrateSchema7To8Sql(7));
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 8 });
    expect(db.query("SELECT external_embedded_previews,allow_browser_pinch_zoom FROM preferences").get()).toEqual({ external_embedded_previews: 0, allow_browser_pinch_zoom: 0 });
    expect(() => migrateSchema7To8Sql(6)).toThrow("requires version 7");
    db.close();
  });

  test("keeps app RPC requests device-local", () => {
    const request = createStorageDbRequest(3, null, "readAppStorage", { appId: "test.editor", key: "theme" });
    expect(request.desktopId).toBeNull();
    expect(request.params).toEqual({ appId: "test.editor", key: "theme" });
  });

  test("keeps strict schema-v4 pin requests after later migrations", () => {
    const list = createStorageDbRequest(4, "desktop-a", "listOfflinePins", { desktopId: "desktop-a" });
    const update = createStorageDbRequest(5, "desktop-a", "setOfflinePins", { desktopId: "desktop-a", entryIds: ["entry-a"], pinned: true, createdAt: 123 });
    expect(DATABASE_SCHEMA_VERSION).toBe(8);
    expect(list.params).toEqual({ desktopId: "desktop-a" });
    expect(update.params).toEqual({ desktopId: "desktop-a", entryIds: ["entry-a"], pinned: true, createdAt: 123 });
  });

  test("rejects malformed pin requests and cross-desktop responses", () => {
    expect(() => validateOfflinePinRequest("setOfflinePins", { desktopId: "desktop-a", entryIds: ["entry-a", "entry-a"], pinned: true, createdAt: 1 }, "desktop-a")).toThrow("invalid");
    expect(() => validateOfflinePinRequest("setOfflinePins", { desktopId: "desktop-a", entryIds: ["entry-a"], pinned: 1, createdAt: 1 }, "desktop-a")).toThrow("invalid");
    expect(() => validateOfflinePinRequest("listOfflinePins", { desktopId: "desktop-a", extra: true }, "desktop-a")).toThrow("binding");
    expect(() => parseOfflinePinResponse({ desktopId: "desktop-b", entryIds: ["entry-a"] }, "desktop-a")).toThrow("invalid offline-pin response");
    expect(() => parseOfflinePinResponse({ desktopId: "desktop-a", entryIds: ["entry-a", "entry-a"] }, "desktop-a")).toThrow("invalid offline-pin response");
  });

  test("handshakes the named worker protocol", () => {
    expect(STORAGE_PROTOCOL_VERSION).toBe(9);
    expect(parseStorageProtocol({ version: 9 })).toBe(9);
    expect(() => parseStorageProtocol({ version: 8 })).toThrow("outdated");
  });
});
