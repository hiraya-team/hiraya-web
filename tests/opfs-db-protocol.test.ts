import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createStorageDbRequest, parseStorageProtocol } from "../src/lib/opfs-db-protocol";
import { STORAGE_PROTOCOL_VERSION } from "../src/lib/storage-worker";
import { APP_ASSOCIATIONS_SCHEMA_SQL, APP_RUNTIME_RESET_SCHEMA_SQL, APP_STORAGE_SCHEMA_SQL, DATABASE_SCHEMA_VERSION, EXPLORER_VIEW_PREFERENCE_SCHEMA_SQL, migrateSchema10To11Sql, migrateSchema2To3Sql, migrateSchema3To4Sql, migrateSchema4To5Sql, migrateSchema5To6Sql, migrateSchema6To7Sql, migrateSchema7To8Sql, migrateSchema8To9Sql, migrateSchema9To10Sql, MINIMAP_PREFERENCE_SCHEMA_SQL, PREFERENCES_SCHEMA_SQL } from "../src/lib/opfs-schema";

describe("storage worker request context", () => {
  test("keeps concurrent tab requests explicitly scoped to their desktops", () => {
    const first = createStorageDbRequest(1, "desktop-a", "readDesktop", { desktopId: "desktop-a" });
    const second = createStorageDbRequest(2, "desktop-b", "readDesktop", { desktopId: "desktop-b" });
    expect(first).toEqual({ id: 1, desktopId: "desktop-a", method: "readDesktop", params: { desktopId: "desktop-a" } });
    expect(second).toEqual({ id: 2, desktopId: "desktop-b", method: "readDesktop", params: { desktopId: "desktop-b" } });
  });
});

