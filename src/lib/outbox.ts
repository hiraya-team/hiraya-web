import { DEFAULT_WALLPAPER, type DesktopEntry, type DesktopIconGroup, type DesktopIdentity, type DesktopLayout, type RootEntryPositionUpdate, type EditorSettings, type Wallpaper } from "../types";
import { assertIconGroupFolders, assertWallpaperSource, isValidId, parseDesktopIdentity, parseEditorSettings, parseEntries, parseLayout, parseLocalEntry, parsePosition, parseRootEntryPositions, parseRootEntryPositionUpdates } from "./contracts";
import type { DesktopStateSnapshot, PersistedDesktopState } from "../domain/desktop-state";
import { DEFAULT_THEME_ID, parseCustomTheme, parseThemeState } from "./themes";
import type { CustomTheme } from "../domain/theme";

export type OutboxOperation = ({ schemaVersion: 1 } & (
  | { kind: "create-desktop"; desktop: DesktopIdentity }
  | { kind: "rename-desktop"; desktop: DesktopIdentity; baseRevision?: number }
  | { kind: "delete-desktop"; desktopId: string; baseRevision?: number }
  | { kind: "create"; entries: DesktopEntry[] }
  | { kind: "patch-entry"; entryId: string; baseRevision?: number; conflictBase?: EntryConflictBase; changes: { name?: string; parentId?: string | null; position?: DesktopEntry["position"]; modifiedAt?: number } }
  | { kind: "delete"; entryId: string; baseRevision?: number }
  | { kind: "delete-entries"; entryIds: string[]; baseRevisions?: Record<string, number> }
  | { kind: "move-entries"; entryIds: string[]; baseRevisions?: Record<string, number>; conflictBases?: Record<string, EntryConflictBase>; parentId: string | null; modifiedAt?: number }
  | { kind: "entry-transfer"; entryIds: string[]; destinationDesktopId: string; parentId: string | null }
  | { kind: "save-content"; entryId: string; mimeType: string; size: number; modifiedAt: number; baseContentRevision?: number; stagedContentKey?: string }
  | { kind: "root-entry-positions"; positions: RootEntryPositionUpdate[]; baseRevisions?: Record<string, number>; conflictBases?: Record<string, EntryConflictBase> }
  | { kind: "layout"; layout: DesktopLayout; baseRevision?: number; conflictBase?: DesktopLayout }
  | { kind: "editor-settings"; settings: EditorSettings; baseRevision?: number; conflictBase?: EditorSettings }
  | { kind: "select-theme"; themeId: string; baseRevision?: number }
  | { kind: "upsert-theme"; theme: CustomTheme; baseRevision?: number }
  | { kind: "install-theme-package"; theme: CustomTheme; assetId: string; wallpaperKind: "static" | "animated" | "scene" | null; size: number; layout: DesktopLayout; baseThemeRevision?: number; baseSelectionRevision?: number; baseLayoutRevision?: number }
  | { kind: "delete-theme"; themeId: string; baseRevision?: number }
));

export type EntryConflictBase = Pick<DesktopEntry, "name" | "parentId" | "position">;

export type RevisionConflictDetails = {
  resourceKind: "desktop" | "entry" | "content" | "layout" | "editor-settings" | "theme-selection" | "theme";
  resourceId: string;
  expectedRevision: number;
  actualRevision: number;
};

export type OutboxRecord = {
  operationId: string;
  sequence: number;
  clientId: string;
  catalogId: string | null;
  desktopId: string;
  operation: OutboxOperation;
  status: "pending" | "blocked";
  error: string | null;
  errorCode?: string | null;
  conflictDetails?: RevisionConflictDetails | null;
  attemptCount: number;
  lastAttemptAt: number | null;
};

export const ACCESS_REVOKED_ERROR = "Access to this desktop was revoked. Local changes have not been uploaded.";

export function outboxOperationDesktopIds(record: Pick<OutboxRecord, "desktopId" | "operation">) {
  const ids = new Set([record.desktopId]);
  const operation = record.operation;
  if (operation.kind === "create-desktop" || operation.kind === "rename-desktop") ids.add(operation.desktop.id);
  if (operation.kind === "delete-desktop") ids.add(operation.desktopId);
  if (operation.kind === "entry-transfer") ids.add(operation.destinationDesktopId);
  return ids;
}

export function isAccessRevocationRecord(record: Pick<OutboxRecord, "status" | "error">) {
  return record.status === "blocked" && record.error === ACCESS_REVOKED_ERROR;
}

export function parseRevisionConflictDetails(value: unknown): RevisionConflictDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const kinds = new Set<RevisionConflictDetails["resourceKind"]>(["desktop", "entry", "content", "layout", "editor-settings", "theme-selection", "theme"]);
  if (Object.keys(item).some((key) => !["resourceKind", "resourceId", "expectedRevision", "actualRevision"].includes(key))) return null;
  if (typeof item.resourceKind !== "string" || !kinds.has(item.resourceKind as RevisionConflictDetails["resourceKind"]) || !isValidId(item.resourceId)) return null;
  if (!validBaseRevision(item.expectedRevision) || !validBaseRevision(item.actualRevision)) return null;
  return item as RevisionConflictDetails;
}

