import { describe, expect, test } from "bun:test";
import { formatDesktopClock } from "../src/features/shell/clock";
import { nextUnreadNotificationIds } from "../src/features/notifications/controller";
import { canViewDesktopActivity, localDesktopIdentity } from "../src/lib/permissions";

describe("feature-owned shell controllers", () => {
  test("projects notification unread state", () => {
    expect([...nextUnreadNotificationIds(new Set(), new Set(["known"]), new Set(["known", "new"]), false)]).toEqual(["new"]);
  });

  test("formats the isolated desktop clock without owning desktop state", () => {
    expect(formatDesktopClock(new Date("2026-07-27T12:34:00Z"))).toContain("34");
  });

  test("makes durable local activity available without exposing offline server history", () => {
    const desktop = localDesktopIdentity("desktop", "Desktop");
    expect(canViewDesktopActivity(desktop, "local")).toBe(true);
    expect(canViewDesktopActivity(desktop, "online")).toBe(true);
    expect(canViewDesktopActivity(desktop, "offline")).toBe(false);
  });
});
