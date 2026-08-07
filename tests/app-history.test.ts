import { describe, expect, test } from "bun:test";
import { historyInstanceIds, historySettingsPage, removedHistoryInstanceIds } from "../src/ui/app-history";

describe("app browser history", () => {
  test("reads valid live instance snapshots and rejects malformed snapshots", () => {
    expect(historyInstanceIds({ hiraya: true, instances: ["one", "two", "one"] })).toEqual(["one", "two"]);
    expect(historyInstanceIds({ hiraya: true, instances: ["one", 2] }, ["fallback"])).toEqual(["fallback"]);
    expect(historyInstanceIds({ instances: ["one"] }, ["fallback"])).toEqual(["fallback"]);
  });

  test("identifies instances removed by a back navigation", () => {
    expect(removedHistoryInstanceIds(["editor", "settings", "preview"], ["editor", "settings"])).toEqual(["preview"]);
  });

  test("restores only supported Settings pages", () => {
    expect(historySettingsPage({ hiraya: true, settingsPage: "desktops" })).toBe("desktop/desktops");
    expect(historySettingsPage({ hiraya: true, settingsPage: "activity" })).toBe("sync-storage/activity");
    expect(historySettingsPage({ hiraya: true, settingsPage: "apps" })).toBe("files-apps/file-types");
    expect(historySettingsPage({ hiraya: true, settingsPage: "short-links" })).toBe("sharing/short-links");
    expect(historySettingsPage({ hiraya: true, settingsPage: "system/about" })).toBe("system/about");
    expect(historySettingsPage({ hiraya: true, settingsPage: "unknown" })).toBe("desktop");
    expect(historySettingsPage(null)).toBe("desktop");
  });
});
