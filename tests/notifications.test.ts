import { describe, expect, test } from "bun:test";
import { nextUnreadNotificationIds } from "../src/features/notifications/controller";

describe("notification unread state", () => {
  test("marks only newly active notifications unread while closed", () => {
    const unread = nextUnreadNotificationIds(new Set(["removed", "existing"]), new Set(["existing"]), new Set(["existing", "new"]), false);
    expect([...unread]).toEqual(["existing", "new"]);
  });

  test("marks active notifications read when the panel opens", () => {
    expect(nextUnreadNotificationIds(new Set(["existing"]), new Set(), new Set(["existing"]), true).size).toBe(0);
  });
});
