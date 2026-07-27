import { describe, expect, test } from "bun:test";
import { connectionIndicator } from "../src/features/connection/controller";
import { formatDesktopClock } from "../src/features/shell/clock";
import { notificationPresentation } from "../src/features/notifications/controller";

describe("feature-owned shell controllers", () => {
  test("projects connection and bounded notification presentation", () => {
    expect(connectionIndicator("online", true, []).status).toBe("syncing");
    expect(connectionIndicator("online", false, [{ status: "pending" } as never]).status).toBe("waiting");
    expect(connectionIndicator("offline", false, []).tone).toBe("danger");
    expect(notificationPresentation("error", "saved", 2, 2)).toMatchObject({ total: 6, showError: true, hidden: 4 });
  });

  test("formats the isolated desktop clock without owning desktop state", () => {
    expect(formatDesktopClock(new Date("2026-07-27T12:34:00Z"))).toContain("34");
  });
});
