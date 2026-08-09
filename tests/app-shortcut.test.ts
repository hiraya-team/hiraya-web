import { describe, expect, test } from "bun:test";
import { APP_SHORTCUT_MIME_TYPE, availableAppShortcutName, createAppShortcut, parseAppShortcut } from "../src/lib/app-shortcut";
import { reservedFileHandler } from "../src/apps/file-associations";
import { fileCapabilities } from "../src/ui/file-capabilities";

describe("application shortcuts", () => {
  test("stores a stable app ID and validates the complete payload", () => {
    const content = createAppShortcut("app.hiraya.text-editor");
    expect(parseAppShortcut(content)).toEqual({ appId: "app.hiraya.text-editor" });
    expect(() => parseAppShortcut('{"schemaVersion":2,"appId":"app.hiraya.text-editor"}')).toThrow("unsupported format");
    expect(() => parseAppShortcut('{"schemaVersion":1,"appId":"app.hiraya.text-editor","url":"https://example.com"}')).toThrow("unsupported format");
    expect(() => parseAppShortcut("not json")).toThrow("not valid JSON");
  });

  test("chooses a visible unique desktop name", () => {
    expect(availableAppShortcutName("Todo", ["todo", "Todo (2)"])).toBe("Todo (3)");
    expect(availableAppShortcutName("Integrated Editor", ["Notes"])).toBe("Integrated Editor");
  });

  test("reserves the MIME type and renders it as a non-editable app", () => {
    const file = { kind: "file" as const, id: "shortcut", name: "Integrated Editor", parentId: null, mimeType: APP_SHORTCUT_MIME_TYPE, size: 64, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    expect(reservedFileHandler(file)).toBe("app-shortcut");
    expect(fileCapabilities(file)).toEqual({ editable: false, preview: "none", icon: "app" });
    expect(reservedFileHandler({ ...file, name: "renamed.hiraya.app" })).toBe("app-shortcut");
  });
});
