import type { CommandDefinition } from "@hiraya-team/apps-contracts";

export type CommandId = `${string}.${string}`;

export type CommandDescriptor<Context, Id extends CommandId = CommandId> = {
  id: Id;
  label: string;
  detail?: string;
  keywords?: readonly string[];
  promoted?: boolean;
  order?: number;
  visible?: (context: Context) => boolean;
  enabled?: (context: Context) => boolean;
  execute: (context: Context) => void | Promise<void>;
};

export type CommandItem<Id extends CommandId = CommandId> = Pick<CommandDescriptor<unknown, Id>, "id" | "label" | "detail" | "keywords" | "promoted"> & {
  enabled: boolean;
};

const COMMAND_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const encodeCommandSegment = (value: string) => Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");

export class CommandService<Context, Id extends CommandId = CommandId> {
  readonly #commands = new Map<Id, CommandDescriptor<Context, Id>>();

  register(command: CommandDescriptor<Context, Id>): () => void {
    if (!COMMAND_ID_PATTERN.test(command.id)) throw new Error(`Command ID must be namespaced: ${command.id}`);
    if (this.#commands.has(command.id)) throw new Error(`Command already registered: ${command.id}`);
    this.#commands.set(command.id, command);

    return () => {
      if (this.#commands.get(command.id) === command) this.#commands.delete(command.id);
    };
  }

  list(context: Context): CommandItem<Id>[] {
    return [...this.#commands.values()]
      .filter((command) => command.visible?.(context) ?? true)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((command) => ({
        id: command.id,
        label: command.label,
        detail: command.detail,
        keywords: command.keywords,
        promoted: command.promoted,
        enabled: command.enabled?.(context) ?? true,
      }));
  }

  async execute(id: Id, context: Context): Promise<boolean> {
    const command = this.#commands.get(id);
    if (!command || !(command.visible?.(context) ?? true) || !(command.enabled?.(context) ?? true)) return false;
    await command.execute(context);
    return true;
  }
}

export const APP_COMMAND_IDS = {
  newFile: "desktop.new-file",
  newFolder: "desktop.new-folder",
  upload: "desktop.upload",
  importFolder: "desktop.import-folder",
  autoArrange: "desktop.auto-arrange",
  trash: "desktop.trash",
  settings: "desktop.settings",
  areaMap: "desktop.area-map",
  connection: "desktop.connection-offline",
  help: "desktop.help",
  shortcuts: "desktop.shortcuts",
} as const satisfies Record<string, CommandId>;

export type AppCommandId = typeof APP_COMMAND_IDS[keyof typeof APP_COMMAND_IDS];
export type AppCommandPanel = "trash" | "help" | "shortcuts" | "sync";

export type AppCommandContext = {
  canMutate: boolean;
  canOpenTrash: boolean;
  canOpenSettings: boolean;
  createFile: () => void;
  createFolder: () => void;
  uploadFiles: () => void;
  importFolder: () => void;
  autoArrange: () => void | Promise<void>;
  openSettings: () => void;
  openAreaMap: () => void;
  openPanel: (panel: AppCommandPanel) => void;
};

export type RuntimeCommandDefinition = CommandDefinition;
export type RuntimeChromeCommand = { id: CommandId; title: string; shortcut?: string; enabled: boolean };

export class RuntimeCommandContributions<Context> {
  readonly #disposals: Array<() => void> = [];
  readonly #listeners = new Set<() => void>();
  #promoted: readonly RuntimeChromeCommand[] = [];

  constructor(
    private readonly service: CommandService<Context>,
    private readonly ownerId: string,
    private readonly invoke: (id: string) => void,
  ) {}

  set(commands: readonly RuntimeCommandDefinition[]): void {
    this.#clearRegistrations();
    const localIds = new Set<string>();
    try {
      for (const command of commands) {
        if (localIds.has(command.id)) throw new TypeError(`Duplicate app command: ${command.id}`);
        localIds.add(command.id);
        const id = runtimeCommandId(this.ownerId, command.id);
        this.#disposals.push(this.service.register({ id, label: command.title, detail: command.shortcut, promoted: command.promoted, enabled: () => command.enabled ?? true, execute: () => this.invoke(command.id) }));
      }
    } catch (error) {
      this.#clearRegistrations();
      this.#promoted = [];
      this.#emit();
      throw error;
    }
    this.#promoted = commands.flatMap((command) => command.promoted ? [{ id: runtimeCommandId(this.ownerId, command.id), title: command.title, shortcut: command.shortcut, enabled: command.enabled ?? true }] : []);
    this.#emit();
  }

  clear(): void {
    this.#clearRegistrations();
    if (this.#promoted.length === 0) return;
    this.#promoted = [];
    this.#emit();
  }

  readonly getPromoted = () => this.#promoted;
  readonly subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };

  #clearRegistrations(): void {
    for (const dispose of this.#disposals.splice(0)) dispose();
  }

  #emit(): void { for (const listener of this.#listeners) listener(); }

  close(): void { this.clear(); }
}

export function runtimeCommandId(appId: string, commandId: string): CommandId {
  if (!appId || !commandId) throw new TypeError("App command ID is invalid.");
  return `app.a-${encodeCommandSegment(appId)}.c-${encodeCommandSegment(commandId)}`;
}

export function desktopSwitchCommandId(desktopId: string): CommandId {
  if (!desktopId) throw new TypeError("Desktop command ID is invalid.");
  return `desktop.switch-${encodeCommandSegment(desktopId)}`;
}

export function createDesktopSwitchCommands(desktops: readonly { id: string; name: string }[], activeDesktopId: string): CommandItem[] {
  return desktops.filter(({ id }) => id !== activeDesktopId).map((desktop) => ({
    id: desktopSwitchCommandId(desktop.id),
    label: `Switch to ${desktop.name}`,
    keywords: ["switch desktop", desktop.name],
    enabled: true,
  }));
}

export function createAppCommandService(): CommandService<AppCommandContext> {
  const service = new CommandService<AppCommandContext>();
  const commands: CommandDescriptor<AppCommandContext, AppCommandId>[] = [
    { id: APP_COMMAND_IDS.newFile, order: 10, label: "New text file", keywords: ["create"], enabled: ({ canMutate }) => canMutate, execute: ({ createFile }) => createFile() },
    { id: APP_COMMAND_IDS.newFolder, order: 20, label: "New folder", keywords: ["create directory"], enabled: ({ canMutate }) => canMutate, execute: ({ createFolder }) => createFolder() },
    { id: APP_COMMAND_IDS.upload, order: 30, label: "Upload files", keywords: ["import add"], enabled: ({ canMutate }) => canMutate, execute: ({ uploadFiles }) => uploadFiles() },
    { id: APP_COMMAND_IDS.importFolder, order: 35, label: "Import folder", keywords: ["directory upload hierarchy"], enabled: ({ canMutate }) => canMutate, execute: ({ importFolder }) => importFolder() },
    { id: APP_COMMAND_IDS.autoArrange, order: 37, label: "Auto-arrange desktop icons", detail: "Pack icons in the current area", keywords: ["align organize layout grid"], enabled: ({ canMutate }) => canMutate, execute: ({ autoArrange }) => autoArrange() },
    { id: APP_COMMAND_IDS.trash, order: 40, label: "Open Trash", keywords: ["deleted restore"], visible: ({ canOpenTrash }) => canOpenTrash, enabled: ({ canMutate }) => canMutate, execute: ({ openPanel }) => openPanel("trash") },
    { id: APP_COMMAND_IDS.settings, order: 50, label: "Open Settings", visible: ({ canOpenSettings }) => canOpenSettings, execute: ({ openSettings }) => openSettings() },
    { id: APP_COMMAND_IDS.areaMap, order: 60, label: "Expand Area Map", detail: "Navigate spatial desktop areas", keywords: ["areas spaces coordinates regions minimap"], execute: ({ openAreaMap }) => openAreaMap() },
    { id: APP_COMMAND_IDS.connection, order: 65, label: "Open Connection & Offline", detail: "Review sync, pending work, downloads, and storage", keywords: ["sync cache download release blocked"], execute: ({ openPanel }) => openPanel("sync") },
    { id: APP_COMMAND_IDS.help, order: 75, label: "Open User Guide", detail: "Bundled product help and troubleshooting", keywords: ["help documentation manual offline"], execute: ({ openPanel }) => openPanel("help") },
    { id: APP_COMMAND_IDS.shortcuts, order: 80, label: "Show keyboard shortcuts", keywords: ["keys help"], execute: ({ openPanel }) => openPanel("shortcuts") },
  ];
  for (const command of commands) service.register(command);
  return service;
}
