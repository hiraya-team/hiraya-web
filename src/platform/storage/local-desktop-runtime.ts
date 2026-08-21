import type { FilePreviewSource } from "@hiraya-team/apps-contracts";
import type { CustomTheme, ThemeWallpaperPackage } from "../../domain/theme";
import type { DesktopStateSnapshot } from "../../domain/desktop-state";
import type { ActivityPage, ActivityQuery } from "../../lib/activity";
import { parseActivityQuery } from "../../lib/activity";
import { ContentRevisionConflictError, type SaveFileOptions } from "../../domain/files";
import { importedFileMimeType } from "../../domain/scene";
import { filesystemDatabaseName, type StoredOperation, type Workspace } from "../../filesystem/database";
import { sha256Hex, type ActiveSetting, type JsonValue, type Node } from "../../filesystem/model";
import type { CreateForestNode, WorkspaceFilesystem } from "./workspace-filesystem";
import { openWorkspaceFilesystem } from "./workspace-filesystem";
import { parseEditorSettings, parseLayout, type SystemEntriesDocument, type SystemEntry, type SystemRole, type TrashDeleteResult, type TrashDocument, type TrashEntry, type TrashRestoreResult } from "../../lib/contracts";
import { DEFAULT_EDITOR_SETTINGS, emptySyncState } from "../../lib/desktop-state";
import { offlineFilesUnderRoots, type OfflineStorageInventory } from "../../lib/offline-availability";
import type { ClipboardEntrySnapshot } from "../../lib/clipboard";
import { localDesktopIdentity } from "../../lib/permissions";
import { DEFAULT_THEME_STATE } from "../../lib/themes";
import { parseCustomTheme, parseThemeState } from "../../lib/themes";
import type { DesktopEntry, DesktopIdentity, DesktopLayout, EditorSettings, EntryPosition, FileEntry, FolderEntry, RootEntryPositionUpdate } from "../../types";
import { DEFAULT_WALLPAPER } from "../../types";
import type { DesktopPreference } from "../../lib/desktop-preferences";
import type { OutboxRecord } from "../../lib/outbox";
import type { ContentConflictBundle, DesktopRegistry, FileTransferState, OfflineOperationProgress, SyncStatus } from "./runtime-types";
import { openApprovedPackageArchives } from "./approved-package-archives";
import * as repositories from "./fresh-repositories";
import { initializeLocalWeb2Storage, type LocalWeb2Startup } from "./local-startup";

export type ProjectedDesktopRuntimeOptions = {
  initialize?: () => Promise<LocalWeb2Startup>;
  status?: () => SyncStatus;
  subscribeStatus?: (listener: (status: SyncStatus) => void) => () => void;
  registry?: (workspaces: Workspace[], active: Workspace) => DesktopRegistry;
  prepareWorkspace?: (workspaceId: string) => Promise<void>;
  cleanupOrphans?: boolean;
  hydrateFolder?: (workspaceId: string, folderId: string) => Promise<void>;
  hydrateNode?: (workspaceId: string, nodeId: string) => Promise<void>;
  prepareFile?: (workspaceId: string, fileId: string) => Promise<void>;
  prepareVersion?: (workspaceId: string, manifestHash: string) => Promise<void>;
  thumbnail?: (workspaceId: string, fileId: string) => Promise<FilePreviewSource>;
  createWorkspace?: (startup: LocalWeb2Startup, name: string) => Promise<Workspace>;
  updateWorkspacePreferences?: (startup: LocalWeb2Startup, preferences: DesktopPreference[]) => Promise<void>;
  renameWorkspace?: (startup: LocalWeb2Startup, workspaceId: string, name: string) => Promise<Workspace>;
  deleteWorkspace?: (startup: LocalWeb2Startup, workspaceId: string) => Promise<void>;
  listActivity?: (query: ActivityQuery) => Promise<ActivityPage>;
  wake?: () => void;
  serverBuildTimestamp?: () => Promise<string | null>;
};

/** Projects a filesystem node as a desktop entry. */
function nodeEntry(node: Node): DesktopEntry {
  const base = { id: node.id, name: node.name, parentId: node.parentId, createdAt: node.createdAt, modifiedAt: node.modifiedAt, position: node.position };
  return node.kind === "folder" ? { ...base, kind: "folder" } : { ...base, kind: "file", mimeType: node.mimeType, size: node.size };
}

/** Returns the latest logical revision of a node. */
function nodeRevision(node: Node) {
  return Math.max(node.fieldTuples.name.logicalTime, node.fieldTuples.parent.logicalTime, node.fieldTuples.lifecycle.logicalTime, node.fieldTuples.position.logicalTime, node.fieldTuples.content?.logicalTime ?? 0);
}

/** Returns a setting value or its fallback. */
function settingValue(settings: ActiveSetting[], key: string, fallback: JsonValue) {
  return settings.find((setting) => setting.key === key)?.value ?? fallback;
}

/** Converts a value to its JSON representation. */
function json(value: unknown) {
  return structuredClone(value) as JsonValue;
}

/** Lists nodes. */
async function listNodes(filesystem: WorkspaceFilesystem) {
  const nodes: Node[] = [];
  const pending: Array<string | null> = [null];
  const visited = new Set<string>();
  for (let index = 0; index < pending.length; index += 1) {
    for (const node of await filesystem.listChildren(pending[index]!)) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      nodes.push(node);
      if (node.kind === "folder") pending.push(node.id);
    }
  }
  return nodes;
}

