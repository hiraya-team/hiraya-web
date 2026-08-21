import { describe, expect, test } from "bun:test";
import { canMutateDesktop, localDesktopIdentity, OWNER_CAPABILITIES, READ_ONLY_CAPABILITIES, settingsRestrictionReason } from "../src/lib/permissions";
import type { DesktopIdentity } from "../src/types";

/** Builds the shared test fixture. */
function shared(role: DesktopIdentity["role"], capabilities: DesktopIdentity["capabilities"]): DesktopIdentity {
  return { id: "shared", name: "Shared", ownership: "shared", role, owner: { id: "owner", displayName: "Owner", avatar: null }, capabilities, authorityCatalogId: "owner-catalog" };
}

describe("desktop permissions", () => {
  test("keeps browser-local desktops as owners", () => {
    expect(localDesktopIdentity("desk", "Desktop")).toMatchObject({ ownership: "owned", role: "owner", capabilities: OWNER_CAPABILITIES });
  });

  test("requires write capability and preserves shared offline mutation", () => {
    const writer = shared("writer", { ...READ_ONLY_CAPABILITIES, write: true });
    expect(canMutateDesktop(writer, "online")).toBe(true);
    expect(canMutateDesktop(writer, "offline")).toBe(true);
    expect(canMutateDesktop(shared("reader", READ_ONLY_CAPABILITIES), "online")).toBe(false);
  });

  test("preserves owned offline queue behavior", () => {
    expect(canMutateDesktop(localDesktopIdentity("desk", "Desktop"), "offline")).toBe(true);
    expect(canMutateDesktop(localDesktopIdentity("desk", "Desktop"), "connecting")).toBe(false);
    expect(canMutateDesktop(localDesktopIdentity("desk", "Desktop"), "blocked")).toBe(true);
  });

  test("distinguishes role and connection restrictions", () => {
    const reader = shared("reader", READ_ONLY_CAPABILITIES);
    const manager = shared("manager", { ...OWNER_CAPABILITIES, delete: false });
    expect(settingsRestrictionReason(reader, "online")).toContain("role");
    expect(settingsRestrictionReason(manager, "offline")).toContain("read-only");
    expect(settingsRestrictionReason(manager, "connecting")).toContain("Connecting");
    expect(settingsRestrictionReason(manager, "blocked")).toContain("unrelated");
  });
});
