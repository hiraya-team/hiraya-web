import { describe, expect, test } from "bun:test";
import { APP_COMMAND_IDS, CommandService, RuntimeCommandContributions, createAppCommandService, createDesktopSwitchCommands, desktopSwitchCommandId, runtimeCommandId, type AppCommandContext } from "../src/apps/commands";

describe("command service", () => {
  test("protects namespaced IDs and duplicate registrations", () => {
    const service = new CommandService<object>();
    const dispose = service.register({ id: "test.run", label: "Run", execute: () => undefined });
    expect(() => service.register({ id: "test.run", label: "Again", execute: () => undefined })).toThrow("Command already registered");
    expect(() => service.register({ id: "invalid" as "test.invalid", label: "Invalid", execute: () => undefined })).toThrow("must be namespaced");
    dispose();
    expect(service.list({})).toEqual([]);
    service.register({ id: "test.run", label: "Replacement", execute: () => undefined });
    expect(() => dispose()).not.toThrow();
    expect(service.list({}).map(({ label }) => label)).toEqual(["Replacement"]);
  });

  test("lists visible commands deterministically and resolves enabled state", () => {
    const service = new CommandService<{ allowed: boolean }>();
    service.register({ id: "test.second", order: 20, label: "Second", execute: () => undefined });
    service.register({ id: "test.hidden", order: 5, label: "Hidden", visible: ({ allowed }) => allowed, execute: () => undefined });
    service.register({ id: "test.disabled", order: 10, label: "Disabled", enabled: ({ allowed }) => allowed, execute: () => undefined });
    service.register({ id: "test.first", order: 10, label: "First", execute: () => undefined });

    expect(service.list({ allowed: false }).map(({ id, enabled }) => [id, enabled])).toEqual([
      ["test.disabled", false],
      ["test.first", true],
      ["test.second", true],
    ]);
    expect(service.list({ allowed: true }).map(({ id }) => id)).toEqual(["test.hidden", "test.disabled", "test.first", "test.second"]);
  });

  test("rechecks visibility and enabled predicates when executing", async () => {
    const calls: string[] = [];
    const service = new CommandService<{ allowed: boolean }>();
    service.register({ id: "test.run", label: "Run", visible: ({ allowed }) => allowed, enabled: ({ allowed }) => allowed, execute: () => { calls.push("run"); } });

    expect(service.list({ allowed: true })).toHaveLength(1);
    expect(await service.execute("test.run", { allowed: false })).toBe(false);
    expect(await service.execute("test.missing", { allowed: true })).toBe(false);
    expect(calls).toEqual([]);
    expect(await service.execute("test.run", { allowed: true })).toBe(true);
    expect(calls).toEqual(["run"]);
  });
});

describe("app command contributions", () => {
  test("creates ordered switch commands for every other desktop", () => {
    expect(createDesktopSwitchCommands([
      { id: "current", name: "Home" },
      { id: "shared desktop", name: "Team Space" },
      { id: "resume space", name: "Resume" },
    ], "current")).toEqual([
      { id: desktopSwitchCommandId("shared desktop"), label: "Switch to Team Space", keywords: ["switch desktop", "Team Space"], enabled: true },
      { id: desktopSwitchCommandId("resume space"), label: "Switch to Resume", keywords: ["switch desktop", "Resume"], enabled: true },
    ]);
    expect(desktopSwitchCommandId("shared desktop")).toMatch(/^desktop\.switch-[a-f0-9]+$/);
  });

  test("namespaces runtime commands, emits local IDs, and disposes replacements", async () => {
    const service = new CommandService<object>();
    const invoked: string[] = [];
    const contributions = new RuntimeCommandContributions(service, "window:1", (id) => invoked.push(id));
    let changes = 0;
    contributions.subscribe(() => { changes += 1; });
    contributions.set([{ id: "format-document", title: "Format", promoted: true }, { id: "save", title: "Save", shortcut: "Ctrl+S", promoted: true }]);
    expect(service.list({}).map(({ id }) => id)).toEqual([runtimeCommandId("window:1", "format-document"), runtimeCommandId("window:1", "save")]);
    expect(contributions.getPromoted()).toEqual([
      { id: runtimeCommandId("window:1", "format-document"), title: "Format", shortcut: undefined, enabled: true },
      { id: runtimeCommandId("window:1", "save"), title: "Save", shortcut: "Ctrl+S", enabled: true },
    ]);
    expect(await service.execute(runtimeCommandId("window:1", "format-document"), {})).toBe(true);
    expect(contributions.execute(runtimeCommandId("window:1", "save"))).toBe(true);
    expect(contributions.executeShortcut("Ctrl+S")).toBe(true);
    expect(contributions.executeShortcut("Ctrl+P")).toBe(false);
    expect(invoked).toEqual(["format-document", "save", "save"]);
    expect(() => contributions.set([{ id: "duplicate", title: "One", promoted: true }, { id: "duplicate", title: "Two", promoted: true }])).toThrow("Duplicate app command");
    expect(contributions.getPromoted()).toEqual([]);
    contributions.set([{ id: "save-all", title: "Save all", enabled: false }]);
    expect(service.list({}).map(({ id, enabled }) => [id, enabled])).toEqual([[runtimeCommandId("window:1", "save-all"), false]]);
    expect(contributions.getPromoted()).toEqual([]);
    expect(contributions.execute(runtimeCommandId("window:1", "save-all"))).toBe(false);
    contributions.close();
    expect(service.list({})).toEqual([]);
    expect(changes).toBe(3);
  });

  test("preserves palette order, visibility, and mutation permissions", async () => {
    const calls: string[] = [];
    const context: AppCommandContext = {
      canMutate: false,
      canOpenTrash: true,
      canOpenSettings: false,
      createFile: () => calls.push("file"),
      createFolder: () => calls.push("folder"),
      uploadFiles: () => calls.push("upload"),
      importFolder: () => calls.push("import-folder"),
      autoArrange: () => calls.push("auto-arrange"),
      openSettings: () => calls.push("settings"),
      openAreaMap: () => calls.push("area-map"),
      openPanel: (panel) => calls.push(panel),
    };
    const service = createAppCommandService();

    expect(service.list(context).map(({ id }) => id)).toEqual([
      APP_COMMAND_IDS.newFile,
      APP_COMMAND_IDS.newFolder,
      APP_COMMAND_IDS.upload,
      APP_COMMAND_IDS.importFolder,
      APP_COMMAND_IDS.autoArrange,
      APP_COMMAND_IDS.trash,
      APP_COMMAND_IDS.areaMap,
      APP_COMMAND_IDS.connection,
      APP_COMMAND_IDS.help,
      APP_COMMAND_IDS.shortcuts,
    ]);
    expect(await service.execute(APP_COMMAND_IDS.newFile, context)).toBe(false);
    expect(await service.execute(APP_COMMAND_IDS.trash, context)).toBe(false);
    expect(await service.execute(APP_COMMAND_IDS.autoArrange, context)).toBe(false);
    expect(calls).toEqual([]);

    expect(await service.execute(APP_COMMAND_IDS.areaMap, context)).toBe(true);
    expect(calls).toEqual(["area-map"]);

    context.canMutate = true;
    expect(await service.execute(APP_COMMAND_IDS.newFile, context)).toBe(true);
    expect(await service.execute(APP_COMMAND_IDS.autoArrange, context)).toBe(true);
    expect(await service.execute(APP_COMMAND_IDS.trash, context)).toBe(true);
    expect(calls).toEqual(["area-map", "file", "auto-arrange", "trash"]);
  });
});