/** Projects a workspace filesystem as a desktop snapshot. */
async function projectSnapshot(filesystem: WorkspaceFilesystem, workspace: Workspace): Promise<DesktopStateSnapshot> {
  const [nodes, grid, wallpaperSettings, editorSettings, templateSettings, widgetSettings, groupSettings, selectionSettings, themeSettings] = await Promise.all([
    listNodes(filesystem),
    filesystem.readDesktopGridSettings(),
    filesystem.listSettings("wallpaper"),
    filesystem.listSettings("editor"),
    filesystem.listSettings("file-templates"),
    filesystem.listSettings("widgets"),
    filesystem.listSettings("icon-groups"),
    filesystem.listSettings("theme-selection"),
    filesystem.listSettings("custom-themes"),
  ]);
  const wallpaper = settingValue(wallpaperSettings, "layout", json(DEFAULT_WALLPAPER));
  const widgets = settingValue(widgetSettings, "layout", []);
  const iconGroups = settingValue(groupSettings, "layout", []);
  const storedEditor = settingValue(editorSettings, "settings", json({
    autoSave: DEFAULT_EDITOR_SETTINGS.autoSave,
    autoFormat: DEFAULT_EDITOR_SETTINGS.autoFormat,
    fontSize: DEFAULT_EDITOR_SETTINGS.fontSize,
    language: DEFAULT_EDITOR_SETTINGS.language,
    lineWrap: DEFAULT_EDITOR_SETTINGS.lineWrap,
  }));
  const templates = settingValue(templateSettings, "templates", json(DEFAULT_EDITOR_SETTINGS.fileCreationTemplates));
  const customThemes = themeSettings.map((setting) => parseCustomTheme(setting.value));
  const appearance = parseThemeState({
    selectedThemeId: settingValue(selectionSettings, "selected", DEFAULT_THEME_STATE.selectedThemeId),
    customThemes,
  });
  const entries = nodes.map(nodeEntry);
  const layout = parseLayout({ ...grid, wallpaper, widgets, iconGroups });
  const editor = parseEditorSettings({ ...(storedEditor as Record<string, unknown>), fileCreationTemplates: templates });
  const settingRevisions = [...wallpaperSettings, ...widgetSettings, ...groupSettings];
  const sync = emptySyncState();
  sync.entryRevisions = Object.fromEntries(nodes.map((node) => [node.id, nodeRevision(node)]));
  sync.contentRevisions = Object.fromEntries(nodes.flatMap((node) => node.kind === "file" ? [[node.id, node.fieldTuples.content!.logicalTime]] : []));
  sync.catalogRevision = workspace.localRevision;
  sync.layoutRevision = Math.max(0, ...settingRevisions.map(({ logicalTime }) => logicalTime));
  sync.settingsRevision = Math.max(0, ...editorSettings.map(({ logicalTime }) => logicalTime), ...templateSettings.map(({ logicalTime }) => logicalTime));
  sync.themeSelectionRevision = Math.max(0, ...selectionSettings.map(({ logicalTime }) => logicalTime));
  sync.themeRevisions = Object.fromEntries(themeSettings.map(({ key, logicalTime }) => [key, logicalTime]));
  return { entries, layout, editorSettings: editor, appearance, sync };
}

/** Builds the local desktop identity for a workspace. */
function localIdentity(workspace: Workspace): DesktopIdentity {
  return { ...localDesktopIdentity(workspace.id, workspace.name), pinned: workspace.pinned };
}

/** Reports whether two desktop entries have identical metadata. */
function sameEntry(left: DesktopEntry, right: DesktopEntry) {
  return left.kind === right.kind
    && left.id === right.id
    && left.name === right.name
    && left.parentId === right.parentId
    && left.createdAt === right.createdAt
    && left.modifiedAt === right.modifiedAt
    && left.position.x === right.position.x
    && left.position.y === right.position.y
    && (left.kind === "folder" || right.kind === "file" && left.mimeType === right.mimeType && left.size === right.size);
}

/** Reuses unchanged values from the previous desktop projection. */
function retainProjection(previous: DesktopStateSnapshot | undefined, next: DesktopStateSnapshot) {
  if (!previous) return next;
  const previousEntries = new Map(previous.entries.map((entry) => [entry.id, entry]));
  const projectedEntries = next.entries.map((entry) => {
    const prior = previousEntries.get(entry.id);
    return prior && sameEntry(prior, entry) ? prior : entry;
  });
  const entries = projectedEntries.length === previous.entries.length && projectedEntries.every((entry, index) => entry === previous.entries[index]) ? previous.entries : projectedEntries;
  const layout = JSON.stringify(previous.layout) === JSON.stringify(next.layout) ? previous.layout : next.layout;
  const editorSettings = JSON.stringify(previous.editorSettings) === JSON.stringify(next.editorSettings) ? previous.editorSettings : next.editorSettings;
  const appearance = JSON.stringify(previous.appearance) === JSON.stringify(next.appearance) ? previous.appearance : next.appearance;
  return { ...next, entries, layout, editorSettings, appearance };
}

/** Computes operation timestamp. */
function operationTimestamp(stored: StoredOperation) {
  const operation = stored.operation;
  if ("modifiedAt" in operation) return operation.modifiedAt;
  if (operation.kind === "trash") return operation.trashedAt;
  if ((operation.kind === "create" || operation.kind === "copy") && operation.nodes[0]) return operation.nodes[0].modifiedAt;
  return 0;
}

/** Returns node IDs affected by a stored operation. */
function operationNodeIds(stored: StoredOperation) {
  const operation = stored.operation;
  if (operation.kind === "create" || operation.kind === "copy") return operation.nodes.map(({ id }) => id);
  if (operation.kind === "write" || operation.kind === "rename") return [operation.nodeId];
  if (operation.kind === "position") return operation.positions.map(({ nodeId }) => nodeId);
  if (operation.kind === "move" || operation.kind === "trash" || operation.kind === "restore" || operation.kind === "purge" || operation.kind === "transfer") return operation.nodeIds;
  return [];
}

/** Computes operation summary. */
function operationSummary(stored: StoredOperation) {
  const kind = stored.operation.kind;
  if (kind === "create") return "Created files and folders";
  if (kind === "copy") return "Pasted files and folders";
  if (kind === "write") return "Edited file contents";
  if (kind === "rename") return "Renamed an item";
  if (kind === "move" || kind === "transfer") return "Moved files and folders";
  if (kind === "position") return "Arranged desktop items";
  if (kind === "trash") return "Moved files and folders to Trash";
  if (kind === "restore") return "Restored files and folders";
  if (kind === "purge") return "Deleted files and folders permanently";
  return "Changed desktop settings";
}

/** Coordinates projected desktop runtime behavior. */
export class ProjectedDesktopRuntime {
  private startupPromise: Promise<LocalWeb2Startup> | undefined;
  private filesystem: WorkspaceFilesystem | undefined;
  private activeWorkspaceId = "";
  private snapshot: DesktopStateSnapshot | undefined;
  private revision = 0;
  private stopChanges: (() => void) | undefined;
  private refreshWork = Promise.resolve<DesktopStateSnapshot | undefined>(undefined);
  private readonly desktopListeners = new Set<(snapshot: DesktopStateSnapshot) => void>();
  private readonly statusListeners = new Set<(status: SyncStatus) => void>();
  private readonly catalogListeners = new Set<(catalog: DesktopRegistry) => void>();
  private readonly activityListeners = new Set<() => void>();