describe("local schema 11", () => {
  test("adds app approvals and isolated storage without changing desktop tables", () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(11);
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

  test("adds durable safe outbox attempt diagnostics", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE outbox(sequence INTEGER PRIMARY KEY, operation_id TEXT, client_id TEXT, catalog_id TEXT, desktop_id TEXT, operation_schema_version INTEGER, operation_json TEXT, status TEXT, error TEXT); INSERT INTO outbox VALUES (1, 'operation', 'client', NULL, 'desktop', 1, '{}', 'pending', NULL); PRAGMA user_version=8;");
    db.exec(migrateSchema8To9Sql(8));
    expect(db.query("SELECT attempt_count,last_attempt_at,error_code,conflict_details_json FROM outbox").get()).toEqual({ attempt_count: 0, last_attempt_at: null, error_code: null, conflict_details_json: null });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    expect(() => migrateSchema8To9Sql(7)).toThrow("requires version 8");
    db.close();
  });

  test("removes durable offline pins without touching downloaded file storage", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE offline_pins(desktop_id TEXT, entry_id TEXT, created_at INTEGER); INSERT INTO offline_pins VALUES ('desktop', 'entry', 1); PRAGMA user_version=9;");
    db.exec(migrateSchema9To10Sql(9));
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 10 });
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='offline_pins'").get()).toBeNull();
    expect(() => migrateSchema9To10Sql(8)).toThrow("requires version 9");
    db.close();
  });

  test("preserves installed app recovery data before resetting incompatible app runtime data", () => {
    const db = new Database(":memory:");
    const systemTextEditorManifest = JSON.stringify({ schemaVersion: 1, id: "app.hiraya.text-editor", name: "Text Editor", version: "1.0.0", entrypoint: "index.html", permissions: ["files:read", "storage"] });
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE desktops(id TEXT PRIMARY KEY, catalog_id TEXT, catalog_revision INTEGER);
      CREATE TABLE entries(id TEXT PRIMARY KEY, desktop_id TEXT REFERENCES desktops(id), name TEXT);
      CREATE TABLE installed_apps(app_id TEXT PRIMARY KEY, source TEXT NOT NULL, package_entry_id TEXT, archive_path TEXT, digest TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL, approved_at INTEGER NOT NULL);
      CREATE TABLE app_storage(app_id TEXT REFERENCES installed_apps(app_id) ON DELETE CASCADE, key TEXT, value_json TEXT, bytes INTEGER, PRIMARY KEY(app_id, key));
      CREATE TABLE file_associations(matcher TEXT PRIMARY KEY, app_id TEXT REFERENCES installed_apps(app_id) ON DELETE CASCADE, created_at INTEGER);
      CREATE TABLE quarantined_apps(app_id TEXT PRIMARY KEY, package_entry_id TEXT NOT NULL, digest TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL, approved_at INTEGER NOT NULL, quarantined_at INTEGER NOT NULL);
      CREATE TABLE quarantined_app_storage(app_id TEXT REFERENCES quarantined_apps(app_id) ON DELETE CASCADE, key TEXT, value_json TEXT, bytes INTEGER, PRIMARY KEY(app_id, key));
      INSERT INTO desktops VALUES ('desktop-a', 'catalog-a', 7);
      INSERT INTO entries VALUES ('file-a', 'desktop-a', 'notes.txt');
       INSERT INTO installed_apps VALUES ('test.editor', 'desktop', 'editor-package', NULL, '${"a".repeat(64)}', '1.0.0', '{"name":"Editor"}', 1);
       INSERT INTO installed_apps VALUES ('test.viewer', 'desktop', 'viewer-package', NULL, '${"b".repeat(64)}', '1.0.0', '{"name":"Viewer"}', 2);
       INSERT INTO installed_apps VALUES ('recovery.system.app.hiraya.text-editor', 'desktop', 'collision-package', NULL, '${"e".repeat(64)}', '1.0.0', '{"name":"Collision Editor"}', 3);
       INSERT INTO installed_apps VALUES ('app.hiraya.text-editor', 'system', NULL, 'system-apps/text-editor.hiraya.app', '${"c".repeat(64)}', '1.0.0', '${systemTextEditorManifest}', 3);
       INSERT INTO app_storage VALUES ('test.editor', 'draft', '{"text":"quarantine me"}', 22);
       INSERT INTO app_storage VALUES ('test.viewer', 'layout', '{"view":"grid"}', 15);
       INSERT INTO app_storage VALUES ('recovery.system.app.hiraya.text-editor', 'draft', '{"text":"recover both"}', 23);
       INSERT INTO app_storage VALUES ('app.hiraya.text-editor', 'editor-settings', '{"fontSize":18,"lineWrap":false,"autoSave":true,"autoFormat":true}', 67);
      INSERT INTO file_associations VALUES ('.txt', 'test.editor', 1);
      INSERT INTO quarantined_apps VALUES ('app.hiraya.text-editor', 'legacy-package', '${"d".repeat(64)}', '0.9.0', '{"name":"Legacy Text Editor"}', 4, 5);
      INSERT INTO quarantined_app_storage VALUES ('app.hiraya.text-editor', 'draft', '{"text":"preserved"}', 20);
      PRAGMA user_version=10;
    `);

    expect(APP_RUNTIME_RESET_SCHEMA_SQL).toContain("WHERE source='desktop'");
    expect(APP_RUNTIME_RESET_SCHEMA_SQL).toContain("'_recovery.system.' || app_id");
    expect(APP_RUNTIME_RESET_SCHEMA_SQL).toContain("'_recovery-package.system.' || app_id");
    expect(APP_RUNTIME_RESET_SCHEMA_SQL).toContain("ON CONFLICT(app_id) DO NOTHING");
    expect(APP_RUNTIME_RESET_SCHEMA_SQL).toContain("DELETE FROM file_associations");
    expect(migrateSchema10To11Sql(10)).toMatch(/^BEGIN IMMEDIATE;[\s\S]+COMMIT;$/);
    db.exec(migrateSchema10To11Sql(10));

    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 11 });
    expect(db.query("SELECT * FROM installed_apps").all()).toEqual([]);
    expect(db.query("SELECT * FROM app_storage").all()).toEqual([]);
    expect(db.query("SELECT * FROM file_associations").all()).toEqual([]);
    expect(db.query("SELECT * FROM desktops").get()).toEqual({ id: "desktop-a", catalog_id: "catalog-a", catalog_revision: 7 });
    expect(db.query("SELECT * FROM entries").get()).toEqual({ id: "file-a", desktop_id: "desktop-a", name: "notes.txt" });
    expect(db.query("SELECT app_id,package_entry_id,digest,version,manifest_json,approved_at FROM quarantined_apps ORDER BY app_id").all()).toEqual([
      { app_id: "_recovery.system.app.hiraya.text-editor", package_entry_id: "_recovery-package.system.app.hiraya.text-editor", digest: "c".repeat(64), version: "1.0.0", manifest_json: systemTextEditorManifest, approved_at: 3 },
      { app_id: "app.hiraya.text-editor", package_entry_id: "legacy-package", digest: "d".repeat(64), version: "0.9.0", manifest_json: '{"name":"Legacy Text Editor"}', approved_at: 4 },
      { app_id: "recovery.system.app.hiraya.text-editor", package_entry_id: "collision-package", digest: "e".repeat(64), version: "1.0.0", manifest_json: '{"name":"Collision Editor"}', approved_at: 3 },
      { app_id: "test.editor", package_entry_id: "editor-package", digest: "a".repeat(64), version: "1.0.0", manifest_json: '{"name":"Editor"}', approved_at: 1 },
      { app_id: "test.viewer", package_entry_id: "viewer-package", digest: "b".repeat(64), version: "1.0.0", manifest_json: '{"name":"Viewer"}', approved_at: 2 },
    ]);
    expect(db.query("SELECT app_id,key,value_json,bytes FROM quarantined_app_storage ORDER BY app_id,key").all()).toEqual([
      { app_id: "_recovery.system.app.hiraya.text-editor", key: "editor-settings", value_json: '{"fontSize":18,"lineWrap":false,"autoSave":true,"autoFormat":true}', bytes: 67 },
      { app_id: "app.hiraya.text-editor", key: "draft", value_json: '{"text":"preserved"}', bytes: 20 },
      { app_id: "recovery.system.app.hiraya.text-editor", key: "draft", value_json: '{"text":"recover both"}', bytes: 23 },
      { app_id: "test.editor", key: "draft", value_json: '{"text":"quarantine me"}', bytes: 22 },
      { app_id: "test.viewer", key: "layout", value_json: '{"view":"grid"}', bytes: 15 },
    ]);
    expect(db.query("SELECT package_entry_id,digest,version,manifest_json,approved_at,quarantined_at FROM quarantined_apps WHERE app_id='app.hiraya.text-editor'").get()).toEqual({ package_entry_id: "legacy-package", digest: "d".repeat(64), version: "0.9.0", manifest_json: '{"name":"Legacy Text Editor"}', approved_at: 4, quarantined_at: 5 });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() => migrateSchema10To11Sql(9)).toThrow("requires version 10");
    db.close();
  });

  test("migrates a populated schema-8 outbox without inventing revision preconditions", () => {
    const operations = [
      { schemaVersion: 1, kind: "rename-desktop", desktop: { id: "desk", name: "Renamed" } },
      { schemaVersion: 1, kind: "patch-entry", entryId: "file", changes: { name: "renamed.txt" } },
      { schemaVersion: 1, kind: "save-content", entryId: "file", mimeType: "text/plain", size: 4, modifiedAt: 2 },
      { schemaVersion: 1, kind: "root-entry-positions", positions: [{ entryId: "file", position: { x: 1, y: 2 } }] },
      { schemaVersion: 1, kind: "layout", layout: { snapToGrid: false, wallpaper: { source: "dusk", fit: "cover", positionX: 50, positionY: 50, blur: 0, dim: 0, overlayColor: "#172329", overlayOpacity: 0 } } },
      { schemaVersion: 1, kind: "editor-settings", settings: { autoSave: true, autoFormat: false, fontSize: 13, language: "auto", lineWrap: true } },
      { schemaVersion: 1, kind: "select-theme", themeId: "hiraya-dusk" },
      { schemaVersion: 1, kind: "delete-desktop", desktopId: "other" },
    ];
    const db = new Database(":memory:");
    db.exec("CREATE TABLE outbox(sequence INTEGER PRIMARY KEY, operation_id TEXT, client_id TEXT, catalog_id TEXT, desktop_id TEXT, operation_schema_version INTEGER, operation_json TEXT, status TEXT, error TEXT); PRAGMA user_version=8;");
    const insert = db.prepare("INSERT INTO outbox VALUES (?, ?, 'client', 'catalog', 'desk', 1, ?, 'pending', NULL)");
    operations.forEach((operation, index) => insert.run(index + 1, String(index + 1), JSON.stringify(operation)));
    insert.finalize();
    db.exec(migrateSchema8To9Sql(8));
    const migrated = db.query("SELECT operation_json,error_code,conflict_details_json FROM outbox ORDER BY sequence").all() as Array<{ operation_json: string; error_code: null; conflict_details_json: null }>;
    expect(migrated.map((row) => JSON.parse(row.operation_json))).toEqual(operations);
    expect(migrated.every((row) => row.error_code === null && row.conflict_details_json === null)).toBe(true);
    db.close();
  });

  test("migrates a populated schema 2 database through the complete supported chain", () => {
    const db = new Database(":memory:");
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE desktops(id TEXT PRIMARY KEY);
      CREATE TABLE outbox(sequence INTEGER PRIMARY KEY, operation_id TEXT, client_id TEXT, catalog_id TEXT, desktop_id TEXT, operation_schema_version INTEGER, operation_json TEXT, status TEXT, error TEXT);
      CREATE TABLE preferences(singleton INTEGER PRIMARY KEY, auto_update INTEGER NOT NULL, external_embedded_previews INTEGER NOT NULL);
      INSERT INTO desktops VALUES ('desktop-a');
      INSERT INTO preferences VALUES (1, 0, 1);
      PRAGMA user_version=2;
    `);

    db.exec(migrateSchema2To3Sql(2));
    db.exec("INSERT INTO installed_apps VALUES ('user.editor', 'package-entry', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '1.0.0', '{}', 10)");
    db.exec("INSERT INTO app_storage VALUES ('user.editor', 'draft', '{\"text\":\"kept\"}', 15)");
    db.exec(migrateSchema3To4Sql(3));
    db.exec("INSERT INTO offline_pins VALUES ('desktop-a', 'entry-a', 20)");
    db.exec(migrateSchema4To5Sql(4));
    db.exec(migrateSchema5To6Sql(5));
    db.exec(migrateSchema6To7Sql(6));
    db.exec(migrateSchema7To8Sql(7));
    db.exec(migrateSchema8To9Sql(8));
    db.exec(migrateSchema9To10Sql(9));
    db.exec(migrateSchema10To11Sql(10));

    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: DATABASE_SCHEMA_VERSION });
    expect(db.query("SELECT auto_update,external_embedded_previews,allow_browser_pinch_zoom,search_all_desktops,onboarding_version,show_desktop_minimap,explorer_view FROM preferences").get()).toEqual({
      auto_update: 0,
      external_embedded_previews: 0,
      allow_browser_pinch_zoom: 0,
      search_all_desktops: 0,
      onboarding_version: 0,
      show_desktop_minimap: 1,
      explorer_view: "list",
    });
    expect(db.query("SELECT * FROM installed_apps").all()).toEqual([]);
    expect(db.query("SELECT * FROM app_storage").all()).toEqual([]);
    expect(db.query("SELECT * FROM file_associations").all()).toEqual([]);
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='offline_pins'").get()).toBeNull();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("keeps app RPC requests device-local", () => {
    const request = createStorageDbRequest(3, null, "readAppStorage", { appId: "test.editor", key: "theme" });
    expect(request.desktopId).toBeNull();
    expect(request.params).toEqual({ appId: "test.editor", key: "theme" });
  });

  test("handshakes the named worker protocol", () => {
    expect(STORAGE_PROTOCOL_VERSION).toBe(10);
    expect(parseStorageProtocol({ version: 10 })).toBe(10);
    expect(() => parseStorageProtocol({ version: 9 })).toThrow("outdated");
  });
});