export function isRevisionConflictRecord(record: Pick<OutboxRecord, "status" | "errorCode" | "conflictDetails">) {
  return record.status === "blocked" && record.errorCode === "revision_conflict" && record.conflictDetails != null;
}

export function outboxRecordsDependingOnDesktop(records: readonly OutboxRecord[], desktopId: string) {
  return records.filter((record) => outboxOperationDesktopIds(record).has(desktopId));
}

export function outboxCausalKeys(record: Pick<OutboxRecord, "desktopId" | "operation">) {
  const operation = record.operation;
  const desktop = (id = record.desktopId) => `desktop:${id}`;
  const entry = (id: string) => `entry:${record.desktopId}:${id}`;
  switch (operation.kind) {
    case "create-desktop": return new Set([desktop(operation.desktop.id)]);
    case "rename-desktop": return new Set([desktop(operation.desktop.id)]);
    case "delete-desktop": return new Set([desktop(operation.desktopId)]);
    case "create": return new Set(operation.entries.flatMap((item) => [entry(item.id), ...(item.parentId ? [entry(item.parentId)] : [])]));
    case "patch-entry": return new Set([entry(operation.entryId), ...(operation.changes.parentId ? [entry(operation.changes.parentId)] : [])]);
    case "delete": return new Set([entry(operation.entryId), `content:${record.desktopId}:${operation.entryId}`]);
    case "delete-entries": return new Set(operation.entryIds.flatMap((id) => [entry(id), `content:${record.desktopId}:${id}`]));
    case "move-entries": return new Set([...operation.entryIds.map(entry), ...(operation.parentId ? [entry(operation.parentId)] : [])]);
    case "entry-transfer": return new Set([...operation.entryIds.map(entry), desktop(operation.destinationDesktopId)]);
    case "save-content": return new Set([`content:${record.desktopId}:${operation.entryId}`]);
    case "root-entry-positions": return new Set(operation.positions.map(({ entryId }) => entry(entryId)));
    case "layout": return new Set([`layout:${record.desktopId}`]);
    case "editor-settings": return new Set([`settings:${record.desktopId}`]);
    case "select-theme": return new Set([`theme-selection:${record.desktopId}`]);
    case "upsert-theme": return new Set([`theme:${record.desktopId}:${operation.theme.id}`]);
    case "install-theme-package": return new Set([`theme:${record.desktopId}:${operation.theme.id}`, `theme-selection:${record.desktopId}`, `layout:${record.desktopId}`, `content:${record.desktopId}:${operation.assetId}`]);
    case "delete-theme": return new Set([`theme:${record.desktopId}:${operation.themeId}`, `theme-selection:${record.desktopId}`]);
  }
}

export function outboxBlockingRecord(records: readonly OutboxRecord[], record: OutboxRecord) {
  const keys = outboxCausalKeys(record);
  return records.find((candidate) => candidate.sequence < record.sequence && candidate.status === "blocked" && [...outboxCausalKeys(candidate)].some((key) => keys.has(key))) ?? null;
}

export function wallpaperAfterEntryRemoval(entries: readonly DesktopEntry[], wallpaper: Wallpaper) {
  return wallpaper.source.startsWith("file:") && !entries.some((entry) => entry.id === wallpaper.source.slice(5))
    ? { ...DEFAULT_WALLPAPER }
    : wallpaper;
}

export function iconGroupsAfterEntryChange(entries: readonly DesktopEntry[], iconGroups: readonly DesktopIconGroup[]) {
  return iconGroups.filter((group) => entries.some((entry) => entry.id === group.folderId && entry.kind === "folder" && entry.parentId === null));
}

function resetWallpaperAfterEntryRemoval(state: PersistedDesktopState, entries: DesktopEntry[]): PersistedDesktopState {
  const wallpaper = wallpaperAfterEntryRemoval(entries, state.wallpaper);
  const iconGroups = iconGroupsAfterEntryChange(entries, state.iconGroups ?? []);
  const layoutChanged = wallpaper !== state.wallpaper || iconGroups.length !== (state.iconGroups?.length ?? 0);
  return {
    ...state,
    entries,
    wallpaper,
    iconGroups,
    sync: layoutChanged ? { ...state.sync, layoutRevision: state.sync.catalogRevision } : state.sync,
  };
}

export function outboxDesktopRetentionIds(records: readonly OutboxRecord[], catalogId: string | null) {
  const retained = new Set<string>();
  for (const record of records) {
    if (record.catalogId !== catalogId) continue;
    for (const id of outboxOperationDesktopIds(record)) retained.add(id);
  }
  return retained;
}

export function desktopPendingOperationProtection(records: readonly OutboxRecord[], desktopId: string) {
  const hasPendingOperation = records.some((record) => record.desktopId === desktopId
    || (record.operation.kind === "create-desktop" || record.operation.kind === "rename-desktop") && record.operation.desktop.id === desktopId
    || record.operation.kind === "delete-desktop" && record.operation.desktopId === desktopId
    || record.operation.kind === "entry-transfer" && record.operation.destinationDesktopId === desktopId);
  return hasPendingOperation ? "This desktop has pending or blocked changes. Reconnect or resolve them before deleting it." : "";
}