  /** Creates a ProjectedDesktopRuntime instance. */
  constructor(private readonly options: ProjectedDesktopRuntimeOptions = {}) {
    options.subscribeStatus?.((status) => this.statusListeners.forEach((listener) => listener(status)));
  }

  /** Ensures startup. */
  private async ensureStartup() {
    this.startupPromise ??= (this.options.initialize?.() ?? initializeLocalWeb2Storage()).then((startup) => {
      startup.catalog.onChangesAvailable(() => { void this.publishCatalog(); });
      return startup;
    });
    return this.startupPromise;
  }

  /** Returns the active workspace or fails if none is selected. */
  private async workspace(workspaceId = this.activeWorkspaceId) {
    const startup = await this.ensureStartup();
    const workspace = (await startup.catalog.listWorkspaces()).find(({ id }) => id === workspaceId);
    if (!workspace) throw new Error("That workspace does not exist.");
    return workspace;
  }

  /** Opens the selected workspace. */
  private async open(workspaceId: string) {
    const startup = await this.ensureStartup();
    await this.options.prepareWorkspace?.(workspaceId);
    await startup.catalog.setActiveWorkspace(workspaceId);
    if (this.filesystem && this.activeWorkspaceId === workspaceId) return this.refresh();
    this.stopChanges?.();
    this.filesystem?.close();
    this.activeWorkspaceId = workspaceId;
    this.filesystem = await openWorkspaceFilesystem(startup.accountId, workspaceId, { storageId: startup.storageId });
    if (this.options.cleanupOrphans !== false) await this.filesystem.removeOrphans();
    this.revision = (await this.workspace(workspaceId)).localRevision;
    this.stopChanges = this.filesystem.onChangesAvailable(() => { void this.replayChanges(); });
    return this.refresh();
  }

  /** Returns the active workspace filesystem or fails if unavailable. */
  private requireFilesystem() {
    if (!this.filesystem || !this.activeWorkspaceId) throw new Error("The workspace is not open.");
    return this.filesystem;
  }

