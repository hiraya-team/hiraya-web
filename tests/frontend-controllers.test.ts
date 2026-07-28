import { describe, expect, test } from "bun:test";
import { connectionIndicator } from "../src/features/connection/controller";
import { formatDesktopClock } from "../src/features/shell/clock";
import { nextUnreadNotificationIds } from "../src/features/notifications/controller";
import { canViewDesktopActivity, localDesktopIdentity } from "../src/lib/permissions";

describe("feature-owned shell controllers", () => {
  test("projects connection and notification unread state", () => {
    expect(connectionIndicator("online", true, []).status).toBe("syncing");
    expect(connectionIndicator("online", false, [{ status: "pending" } as never]).status).toBe("waiting");
    expect(connectionIndicator("offline", false, []).tone).toBe("danger");
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
