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
    expect(historySettingsPage({ hiraya: true, settingsPage: "themes" })).toBe("themes");
    expect(historySettingsPage({ hiraya: true, settingsPage: "unknown" })).toBe("main");
    expect(historySettingsPage(null)).toBe("main");
  });
});