  /** Refreshes and publishes the current projection. */
  private async refresh() {
    const filesystem = this.requireFilesystem();
    const workspace = await this.workspace();
    this.revision = workspace.localRevision;
    const snapshot = retainProjection(this.snapshot, await projectSnapshot(filesystem, workspace));
    this.snapshot = snapshot;
    this.desktopListeners.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  /** Replays changes. */
  private replayChanges() {
    this.refreshWork = this.refreshWork.catch(() => undefined).then(async () => {
      const filesystem = this.requireFilesystem();
      const changes = await filesystem.listChanges(this.revision);
      if (changes.length === 0) return this.snapshot;
      this.revision = changes.at(-1)!.revision;
      return this.refresh();
    });
    return this.refreshWork;
  }

  /** Applies a mutation and publishes the resulting state. */
  private async mutate<T>(operation: (filesystem: WorkspaceFilesystem) => Promise<T>) {
    const result = await operation(this.requireFilesystem());
    await this.refresh();
    this.options.wake?.();
    this.activityListeners.forEach((listener) => listener());
    return result;
  }

  /** Returns the current runtime state. */
  private current() {
    if (!this.snapshot) throw new Error("The workspace is still opening.");
    return this.snapshot;
  }

  /** Returns the current workspace registry. */
  private async registry() {
    const startup = await this.ensureStartup();
    const [workspaces, active] = await Promise.all([startup.catalog.listWorkspaces(), startup.catalog.resolveActiveWorkspace()]);
    return this.options.registry?.(workspaces, active) ?? { schemaVersion: 2 as const, catalogId: null, catalogRevision: 0, desktops: workspaces.map(localIdentity), activeDesktopId: active.id, quota: null };
  }

  /** Publishes catalog. */
  private async publishCatalog() {
    const registry = await this.registry();
    this.catalogListeners.forEach((listener) => listener(registry));
    return registry;
  }

  /** Initializes desktop. */
  async initializeDesktop(workspaceId: string, _surface?: EntryPosition, _seeded?: unknown, _options?: unknown) {
    void _surface; void _seeded; void _options;
    const desktop = await this.open(workspaceId);
    const status = this.options.status?.() ?? "local";
    this.statusListeners.forEach((listener) => listener(status));
    return { desktop, status };
  }

  /** Stops desktop sync. */
  async stopDesktopSync() {}

  /** Subscribes to sync. */
  subscribeToSync(onDesktop: (next: DesktopStateSnapshot) => void, onStatus: (next: SyncStatus) => void, onSyncing?: (syncing: boolean) => void) {
    this.desktopListeners.add(onDesktop);
    this.statusListeners.add(onStatus);
    onSyncing?.(false);
    return () => { this.desktopListeners.delete(onDesktop); this.statusListeners.delete(onStatus); };
  }

  /** Creates text file. */
  async createTextFile(name: string, parentId: string | null, position: EntryPosition) {
    return this.createFile(name, parentId, position, new Blob([], { type: "text/plain" }), "text/plain");
  }

  /** Creates file. */
  async createFile(name: string, parentId: string | null, position: EntryPosition, content: Blob, mimeType?: string, _unconditional?: boolean) {
    void _unconditional;
    const node = await this.mutate((filesystem) => filesystem.createFile({ name, parentId, position, content, mimeType }));
    return nodeEntry(node) as FileEntry;
  }

  /** Creates folder. */
  async createFolder(name: string, parentId: string | null, position: EntryPosition) {
    return nodeEntry(await this.mutate((filesystem) => filesystem.createFolder({ name, parentId, position }))) as FolderEntry;
  }

  /** Imports files into the selected destination. */
  async importFiles(files: File[], parentId: string | null, positions: EntryPosition[]) {
    if (files.length !== positions.length) throw new Error("Each imported file needs a desktop position.");
    const nodes: CreateForestNode[] = files.map((file, index) => ({ key: String(index), kind: "file", name: file.name, parentKey: null, position: positions[index]!, modifiedAt: file.lastModified || Date.now(), content: file, mimeType: importedFileMimeType(file) }));
    return (await this.mutate((filesystem) => filesystem.createForest({ parentId, nodes }))).map((node) => nodeEntry(node) as FileEntry);
  }

  /** Creates entries. */
  async createEntries(entries: DesktopEntry[], contents: Map<string, Blob>) {
    const ids = new Set(entries.map(({ id }) => id));
    const externalParents = new Set(entries.flatMap(({ parentId }) => parentId && !ids.has(parentId) ? [parentId] : []));
    if (externalParents.size > 1) throw new Error("Imported roots must share one destination.");
    const nodes: CreateForestNode[] = entries.map((entry) => entry.kind === "folder"
      ? { key: entry.id, kind: "folder", name: entry.name, parentKey: entry.parentId && ids.has(entry.parentId) ? entry.parentId : null, position: entry.position, modifiedAt: entry.modifiedAt }
      : { key: entry.id, kind: "file", name: entry.name, parentKey: entry.parentId && ids.has(entry.parentId) ? entry.parentId : null, position: entry.position, modifiedAt: entry.modifiedAt, content: contents.get(entry.id) ?? new Blob(), mimeType: entry.mimeType });
    const created = await this.mutate((filesystem) => filesystem.createForest({ parentId: [...externalParents][0] ?? null, nodes }));
    return created.map(nodeEntry);
  }

  /** Renames entry. */
  async renameEntry(id: string, name: string) {
    await this.mutate((filesystem) => filesystem.renameNode(id, name));
    const entry = this.current().entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error("That entry no longer exists.");
    return entry;
  }

  /** Removes entries. */
  async deleteEntries(ids: string[]) {
    const before = this.current().entries;
    const included = new Set(ids);
    for (let changed = true; changed;) {
      changed = false;
      for (const entry of before) if (entry.parentId && included.has(entry.parentId) && !included.has(entry.id)) { included.add(entry.id); changed = true; }
    }
    await this.mutate((filesystem) => filesystem.trashNodes(ids));
    return before.filter(({ id }) => included.has(id));
  }

  /** Removes entry. */
  async deleteEntry(id: string) {
    return this.deleteEntries([id]);
  }

  /** Moves entry. */
  async moveEntry(id: string, parentId: string | null, position: EntryPosition) {
    await this.mutate(async (filesystem) => {
      await filesystem.moveNodes([id], parentId);
      await filesystem.setNodePositions([{ nodeId: id, position }]);
    });
    const entry = this.current().entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error("That entry no longer exists.");
    return entry;
  }

  /** Moves entries. */
  async moveEntries(ids: string[], parentId: string | null) {
    await this.mutate((filesystem) => filesystem.moveNodes(ids, parentId));
    return ids.map((id) => this.current().entries.find((entry) => entry.id === id)!).filter(Boolean);
  }

  /** Transfers entries. */
  async transferEntries(destinationWorkspaceId: string, ids: string[], parentId: string | null) {
    await this.mutate((filesystem) => filesystem.transferNodes(destinationWorkspaceId, ids, parentId));
    return this.current();
  }

  /** Creates desktop. */
  async createDesktop(name: string) {
    const startup = await this.ensureStartup();
    const workspace = await (this.options.createWorkspace?.(startup, name) ?? startup.catalog.createWorkspace({ name }));
    await this.publishCatalog();
    return localIdentity(workspace);
  }

  /** Lists desktops. */
  listDesktops(_seeded?: unknown, _options?: unknown) {
    void _seeded; void _options;
    return this.registry();
  }

  /** Refreshes desktop catalog. */
  refreshDesktopCatalog() {
    return this.publishCatalog();
  }

  /** Subscribes to desktop catalog. */
  subscribeToDesktopCatalog(listener: (catalog: DesktopRegistry) => void) {
    this.catalogListeners.add(listener);
    return () => this.catalogListeners.delete(listener);
  }

  /** Updates desktop preferences. */
  async updateDesktopPreferences(preferences: DesktopPreference[]) {
    const startup = await this.ensureStartup();
    await (this.options.updateWorkspacePreferences?.(startup, preferences) ?? startup.catalog.setWorkspacePreferences(preferences).then(() => undefined));
    return this.publishCatalog();
  }

  /** Renames desktop. */
  async renameDesktop(workspaceId: string, name: string) {
    const startup = await this.ensureStartup();
    const workspace = await (this.options.renameWorkspace?.(startup, workspaceId, name) ?? startup.catalog.renameWorkspace(workspaceId, name));
    await this.publishCatalog();
    return localIdentity(workspace);
  }

  /** Removes desktop. */
  async deleteDesktop(workspaceId: string) {
    const startup = await this.ensureStartup();
    await (this.options.deleteWorkspace?.(startup, workspaceId) ?? startup.catalog.deleteWorkspace(workspaceId).then(() => undefined));
    await this.publishCatalog();
  }

  /** Captures entries. */
  async captureEntries(rootIds: string[]): Promise<ClipboardEntrySnapshot> {
    const entries = this.current().entries;
    const included = new Set(rootIds);
    for (let changed = true; changed;) {
      changed = false;
      for (const entry of entries) if (entry.parentId && included.has(entry.parentId) && !included.has(entry.id)) { included.add(entry.id); changed = true; }
    }
    const selected = entries.filter(({ id }) => included.has(id));
    const contents = new Map<string, Blob>();
    await Promise.all(selected.map(async (entry) => { if (entry.kind === "file") contents.set(entry.id, await this.readFile(entry.id)); }));
    return { selectedRootIds: [...rootIds], entries: selected.map((entry) => rootIds.includes(entry.id) ? { ...entry, parentId: null } : entry), contents };
  }

  /** Pastes entries. */
  async pasteEntries(snapshot: ClipboardEntrySnapshot, parentId: string | null, rootNames: Map<string, string>, rootPositions: Map<string, EntryPosition>) {
    const ids = new Set(snapshot.entries.map(({ id }) => id));
    const nodes: CreateForestNode[] = snapshot.entries.map((entry) => {
      const root = snapshot.selectedRootIds.includes(entry.id);
      const base = { key: entry.id, name: root ? rootNames.get(entry.id) ?? entry.name : entry.name, parentKey: !root && entry.parentId && ids.has(entry.parentId) ? entry.parentId : null, position: root ? rootPositions.get(entry.id) ?? entry.position : entry.position, modifiedAt: Date.now() };
      return entry.kind === "folder" ? { ...base, kind: "folder" } : { ...base, kind: "file", content: snapshot.contents.get(entry.id) ?? new Blob(), mimeType: entry.mimeType };
    });
    return (await this.mutate((filesystem) => filesystem.createForest({ parentId, nodes }))).map(nodeEntry);
  }

  /** Updates root entry positions. */
  async updateRootEntryPositions(positions: RootEntryPositionUpdate[]) {
    await this.mutate((filesystem) => filesystem.setNodePositions(positions.map(({ entryId, position }) => ({ nodeId: entryId, position }))));
    return positions.map(({ entryId }) => this.current().entries.find((entry) => entry.id === entryId)!).filter(Boolean);
  }

  /** Updates entry position. */
  async updateEntryPosition(id: string, position: EntryPosition) {
    await this.mutate((filesystem) => filesystem.setNodePositions([{ nodeId: id, position }]));
    const entry = this.current().entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error("That entry no longer exists.");
    return entry;
  }

  /** Saves file. */
  async saveFile(id: string, content: Blob, options: SaveFileOptions = {}) {
    const filesystem = this.requireFilesystem();
    const node = await filesystem.getNode(id);
    if (!node || node.kind !== "file" || !node.fieldTuples.content) throw new Error("That file no longer exists.");
    const revision = node.fieldTuples.content.logicalTime;
    if (!options.unconditional && options.expectedContentRevision !== undefined && options.expectedContentRevision !== revision) throw new ContentRevisionConflictError(options.expectedContentRevision, revision);
    await this.mutate((current) => current.writeFile(id, content, { expectedContentTuple: node.fieldTuples.content!, mimeType: options.mimeType }));
    return this.current().entries.find((entry) => entry.id === id) as FileEntry;
  }

  /** Saves desktop layout. */
  async saveDesktopLayout(layout: DesktopLayout, _precondition?: unknown) {
    void _precondition;
    const parsed = parseLayout(layout);
    await this.mutate(async (filesystem) => {
      await filesystem.saveDesktopGridSettings({ autoArrangeIcons: parsed.autoArrangeIcons, snapToGrid: parsed.snapToGrid, gridSize: parsed.gridSize });
      await filesystem.setSettings("wallpaper", [{ key: "layout", value: json(parsed.wallpaper) }]);
      await filesystem.setSettings("widgets", [{ key: "layout", value: json(parsed.widgets) }]);
      await filesystem.setSettings("icon-groups", [{ key: "layout", value: json(parsed.iconGroups) }]);
    });
  }

  /** Saves editor settings. */
  async saveEditorSettings(settings: EditorSettings) {
    const parsed = parseEditorSettings(settings);
    const { fileCreationTemplates, ...editor } = parsed;
    await this.mutate(async (filesystem) => {
      await filesystem.setSettings("editor", [{ key: "settings", value: json(editor) }]);
      await filesystem.setSettings("file-templates", [{ key: "templates", value: json(fileCreationTemplates) }]);
    });
  }

  /** Selects theme. */
  async selectTheme(themeId: string) {
    parseThemeState({ ...this.current().appearance, selectedThemeId: themeId });
    await this.mutate((filesystem) => filesystem.setSetting("theme-selection", "selected", themeId));
    return this.current().appearance;
  }

  /** Saves custom theme. */
  async saveCustomTheme(value: CustomTheme) {
    const theme = parseCustomTheme(value);
    await this.mutate((filesystem) => filesystem.setSetting("custom-themes", theme.id, json(theme)));
    return this.current().appearance.customThemes.find(({ id }) => id === theme.id)!;
  }

  /** Installs theme package. */
  async installThemePackage(value: CustomTheme, wallpaperKind: "static" | "animated" | "scene" | null, archive: Blob, layout: DesktopLayout) {
    const theme = parseCustomTheme(value);
    if (wallpaperKind === null) {
      await this.saveCustomTheme(theme);
      await this.selectTheme(theme.id);
      await this.saveDesktopLayout(layout);
      return this.current().appearance.customThemes.find(({ id }) => id === theme.id)!;
    }
    const digest = await sha256Hex(await archive.arrayBuffer());
    const previousAssetId = this.current().appearance.customThemes.find(({ id }) => id === theme.id)?.wallpaper?.assetId;
    const packageNode = await this.mutate((filesystem) => filesystem.createFile({ name: `.${theme.id}.theme-package`, parentId: null, position: { x: 0, y: 0 }, content: archive, mimeType: "application/vnd.hiraya.theme+zip" }));
    const wallpaper: ThemeWallpaperPackage = { assetId: packageNode.id, kind: wallpaperKind, size: archive.size, sha256: digest, revision: 1 };
    await this.cacheThemePackage(this.activeWorkspaceId, theme.id, wallpaper, archive);
    await this.saveCustomTheme({ ...theme, wallpaper });
    await this.selectTheme(theme.id);
    await this.saveDesktopLayout(layout);
    if (previousAssetId && previousAssetId !== packageNode.id) await this.mutate((filesystem) => filesystem.purgeNodes([previousAssetId])).catch(() => undefined);
    return this.current().appearance.customThemes.find(({ id }) => id === theme.id)!;
  }

  /** Removes custom theme. */
  async deleteCustomTheme(themeId: string) {
    const theme = this.current().appearance.customThemes.find(({ id }) => id === themeId);
    if (!theme) throw new Error("That custom theme no longer exists.");
    await this.mutate(async (filesystem) => {
      await filesystem.unsetSetting("custom-themes", themeId);
      if (this.current().appearance.selectedThemeId === themeId) await filesystem.setSetting("theme-selection", "selected", DEFAULT_THEME_STATE.selectedThemeId);
      if (theme.wallpaper && await filesystem.getNode(theme.wallpaper.assetId)) await filesystem.purgeNodes([theme.wallpaper.assetId]);
    });
    if (theme.wallpaper) {
      const startup = await this.ensureStartup();
      const archives = await openApprovedPackageArchives(startup.accountId, { storageId: startup.storageId });
      try { await archives.release(theme.wallpaper.sha256); } finally { archives.close(); }
    }
    return this.current().appearance;
  }

  /** Reads file. */
  async readFile(id: string) {
    const entry = this.current().entries.find((candidate): candidate is FileEntry => candidate.id === id && candidate.kind === "file");
    if (!entry) throw new Error("That file no longer exists.");
    await this.options.prepareFile?.(this.activeWorkspaceId, id);
    const { content } = await this.requireFilesystem().readFile(id);
    return new File([content], entry.name, { type: entry.mimeType, lastModified: entry.modifiedAt });
  }

  /** Previews file. */
  async previewFile(id: string): Promise<FilePreviewSource> {
    return { kind: "blob", blob: await this.readFile(id) };
  }

  /** Generates a thumbnail for a file. */
  async thumbnailFile(id: string): Promise<FilePreviewSource> {
    if (this.options.thumbnail) return this.options.thumbnail(this.activeWorkspaceId, id);
    const entry = this.current().entries.find((candidate): candidate is FileEntry => candidate.id === id && candidate.kind === "file");
    if (!entry?.mimeType.toLowerCase().startsWith("image/")) throw new Error("Generated thumbnails are unavailable.");
    return { kind: "blob", blob: await this.readFile(id) };
  }

  /** Loads offline inventory. */
  async loadOfflineInventory(): Promise<OfflineStorageInventory> {
    const files = this.current().entries.filter((entry): entry is FileEntry => entry.kind === "file");
    const estimate: StorageEstimate = await navigator.storage.estimate().catch(() => ({}));
    const inventory = {
      desktopId: this.activeWorkspaceId,
      authoritativeLocal: true,
      files: Object.fromEntries(files.map((file) => [file.id, { cached: true, cachedBytes: file.size, storedBytes: file.size, pending: false, protected: true }])),
      cachedBytes: files.reduce((total, file) => total + file.size, 0),
      protectedBytes: files.reduce((total, file) => total + file.size, 0),
      releasableBytes: 0,
      browserStorage: Number.isFinite(estimate.usage) && Number.isFinite(estimate.quota) ? { usage: estimate.usage!, quota: estimate.quota! } : null,
    } satisfies OfflineStorageInventory;
    return inventory;
  }

  /** Subscribes to offline storage. */
  subscribeToOfflineStorage(onInventory: (inventory: OfflineStorageInventory) => void, onProgress?: (progress: OfflineOperationProgress | null) => void) {
    void this.loadOfflineInventory().then(onInventory).catch(() => undefined);
    onProgress?.(null);
    return () => undefined;
  }
  /** Subscribes to entry downloads. */
  subscribeToEntryDownloads(listener: (entryIds: ReadonlySet<string>) => void) { listener(new Set()); return () => false; }
  /** Subscribes to transfers. */
  subscribeToTransfers(listener: (transfers: readonly FileTransferState[]) => void) { listener([]); return () => false; }
  /** Dismisses file transfer. */
  dismissFileTransfer(_id?: string) { void _id; }
  /** Dismisses completed file transfer. */
  dismissCompletedFileTransfer(_id?: string) { void _id; }

  /** Estimates offline operation. */
  async estimateOfflineOperation(rootIds: readonly string[]) {
    const files = offlineFilesUnderRoots(this.current().entries, rootIds);
    return { roots: [...rootIds], fileCount: files.length, downloadBytes: 0 };
  }

  /** Downloads offline copies. */
  async downloadOfflineCopies(rootIds: readonly string[] = []) {
    const roots = rootIds.length ? rootIds : this.current().entries.filter(({ parentId }) => parentId === null).map(({ id }) => id);
    for (const file of offlineFilesUnderRoots(this.current().entries, roots)) await this.options.prepareFile?.(this.activeWorkspaceId, file.id);
    return this.loadOfflineInventory();
  }
  /** Removes offline copies. */
  async releaseOfflineCopies(_rootIds?: readonly string[]): Promise<{ releasedBytes: number; releasedFiles: number; skippedFiles: number }> { void _rootIds; throw new Error("Authoritative local file content cannot be removed from offline storage."); }
  /** Lists outbox records. */
  async listOutboxRecords(): Promise<OutboxRecord[]> { return []; }
  /** Subscribes to outbox. */
  subscribeToOutbox(listener: (records: readonly OutboxRecord[]) => void) { listener([]); return () => undefined; }
  /** Retries blocked outbox record. */
  async retryBlockedOutboxRecord(_operationId?: string): Promise<OutboxRecord[]> { void _operationId; throw new Error("The local workspace has no synchronization queue."); }
  /** Removes blocked outbox record. */
  async discardBlockedOutboxRecord(_operationId?: string): Promise<OutboxRecord[]> { void _operationId; throw new Error("The local workspace has no synchronization queue."); }
  /** Loads content conflict. */
  async loadContentConflict(_operationId?: string): Promise<ContentConflictBundle> { void _operationId; throw new Error("The local workspace has no synchronization conflicts."); }
  /** Resolves content conflict keep local. */
  async resolveContentConflictKeepLocal(_operationId?: string, _serverRevision?: number): Promise<OutboxRecord[]> { void _operationId; void _serverRevision; throw new Error("The local workspace has no synchronization conflicts."); }
  /** Resolves content conflict keep server. */
  async resolveContentConflictKeepServer(_operationId?: string): Promise<OutboxRecord[]> { void _operationId; throw new Error("The local workspace has no synchronization conflicts."); }
  /** Resolves content conflict merged. */
  async resolveContentConflictMerged(_operationId?: string, _content?: Blob, _serverRevision?: number): Promise<OutboxRecord[]> { void _operationId; void _content; void _serverRevision; throw new Error("The local workspace has no synchronization conflicts."); }
  /** Resolves content conflict keep both. */
  async resolveContentConflictKeepBoth(_operationId?: string): Promise<FileEntry> { void _operationId; throw new Error("The local workspace has no synchronization conflicts."); }

  /** Lists activity. */
  async listActivity(query: ActivityQuery = {}): Promise<ActivityPage> {
    if (this.options.listActivity) return this.options.listActivity(query);
    const parsed = parseActivityQuery(query);
    const workspaceId = parsed.desktopId ?? this.activeWorkspaceId;
    const startup = await this.ensureStartup();
    const filesystem = workspaceId === this.activeWorkspaceId ? this.requireFilesystem() : await openWorkspaceFilesystem(startup.accountId, workspaceId, { storageId: startup.storageId });
    try {
      const operations = await filesystem.listOperations(parsed.limit * 2);
      const q = parsed.q?.toLocaleLowerCase();
      const activities = operations
        .filter((stored) => parsed.before === undefined || stored.localRevision < parsed.before)
        .map((stored) => ({ catalogRevision: stored.localRevision, desktopId: stored.workspaceId, entryIds: operationNodeIds(stored), action: stored.operation.kind, source: "frontend", timestamp: operationTimestamp(stored), summary: operationSummary(stored), details: [`Operation: ${stored.operation.kind}`] }))
        .filter((record) => !q || `${record.summary} ${record.details.join(" ")}`.toLocaleLowerCase().includes(q))
        .slice(0, parsed.limit);
      return { activities, nextBefore: activities.length === parsed.limit ? activities.at(-1)!.catalogRevision : null };
    } finally {
      if (filesystem !== this.filesystem) filesystem.close();
    }
  }

  /** Subscribes to activity changes. */
  subscribeToActivityChanges(listener: () => void) { this.activityListeners.add(listener); return () => this.activityListeners.delete(listener); }

  /** Computes system content. */
  private systemContent(role: SystemRole, key?: string) {
    const snapshot = this.current();
    if (role === "layout") return snapshot.layout;
    if (role === "editor-settings") return snapshot.editorSettings;
    if (role === "theme-selection") return { themeId: snapshot.appearance.selectedThemeId };
    if (role === "theme-definition") return snapshot.appearance.customThemes.find(({ id }) => id === key);
    throw new Error("That protected system resource is unavailable in this browser.");
  }

  /** Lists system entries. */
  async listSystemEntries(desktopId: string): Promise<SystemEntriesDocument> {
    if (desktopId !== this.activeWorkspaceId) throw new Error("System files are unavailable for an inactive local workspace.");
    const snapshot = this.current();
    const resources: Array<{ role: SystemRole; key?: string; revision: number }> = [
      { role: "layout", revision: snapshot.sync.layoutRevision },
      { role: "editor-settings", revision: snapshot.sync.settingsRevision },
      { role: "theme-selection", revision: snapshot.sync.themeSelectionRevision },
      ...snapshot.appearance.customThemes.map((theme) => ({ role: "theme-definition" as const, key: theme.id, revision: snapshot.sync.themeRevisions[theme.id] ?? 0 })),
    ];
    const entries = await Promise.all(resources.map(async ({ role, key, revision }): Promise<SystemEntry> => {
      const content = new Blob([JSON.stringify(this.systemContent(role, key))], { type: "application/json" });
      return { kind: "file", id: `${desktopId}:system:${role}${key ? `:${key}` : ""}`, name: role === "theme-definition" ? `${key}.theme.json` : `${role}.json`, systemRole: role, ...(key ? { systemKey: key } : {}), path: `/.hiraya/${role}${key ? `/${key}` : ""}`, mimeType: "application/json", size: content.size, revision, contentRevision: revision, sha256: await sha256Hex(await content.arrayBuffer()) };
    }));
    return { schemaVersion: 2, catalogId: desktopId, catalogRevision: snapshot.sync.catalogRevision, desktopId, entries };
  }

  /** Reads system file. */
  async readSystemFile(desktopId: string, _catalogId: string, entry: SystemEntry) {
    if (desktopId !== this.activeWorkspaceId) throw new Error("System files are unavailable for an inactive local workspace.");
    const content = new Blob([JSON.stringify(this.systemContent(entry.systemRole, entry.systemKey))], { type: entry.mimeType });
    return new File([content], entry.name, { type: entry.mimeType });
  }

  /** Computes trash entry. */
  private trashEntry(node: Node): TrashEntry {
    const entry = nodeEntry(node);
    return { ...entry, revision: nodeRevision(node), contentRevision: node.kind === "file" ? node.fieldTuples.content!.logicalTime : 0 };
  }

  /** Lists trash. */
  async listTrash(desktopId: string): Promise<TrashDocument> {
    if (desktopId !== this.activeWorkspaceId) throw new Error("Trash is unavailable for an inactive local workspace.");
    const nodes = await this.requireFilesystem().listTrash();
    const trashedIds = new Set(nodes.map(({ id }) => id));
    const roots = nodes.filter((node) => !node.parentId || !trashedIds.has(node.parentId));
    return {
      schemaVersion: 2,
      catalogId: desktopId,
      catalogRevision: (await this.workspace()).localRevision,
      desktopId,
      items: roots.map((root) => {
        const included = new Set([root.id]);
        for (let changed = true; changed;) {
          changed = false;
          for (const node of nodes) if (node.parentId && included.has(node.parentId) && !included.has(node.id)) { included.add(node.id); changed = true; }
        }
        const entries = nodes.filter(({ id }) => included.has(id)).map((node) => this.trashEntry(node));
        return { entry: this.trashEntry(root), entries, deletedAt: root.lifecycle.kind === "trashed" ? root.lifecycle.trashedAt : 0, descendantCount: entries.length - 1 };
      }),
    };
  }

  /** Reads trash file. */
  async readTrashFile(desktopId: string, _catalogId: string, _trashRootId: string, entry: TrashEntry) {
    if (desktopId !== this.activeWorkspaceId || entry.kind !== "file") throw new Error("That Trash file is unavailable.");
    const content = await this.requireFilesystem().readTrashedFile(entry.id);
    return new File([content], entry.name, { type: entry.mimeType, lastModified: entry.modifiedAt });
  }

  /** Restores trash. */
  async restoreTrash(desktopId: string, entryId: string, destination: "original" | "root", _revision?: number): Promise<TrashRestoreResult> {
    void _revision;
    if (desktopId !== this.activeWorkspaceId) throw new Error("Trash is unavailable for an inactive local workspace.");
    await this.mutate((filesystem) => filesystem.restoreNodes([entryId], destination));
    const root = this.current().entries.find(({ id }) => id === entryId);
    const included = new Set(root ? [root.id] : []);
    for (let changed = true; changed;) {
      changed = false;
      for (const entry of this.current().entries) if (entry.parentId && included.has(entry.parentId) && !included.has(entry.id)) { included.add(entry.id); changed = true; }
    }
    return { catalogRevision: (await this.workspace()).localRevision, entries: this.current().entries.filter(({ id }) => included.has(id)).map((entry) => ({ ...entry, revision: this.current().sync.entryRevisions[entry.id] ?? 0, contentRevision: this.current().sync.contentRevisions[entry.id] ?? 0 })) };
  }

  /** Permanently deletes trash. */
  async permanentlyDeleteTrash(desktopId: string, entryId: string, _revision?: number): Promise<TrashDeleteResult> {
    void _revision;
    if (desktopId !== this.activeWorkspaceId) throw new Error("Trash is unavailable for an inactive local workspace.");
    const trash = await this.listTrash(desktopId);
    const item = trash.items.find(({ entry }) => entry.id === entryId);
    if (!item) throw new Error("That Trash item no longer exists.");
    await this.mutate((filesystem) => filesystem.purgeNodes([entryId]));
    return { catalogRevision: (await this.workspace()).localRevision, deletedIds: item.entries.map(({ id }) => id) };
  }

  /** Switches desktop. */
  async switchDesktop(workspaceId: string) {
    return this.open(workspaceId);
  }

  /** Hydrates folder. */
  async hydrateFolder(folderId: string) {
    await this.options.hydrateFolder?.(this.activeWorkspaceId, folderId);
    await this.refresh();
  }

  /** Hydrates node. */
  async hydrateNode(nodeId: string) {
    await this.options.hydrateNode?.(this.activeWorkspaceId, nodeId);
    await this.refresh();
  }

  /** Reads desktop entries. */
  async readDesktopEntries(workspaceId: string) {
    if (workspaceId === this.activeWorkspaceId && this.snapshot) return this.snapshot.entries;
    const startup = await this.ensureStartup();
    const filesystem = await openWorkspaceFilesystem(startup.accountId, workspaceId, { storageId: startup.storageId });
    try { return (await projectSnapshot(filesystem, await this.workspace(workspaceId))).entries; } finally { filesystem.close(); }
  }

  /** Removes local desktops. */
  async pruneLocalDesktops(_retainedIds?: readonly string[]) { void _retainedIds; }
  /** Reads local preferences. */
  readLocalPreferences() { return repositories.readPreferences(); }
  /** Saves local preferences. */
  saveLocalPreferences(preferences: Parameters<typeof repositories.savePreferences>[0]) { return repositories.savePreferences(preferences); }
  /** Reads window session. */
  readWindowSession(workspaceId: string) { return repositories.readWindowSession(workspaceId); }
  /** Saves window session. */
  saveWindowSession(workspaceId: string, session: Parameters<typeof repositories.saveWindowSession>[1]) { return repositories.saveWindowSession(workspaceId, session); }

  /** Reads cached theme package. */
  async readCachedThemePackage(_workspaceId: string, _themeId: string, expected: ThemeWallpaperPackage) {
    const startup = await this.ensureStartup();
    const archives = await openApprovedPackageArchives(startup.accountId, { storageId: startup.storageId });
    try {
      const archive = await archives.read(expected.sha256);
      return archive.size === expected.size ? archive : null;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      await this.options.prepareFile?.(this.activeWorkspaceId, expected.assetId);
      const node = await this.requireFilesystem().getNode(expected.assetId);
      if (!node || node.kind !== "file") return null;
      const content = (await this.requireFilesystem().readFile(expected.assetId)).content;
      return content.size === expected.size && await sha256Hex(await content.arrayBuffer()) === expected.sha256 ? content : null;
    } finally { archives.close(); }
  }

  /** Caches theme package. */
  async cacheThemePackage(_workspaceId: string, _themeId: string, expected: ThemeWallpaperPackage, content: Blob) {
    if (content.size !== expected.size || await sha256Hex(await content.arrayBuffer()) !== expected.sha256) throw new Error("The theme package content does not match the selected theme.");
    const startup = await this.ensureStartup();
    const archives = await openApprovedPackageArchives(startup.accountId, { storageId: startup.storageId });
    try { await archives.save(expected.sha256, content); } finally { archives.close(); }
    return true;
  }

  /** Lists file history. */
  async listFileHistory(entryId: string) {
    const filesystem = this.requireFilesystem();
    const versions = await filesystem.listFileVersions(entryId);
    const currentVersion = versions.find(({ current }) => current);
    const operation = currentVersion ? (await filesystem.listOperations()).find(({ operationId }) => operationId === currentVersion.operationId) : undefined;
    return { versions, canUndo: versions.length > 1 && operation?.intent !== "undo", canRedo: operation?.intent === "undo" };
  }

  /** Undoes latest file change. */
  async undoLatestFileChange(entryId: string) {
    const history = await this.listFileHistory(entryId);
    const currentVersion = history.versions.find(({ current }) => current);
    if (!history.canUndo || !currentVersion) throw new Error("There is no file change to undo.");
    await this.mutate((filesystem) => filesystem.undoOperation(currentVersion.operationId).then(() => undefined));
  }

  /** Redoes latest file change. */
  async redoLatestFileChange(entryId: string) {
    const history = await this.listFileHistory(entryId);
    const currentVersion = history.versions.find(({ current }) => current);
    if (!history.canRedo || !currentVersion) throw new Error("There is no file change to redo.");
    await this.mutate((filesystem) => filesystem.redoOperation(currentVersion.operationId).then(() => undefined));
  }

  /** Restores file version. */
  async restoreFileVersion(entryId: string, operationId: string) {
    await this.mutate((filesystem) => filesystem.restoreFileVersion(entryId, operationId).then(() => undefined));
  }

  /** Reads file version. */
  async readFileVersion(entryId: string, operationId: string) {
    const version = (await this.requireFilesystem().listFileVersions(entryId)).find((candidate) => candidate.operationId === operationId);
    if (!version) throw new Error("That retained version no longer exists.");
    await this.options.prepareVersion?.(this.activeWorkspaceId, version.manifestHash);
    return new File([await this.requireFilesystem().readFileVersion(entryId, operationId)], this.current().entries.find(({ id }) => id === entryId)?.name ?? "Retained version", { type: version.mimeType, lastModified: version.modifiedAt });
  }

  /** Keeps both file version. */
  async keepBothFileVersion(entryId: string, operationId: string) {
    const current = this.current().entries.find((entry): entry is FileEntry => entry.id === entryId && entry.kind === "file");
    if (!current) throw new Error("That file no longer exists.");
    const content = await this.readFileVersion(entryId, operationId);
    const dot = current.name.lastIndexOf(".");
    const suffix = ` (retained ${operationId.slice(0, 6)})`;
    const name = dot > 0 ? `${current.name.slice(0, dot)}${suffix}${current.name.slice(dot)}` : `${current.name}${suffix}`;
    return this.createFile(name, current.parentId, current.position, content, content.type);
  }

  /** Serializes runtime storage. */
  async serializeRuntimeStorage<T>(operation: () => Promise<T>) {
    const { storageId } = await this.ensureStartup();
    return navigator.locks.request(`${await filesystemDatabaseName(storageId)}-app-storage`, { mode: "exclusive" }, operation);
  }

  /** Fetches server build timestamp. */
  async fetchServerBuildTimestamp() { return this.options.serverBuildTimestamp?.() ?? null; }
}

export default new ProjectedDesktopRuntime();
