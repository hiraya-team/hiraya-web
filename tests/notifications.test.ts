import { describe, expect, test } from "bun:test";
import { nextNotificationOrder, nextUnreadNotificationIds } from "../src/features/notifications/controller";

describe("notification unread state", () => {
  test("marks only newly active notifications unread while closed", () => {
    const unread = nextUnreadNotificationIds(new Set(["removed", "existing"]), new Set(["existing"]), new Set(["existing", "new"]), false);
    expect([...unread]).toEqual(["existing", "new"]);
  });

  test("marks active notifications read when the panel opens", () => {
    expect(nextUnreadNotificationIds(new Set(["existing"]), new Set(), new Set(["existing"]), true).size).toBe(0);
  });
});

describe("notification panel order", () => {
  test("puts newly active notifications above existing items across sources", () => {
    const initial = nextNotificationOrder([], ["message:1"]);
    expect(nextNotificationOrder(initial, ["message:1", "app:example:1"])).toEqual(["app:example:1", "message:1"]);
  });

  test("preserves the position of active notifications when their state updates", () => {
    const current = ["transfer:2", "trash:1", "message:1"];
    expect(nextNotificationOrder(current, ["message:1", "trash:1", "transfer:2"])).toBe(current);
  });

  test("removes dismissed items without reordering survivors", () => {
    expect(nextNotificationOrder(["transfer:2", "trash:1", "message:1"], ["message:1", "transfer:2"])).toEqual(["transfer:2", "message:1"]);
  });

  test("treats a reintroduced notification as newest", () => {
    const afterDismiss = nextNotificationOrder(["app:1", "message:1"], ["message:1"]);
    expect(nextNotificationOrder(afterDismiss, ["message:1", "app:1"])).toEqual(["app:1", "message:1"]);
  });
});