export function transferEntriesBetweenDesktopStates(
  source: PersistedDesktopState,
  destination: PersistedDesktopState,
  entryIds: string[],
  parentId: string | null,
  modifiedAt = Date.now(),
) {
  if (source.sync.catalogId !== destination.sync.catalogId) throw new Error("Desktops from different catalogs cannot transfer entries.");
  if (parentId !== null && !destination.entries.some((entry) => entry.id === parentId && entry.kind === "folder")) throw new Error("The destination folder no longer exists.");
  const roots = new Set(entryIds);
  if (!roots.size || roots.size !== entryIds.length || entryIds.some((id) => !source.entries.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
  const included = new Set(roots);
  for (let changed = true; changed;) {
    changed = false;
    for (const entry of source.entries) if (entry.parentId && included.has(entry.parentId) && !included.has(entry.id)) {
      included.add(entry.id);
      changed = true;
    }
  }
  const moving = source.entries.filter((entry) => included.has(entry.id)).map((entry) => roots.has(entry.id) ? { ...entry, parentId, modifiedAt } : entry);
  const sourceEntryRevisions = { ...source.sync.entryRevisions };
  const sourceContentRevisions = { ...source.sync.contentRevisions };
  const destinationEntryRevisions = { ...destination.sync.entryRevisions };
  const destinationContentRevisions = { ...destination.sync.contentRevisions };
  for (const entry of moving) {
    destinationEntryRevisions[entry.id] = sourceEntryRevisions[entry.id] ?? 0;
    delete sourceEntryRevisions[entry.id];
    if (entry.kind === "file") {
      destinationContentRevisions[entry.id] = sourceContentRevisions[entry.id] ?? 0;
      delete sourceContentRevisions[entry.id];
    }
  }
  const catalogRevision = Math.max(source.sync.catalogRevision, destination.sync.catalogRevision);
  const nextSource = resetWallpaperAfterEntryRemoval(source, source.entries.filter((entry) => !included.has(entry.id)));
  return {
    source: {
      ...nextSource,
      sync: { ...nextSource.sync, catalogRevision, layoutRevision: nextSource.wallpaper === source.wallpaper ? nextSource.sync.layoutRevision : catalogRevision, entryRevisions: sourceEntryRevisions, contentRevisions: sourceContentRevisions },
    },
    destination: {
      ...destination,
      entries: [...destination.entries, ...moving],
      sync: { ...destination.sync, catalogRevision, entryRevisions: destinationEntryRevisions, contentRevisions: destinationContentRevisions },
    },
    movedEntries: moving,
  };
}

export function normalizeOutboxOperation(operation: OutboxOperation): OutboxOperation {
  if (operation.schemaVersion !== 1) throw new Error("The queued operation uses an unsupported schema version.");
  const legacy = operation as unknown as Record<string, unknown>;
  if (legacy.kind === "update-entry") {
    const entry = parseLocalEntry(legacy.entry);
    operation = { schemaVersion: 1, kind: "patch-entry", entryId: entry.id, changes: { name: entry.name, parentId: entry.parentId, position: entry.position, modifiedAt: entry.modifiedAt } };
  } else if (operation.kind === "save-content" && "entry" in legacy) {
    const entry = parseLocalEntry(legacy.entry);
    if (entry.kind !== "file") throw new Error("Saved content requires a file entry.");
    operation = { schemaVersion: 1, kind: "save-content", entryId: entry.id, mimeType: entry.mimeType, size: entry.size, modifiedAt: entry.modifiedAt };
  }
  if (operation.kind === "create") {
    if (!Array.isArray(operation.entries)) throw new Error("The desktop entries have an unsupported format.");
    return { ...operation, entries: operation.entries.map(parseLocalEntry) };
  }
  if (operation.kind === "save-content") {
    if (!isValidId(operation.entryId) || typeof operation.mimeType !== "string" || !Number.isSafeInteger(operation.size) || operation.size < 0 || !Number.isSafeInteger(operation.modifiedAt) || operation.modifiedAt < 0 || !validOptionalBaseRevision(operation.baseContentRevision) || operation.stagedContentKey !== undefined && !/^\.mine-[0-9a-f-]{36}$/.test(operation.stagedContentKey)) throw new Error("Saved content has unsupported metadata.");
    return operation;
  }
  switch (operation.kind) {
    case "create-desktop":
      return { ...operation, desktop: parseDesktopIdentity(operation.desktop, true) };
    case "rename-desktop":
      if (!validOptionalBaseRevision(operation.baseRevision)) throw new Error("A queued desktop operation has an invalid base revision.");
      return { schemaVersion: 1, kind: "rename-desktop", desktop: parseDesktopIdentity(operation.desktop, true) };
    case "delete-desktop":
      if (!isValidId(operation.desktopId) || !validOptionalBaseRevision(operation.baseRevision)) throw new Error("A queued desktop operation has invalid metadata.");
      return { schemaVersion: 1, kind: "delete-desktop", desktopId: operation.desktopId };
    case "patch-entry": {
      if (!isValidId(operation.entryId) || !validOptionalBaseRevision(operation.baseRevision) || !operation.changes || typeof operation.changes !== "object") throw new Error("A queued entry patch has invalid metadata.");
      const allowed = new Set(["name", "parentId", "position", "modifiedAt"]);
      if (Object.keys(operation.changes).length === 0 || Object.keys(operation.changes).some((key) => !allowed.has(key))) throw new Error("A queued entry patch has unsupported changes.");
      return operation.conflictBase === undefined ? operation : { ...operation, conflictBase: parseEntryConflictBase(operation.conflictBase) };
    }
    case "delete":
      if (!isValidId(operation.entryId) || !validOptionalBaseRevision(operation.baseRevision)) throw new Error("A queued entry operation has invalid metadata.");
      return operation;
    case "delete-entries":
    case "move-entries":
      if (!Array.isArray(operation.entryIds) || operation.entryIds.length === 0 || new Set(operation.entryIds).size !== operation.entryIds.length || operation.entryIds.some((id) => !isValidId(id)) || operation.baseRevisions !== undefined && operation.entryIds.some((id) => !validBaseRevision(operation.baseRevisions?.[id]))) throw new Error("A queued entry operation has invalid entry revisions.");
      if (operation.kind === "move-entries" && (operation.parentId !== null && !isValidId(operation.parentId) || operation.modifiedAt !== undefined && (!Number.isSafeInteger(operation.modifiedAt) || operation.modifiedAt < 0))) throw new Error("A queued move has an invalid parent or timestamp.");
      return operation.kind === "move-entries" && operation.conflictBases !== undefined ? { ...operation, conflictBases: parseEntryConflictBases(operation.conflictBases, operation.entryIds) } : operation;
    case "entry-transfer":
      if (!isValidId(operation.destinationDesktopId) || !Array.isArray(operation.entryIds) || operation.entryIds.length === 0 || new Set(operation.entryIds).size !== operation.entryIds.length || operation.entryIds.some((id) => !isValidId(id)) || operation.parentId !== null && !isValidId(operation.parentId)) throw new Error("A queued entry transfer has an unsupported format.");
      return operation;
    case "root-entry-positions":
      return { ...operation, positions: parseRootEntryPositions(operation.positions), ...(operation.conflictBases === undefined ? {} : { conflictBases: parseEntryConflictBases(operation.conflictBases, operation.positions.map(({ entryId }) => entryId)) }) };
    case "layout":
      if (!validOptionalBaseRevision(operation.baseRevision)) throw new Error("A queued layout has an invalid base revision.");
      return { ...operation, layout: parseLayout(operation.layout), ...(operation.conflictBase === undefined ? {} : { conflictBase: parseLayout(operation.conflictBase) }) };
    case "editor-settings":
      if (!validOptionalBaseRevision(operation.baseRevision)) throw new Error("Queued editor settings have an invalid base revision.");
      return { ...operation, settings: parseEditorSettings(operation.settings), ...(operation.conflictBase === undefined ? {} : { conflictBase: parseEditorSettings(operation.conflictBase) }) };
    case "select-theme":
    case "delete-theme":
      if (!isValidId(operation.themeId) || !validOptionalBaseRevision(operation.baseRevision)) throw new Error("A queued theme operation has invalid metadata.");
      return operation;
    case "upsert-theme":
      if (!validOptionalBaseRevision(operation.baseRevision)) throw new Error("A queued theme has an invalid base revision.");
      return { ...operation, theme: parseCustomTheme(operation.theme) };
    case "install-theme-package":
      if (!isValidId(operation.assetId) || !Number.isSafeInteger(operation.size) || (operation.wallpaperKind === null ? operation.size !== 0 : operation.size < 1 || operation.size > 32 * 1024 * 1024 || !["static", "animated", "scene"].includes(operation.wallpaperKind))
        || !validOptionalBaseRevision(operation.baseThemeRevision) || !validOptionalBaseRevision(operation.baseSelectionRevision) || !validOptionalBaseRevision(operation.baseLayoutRevision)) throw new Error("A queued theme package has invalid metadata.");
      return { ...operation, theme: parseCustomTheme(operation.theme), layout: parseLayout(operation.layout) };
    default:
      throw new Error("The queued operation has an unsupported kind.");
  }
}

function validBaseRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validOptionalBaseRevision(value: unknown): value is number | undefined {
  return value === undefined || validBaseRevision(value);
}

function parseEntryConflictBase(value: unknown): EntryConflictBase {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A queued entry conflict base has an unsupported format.");
  const base = value as Record<string, unknown>;
  if (Object.keys(base).some((key) => !["name", "parentId", "position"].includes(key)) || typeof base.name !== "string" || base.parentId !== null && !isValidId(base.parentId)) throw new Error("A queued entry conflict base has an unsupported format.");
  return { name: base.name, parentId: base.parentId as string | null, position: parsePosition(base.position) };
}

function parseEntryConflictBases(value: unknown, entryIds: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Queued entry conflict bases have an unsupported format.");
  const bases = value as Record<string, unknown>;
  if (Object.keys(bases).length !== entryIds.length || entryIds.some((id) => !(id in bases))) throw new Error("Queued entry conflict bases are incomplete.");
  return Object.fromEntries(entryIds.map((id) => [id, parseEntryConflictBase(bases[id])]));
}

export function applyOutboxOperation(state: PersistedDesktopState, operation: OutboxOperation): PersistedDesktopState {
  operation = normalizeOutboxOperation(operation);
  let entries = state.entries;
  switch (operation.kind) {
    case "create-desktop":
    case "rename-desktop":
    case "delete-desktop":
      return state;
    case "create":
      entries = parseEntries([...entries, ...operation.entries]) as DesktopEntry[];
      break;
    case "patch-entry": {
      if (!entries.some((entry) => entry.id === operation.entryId)) throw new Error("That entry no longer exists.");
      entries = parseEntries(entries.map((entry) => entry.id === operation.entryId ? { ...entry, ...operation.changes } : entry)) as DesktopEntry[];
      break;
    }
    case "delete": {
      if (!entries.some((entry) => entry.id === operation.entryId)) throw new Error("That entry no longer exists.");
      const removed = new Set([operation.entryId]);
      for (let changed = true; changed;) {
        changed = false;
        for (const entry of entries) if (entry.parentId && removed.has(entry.parentId) && !removed.has(entry.id)) {
          removed.add(entry.id);
          changed = true;
        }
      }
      entries = entries.filter((entry) => !removed.has(entry.id));
      break;
    }
    case "delete-entries": {
      if (operation.entryIds.some((id) => !entries.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
      const removed = new Set(operation.entryIds);
      for (let changed = true; changed;) {
        changed = false;
        for (const entry of entries) if (entry.parentId && removed.has(entry.parentId) && !removed.has(entry.id)) {
          removed.add(entry.id);
          changed = true;
        }
      }
      entries = entries.filter((entry) => !removed.has(entry.id));
      break;
    }
    case "entry-transfer": {
      const removed = new Set(operation.entryIds);
      if (!removed.size || operation.entryIds.some((id) => !entries.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
      for (let changed = true; changed;) {
        changed = false;
        for (const entry of entries) if (entry.parentId && removed.has(entry.parentId) && !removed.has(entry.id)) { removed.add(entry.id); changed = true; }
      }
      entries = entries.filter((entry) => !removed.has(entry.id));
      const entryRevisions = { ...state.sync.entryRevisions };
      const contentRevisions = { ...state.sync.contentRevisions };
      for (const id of removed) {
        delete entryRevisions[id];
        delete contentRevisions[id];
      }
      const projected = resetWallpaperAfterEntryRemoval(state, entries);
      return { ...projected, sync: { ...projected.sync, entryRevisions, contentRevisions } };
    }
    case "move-entries": {
      const moving = new Set(operation.entryIds);
      if (moving.size !== operation.entryIds.length || operation.entryIds.some((id) => !entries.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
      entries = parseEntries(entries.map((entry) => moving.has(entry.id) ? { ...entry, parentId: operation.parentId, modifiedAt: operation.modifiedAt ?? entry.modifiedAt } : entry)) as DesktopEntry[];
      break;
    }
    case "save-content":
      if (!entries.some((entry) => entry.id === operation.entryId && entry.kind === "file")) throw new Error("That file no longer exists.");
      entries = parseEntries(entries.map((entry) => entry.id === operation.entryId && entry.kind === "file" ? { ...entry, mimeType: operation.mimeType, size: operation.size, modifiedAt: operation.modifiedAt } : entry)) as DesktopEntry[];
      break;
    case "root-entry-positions": {
      const positions = parseRootEntryPositionUpdates(operation.positions, entries);
      const byId = new Map(positions.map((item) => [item.entryId, item.position]));
      entries = entries.map((entry) => byId.has(entry.id) ? { ...entry, position: byId.get(entry.id)! } : entry);
      break;
    }
    case "layout": {
      const layout = parseLayout(operation.layout);
      assertWallpaperSource(entries, layout.wallpaper);
      assertIconGroupFolders(entries, layout);
      return { ...state, autoArrangeIcons: layout.autoArrangeIcons, snapToGrid: layout.snapToGrid, gridSize: layout.gridSize, wallpaper: layout.wallpaper, widgets: layout.widgets, iconGroups: layout.iconGroups };
    }
    case "editor-settings":
      return { ...state, editorSettings: parseEditorSettings(operation.settings) };
    case "select-theme":
      return { ...state, appearance: parseThemeState({ ...state.appearance, selectedThemeId: operation.themeId }) };
    case "upsert-theme": {
      const theme = parseCustomTheme(operation.theme);
      const exists = state.appearance.customThemes.some((item) => item.id === theme.id);
      const customThemes = exists
        ? state.appearance.customThemes.map((item) => item.id === theme.id ? theme : item)
        : [...state.appearance.customThemes, theme];
      return { ...state, appearance: parseThemeState({ ...state.appearance, customThemes }) };
    }
    case "install-theme-package": {
      const theme = parseCustomTheme(operation.theme);
      const customThemes = state.appearance.customThemes.some((item) => item.id === theme.id)
        ? state.appearance.customThemes.map((item) => item.id === theme.id ? theme : item)
        : [...state.appearance.customThemes, theme];
      const appearance = parseThemeState({ selectedThemeId: theme.id, customThemes });
      const layout = parseLayout(operation.wallpaperKind === null ? operation.layout : { ...operation.layout, wallpaper: { ...operation.layout.wallpaper, source: `theme:${theme.id}` } });
      return { ...state, autoArrangeIcons: layout.autoArrangeIcons, snapToGrid: layout.snapToGrid, gridSize: layout.gridSize, wallpaper: layout.wallpaper, widgets: state.widgets, iconGroups: state.iconGroups, appearance };
    }
    case "delete-theme": {
      if (!state.appearance.customThemes.some((theme) => theme.id === operation.themeId)) return state;
      const customThemes = state.appearance.customThemes.filter((theme) => theme.id !== operation.themeId);
      const selectedThemeId = state.appearance.selectedThemeId === operation.themeId ? DEFAULT_THEME_ID : state.appearance.selectedThemeId;
      return { ...state, wallpaper: state.wallpaper.source === `theme:${operation.themeId}` ? DEFAULT_WALLPAPER : state.wallpaper, appearance: parseThemeState({ selectedThemeId, customThemes }) };
    }
  }
  return resetWallpaperAfterEntryRemoval(state, entries);
}

export function rebaseOutboxOperationAfterAcknowledgement(state: PersistedDesktopState, operation: OutboxOperation, acknowledgedRevision: number): OutboxOperation {
  const entryRevision = (id: string, base?: number) => state.sync.entryRevisions[id] === acknowledgedRevision ? acknowledgedRevision : base;
  switch (operation.kind) {
    case "patch-entry":
    case "delete":
      return { ...operation, baseRevision: entryRevision(operation.entryId, operation.baseRevision) };
    case "delete-entries":
    case "move-entries":
      return { ...operation, baseRevisions: operation.baseRevisions === undefined ? undefined : Object.fromEntries(operation.entryIds.map((id) => [id, entryRevision(id, operation.baseRevisions![id])!])) };
    case "root-entry-positions":
      return { ...operation, baseRevisions: operation.baseRevisions === undefined ? undefined : Object.fromEntries(operation.positions.map(({ entryId }) => [entryId, entryRevision(entryId, operation.baseRevisions![entryId])!])) };
    case "save-content":
      return { ...operation, baseContentRevision: state.sync.contentRevisions[operation.entryId] === acknowledgedRevision ? acknowledgedRevision : operation.baseContentRevision };
    case "layout":
      return { ...operation, baseRevision: state.sync.layoutRevision === acknowledgedRevision ? acknowledgedRevision : operation.baseRevision };
    case "editor-settings":
      return { ...operation, baseRevision: state.sync.settingsRevision === acknowledgedRevision ? acknowledgedRevision : operation.baseRevision };
    case "select-theme":
      return { ...operation, baseRevision: state.sync.themeSelectionRevision === acknowledgedRevision ? acknowledgedRevision : operation.baseRevision };
    case "upsert-theme":
    case "delete-theme":
      return { ...operation, baseRevision: state.sync.themeRevisions[operation.kind === "upsert-theme" ? operation.theme.id : operation.themeId] === acknowledgedRevision ? acknowledgedRevision : operation.baseRevision };
    case "install-theme-package":
      return {
        ...operation,
        baseThemeRevision: state.sync.themeRevisions[operation.theme.id] === acknowledgedRevision ? acknowledgedRevision : operation.baseThemeRevision,
        baseSelectionRevision: state.sync.themeSelectionRevision === acknowledgedRevision ? acknowledgedRevision : operation.baseSelectionRevision,
        baseLayoutRevision: state.sync.layoutRevision === acknowledgedRevision ? acknowledgedRevision : operation.baseLayoutRevision,
      };
    case "rename-desktop":
    case "delete-desktop":
      return state.sync.catalogRevision === acknowledgedRevision ? { ...operation, baseRevision: acknowledgedRevision } : operation;
    default:
      return operation;
  }
}

export function rebaseOutboxOperationForConflict(operation: OutboxOperation, conflict: RevisionConflictDetails): OutboxOperation | null {
  const revision = conflict.actualRevision;
  switch (operation.kind) {
    case "rename-desktop":
      return conflict.resourceKind === "desktop" && conflict.resourceId === operation.desktop.id ? { ...operation, baseRevision: revision } : null;
    case "delete-desktop":
      return conflict.resourceKind === "desktop" && conflict.resourceId === operation.desktopId ? { ...operation, baseRevision: revision } : null;
    case "patch-entry":
    case "delete":
      return conflict.resourceKind === "entry" && conflict.resourceId === operation.entryId ? { ...operation, baseRevision: revision } : null;
    case "delete-entries":
    case "move-entries":
      return conflict.resourceKind === "entry" && operation.entryIds.includes(conflict.resourceId)
        ? { ...operation, baseRevisions: { ...(operation.baseRevisions ?? {}), [conflict.resourceId]: revision } }
        : null;
    case "root-entry-positions":
      return conflict.resourceKind === "entry" && operation.positions.some(({ entryId }) => entryId === conflict.resourceId)
        ? { ...operation, baseRevisions: { ...(operation.baseRevisions ?? {}), [conflict.resourceId]: revision } }
        : null;
    case "save-content":
      return conflict.resourceKind === "content" && conflict.resourceId === operation.entryId ? { ...operation, baseContentRevision: revision } : null;
    case "layout":
      return conflict.resourceKind === "layout" ? { ...operation, baseRevision: revision } : null;
    case "editor-settings":
      return conflict.resourceKind === "editor-settings" ? { ...operation, baseRevision: revision } : null;
    case "select-theme":
      return conflict.resourceKind === "theme-selection" ? { ...operation, baseRevision: revision } : null;
    case "upsert-theme":
      return conflict.resourceKind === "theme" && conflict.resourceId === operation.theme.id ? { ...operation, baseRevision: revision } : null;
    case "install-theme-package":
      if (conflict.resourceKind === "theme" && conflict.resourceId === operation.theme.id) return { ...operation, baseThemeRevision: revision };
      if (conflict.resourceKind === "theme-selection") return { ...operation, baseSelectionRevision: revision };
      if (conflict.resourceKind === "layout") return { ...operation, baseLayoutRevision: revision };
      return null;
    case "delete-theme":
      return conflict.resourceKind === "theme" && conflict.resourceId === operation.themeId ? { ...operation, baseRevision: revision } : null;
    default:
      return null;
  }
}

export type OutboxConflictResolution =
  | { kind: "rebase"; operation: OutboxOperation }
  | { kind: "blocked"; fields: string[] };

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const entryBase = (entry: DesktopEntry): EntryConflictBase => ({ name: entry.name, parentId: entry.parentId, position: entry.position });

function changedItemIds<T>(base: readonly T[], value: readonly T[], id: (item: T) => string) {
  const before = new Map(base.map((item) => [id(item), item]));
  const after = new Map(value.map((item) => [id(item), item]));
  return new Set([...new Set([...before.keys(), ...after.keys()])].filter((key) => !same(before.get(key), after.get(key))));
}

function mergeItems<T>(base: readonly T[], local: readonly T[], remote: readonly T[], id: (item: T) => string) {
  const changed = changedItemIds(base, local, id);
  const localById = new Map(local.map((item) => [id(item), item]));
  const merged = remote.filter((item) => !changed.has(id(item)) || localById.has(id(item)));
  for (const itemId of changed) {
    const item = localById.get(itemId);
    if (!item) continue;
    const index = merged.findIndex((candidate) => id(candidate) === itemId);
    if (index < 0) merged.push(item); else merged[index] = item;
  }
  return merged;
}

export function mergeDesktopLayout(base: DesktopLayout, local: DesktopLayout, remote: DesktopLayout) {
  const merged = parseLayout({
    autoArrangeIcons: same(local.autoArrangeIcons, base.autoArrangeIcons) ? remote.autoArrangeIcons : local.autoArrangeIcons,
    snapToGrid: same(local.snapToGrid, base.snapToGrid) ? remote.snapToGrid : local.snapToGrid,
    gridSize: same(local.gridSize, base.gridSize) ? remote.gridSize : local.gridSize,
    wallpaper: same(local.wallpaper, base.wallpaper) ? remote.wallpaper : local.wallpaper,
    widgets: mergeItems(base.widgets, local.widgets, remote.widgets, (item) => item.id),
    iconGroups: mergeItems(base.iconGroups, local.iconGroups, remote.iconGroups, (item) => item.folderId),
  });
  return same(merged, local) ? local : merged;
}

function mergeLayout(operation: Extract<OutboxOperation, { kind: "layout" }>, remote: DesktopLayout) {
  return operation.conflictBase ? mergeDesktopLayout(operation.conflictBase, operation.layout, remote) : operation.layout;
}

function mergeEditorSettings(operation: Extract<OutboxOperation, { kind: "editor-settings" }>, remote: EditorSettings) {
  const base = operation.conflictBase;
  if (!base) return operation.settings;
  return parseEditorSettings(Object.fromEntries((Object.keys(base) as Array<keyof EditorSettings>).map((key) => [key, same(operation.settings[key], base[key]) ? remote[key] : operation.settings[key]])));
}

export function resolveOutboxRevisionConflict(operation: OutboxOperation, conflict: RevisionConflictDetails, remote: DesktopStateSnapshot): OutboxConflictResolution {
  const rebased = rebaseOutboxOperationForConflict(operation, conflict);
  if (!rebased) return { kind: "blocked", fields: [conflict.resourceKind] };
  if (operation.kind === "patch-entry") {
    const current = remote.entries.find((entry) => entry.id === operation.entryId);
    if (!operation.conflictBase || !current) return { kind: "blocked", fields: ["item"] };
    const currentBase = entryBase(current);
    const fields = (["name", "parentId", "position"] as const).filter((key) => key in operation.changes && !same(currentBase[key], operation.conflictBase![key]) && !same(currentBase[key], operation.changes[key]));
    return fields.length ? { kind: "blocked", fields: fields.map((field) => field === "parentId" ? "folder" : field) } : { kind: "rebase", operation: rebased };
  }
  if (operation.kind === "move-entries" && conflict.resourceKind === "entry") {
    const base = operation.conflictBases?.[conflict.resourceId];
    const current = remote.entries.find((entry) => entry.id === conflict.resourceId);
    if (!base || !current || current.parentId !== base.parentId && current.parentId !== operation.parentId) return { kind: "blocked", fields: ["folder"] };
    return { kind: "rebase", operation: rebased };
  }
  if (operation.kind === "root-entry-positions" && conflict.resourceKind === "entry") {
    const base = operation.conflictBases?.[conflict.resourceId];
    const current = remote.entries.find((entry) => entry.id === conflict.resourceId);
    const intended = operation.positions.find(({ entryId }) => entryId === conflict.resourceId)?.position;
    if (!base || !current || !intended || !same(current.position, base.position) && !same(current.position, intended)) return { kind: "blocked", fields: ["position"] };
    return { kind: "rebase", operation: rebased };
  }
  if (operation.kind === "layout") {
    if (!operation.conflictBase) return { kind: "blocked", fields: ["layout"] };
    const fields: string[] = (["autoArrangeIcons", "snapToGrid", "gridSize", "wallpaper"] as const).filter((key) => !same(operation.layout[key], operation.conflictBase![key]) && !same(remote.layout[key], operation.conflictBase![key]) && !same(remote.layout[key], operation.layout[key]));
    const localWidgets = changedItemIds(operation.conflictBase.widgets, operation.layout.widgets, (item) => item.id);
    const remoteWidgets = changedItemIds(operation.conflictBase.widgets, remote.layout.widgets, (item) => item.id);
    const localGroups = changedItemIds(operation.conflictBase.iconGroups, operation.layout.iconGroups, (item) => item.folderId);
    const remoteGroups = changedItemIds(operation.conflictBase.iconGroups, remote.layout.iconGroups, (item) => item.folderId);
    if ([...localWidgets].some((id) => remoteWidgets.has(id) && !same(operation.layout.widgets.find((item) => item.id === id), remote.layout.widgets.find((item) => item.id === id)))) fields.push("widgets");
    if ([...localGroups].some((id) => remoteGroups.has(id) && !same(operation.layout.iconGroups.find((item) => item.folderId === id), remote.layout.iconGroups.find((item) => item.folderId === id)))) fields.push("icon groups");
    return fields.length ? { kind: "blocked", fields: fields.map((field) => field === "autoArrangeIcons" ? "icon auto-arrangement" : field === "snapToGrid" ? "grid snapping" : field === "gridSize" ? "grid size" : field) } : { kind: "rebase", operation: { ...operation, baseRevision: (rebased as typeof operation).baseRevision, layout: mergeLayout(operation, remote.layout) } };
  }
  if (operation.kind === "editor-settings") {
    if (!operation.conflictBase) return { kind: "blocked", fields: ["editor settings"] };
    const fields = (Object.keys(operation.conflictBase) as Array<keyof EditorSettings>).filter((key) => !same(operation.settings[key], operation.conflictBase![key]) && !same(remote.editorSettings[key], operation.conflictBase![key]) && !same(remote.editorSettings[key], operation.settings[key]));
    return fields.length ? { kind: "blocked", fields: fields.map((field) => field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)) } : { kind: "rebase", operation: { ...operation, baseRevision: (rebased as typeof operation).baseRevision, settings: mergeEditorSettings(operation, remote.editorSettings) } };
  }
  return { kind: "blocked", fields: [conflict.resourceKind] };
}

export function forceRebaseOutboxOperation(operation: OutboxOperation, conflict: RevisionConflictDetails, remote: DesktopStateSnapshot): OutboxOperation | null {
  if (!rebaseOutboxOperationForConflict(operation, conflict)) return null;
  switch (operation.kind) {
    case "patch-entry":
    case "delete":
      return { ...operation, baseRevision: Math.max(remote.sync.entryRevisions[operation.entryId] ?? 0, conflict.actualRevision) };
    case "delete-entries":
    case "move-entries":
      return { ...operation, baseRevisions: Object.fromEntries(operation.entryIds.map((id) => [id, remote.sync.entryRevisions[id] ?? operation.baseRevisions?.[id] ?? 0])) };
    case "root-entry-positions":
      return { ...operation, baseRevisions: Object.fromEntries(operation.positions.map(({ entryId }) => [entryId, remote.sync.entryRevisions[entryId] ?? operation.baseRevisions?.[entryId] ?? 0])) };
    case "save-content":
      return { ...operation, baseContentRevision: Math.max(remote.sync.contentRevisions[operation.entryId] ?? 0, conflict.actualRevision) };
    case "layout":
      return { ...operation, layout: mergeLayout(operation, remote.layout), baseRevision: Math.max(remote.sync.layoutRevision, conflict.actualRevision) };
    case "editor-settings":
      return { ...operation, settings: mergeEditorSettings(operation, remote.editorSettings), baseRevision: Math.max(remote.sync.settingsRevision, conflict.actualRevision) };
    case "select-theme":
      return { ...operation, baseRevision: Math.max(remote.sync.themeSelectionRevision, conflict.actualRevision) };
    case "upsert-theme":
    case "delete-theme":
      return { ...operation, baseRevision: Math.max(remote.sync.themeRevisions[operation.kind === "upsert-theme" ? operation.theme.id : operation.themeId] ?? 0, conflict.actualRevision) };
    case "install-theme-package":
      return { ...operation, baseThemeRevision: remote.sync.themeRevisions[operation.theme.id] ?? 0, baseSelectionRevision: remote.sync.themeSelectionRevision, baseLayoutRevision: remote.sync.layoutRevision };
    default:
      return null;
  }
}
