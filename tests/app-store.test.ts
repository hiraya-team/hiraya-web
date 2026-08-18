import { describe, expect, test } from "bun:test";
import { loadStorePackages } from "../src/lib/app-store";
import { remoteDesktopIdentity } from "./fixtures";

describe("app store content", () => {
  test("does not revive the retired desktop-backed app-store protocol", async () => {
    const desktop = { ...remoteDesktopIdentity(), purpose: "app-store" as const };
    await expect(loadStorePackages(desktop, "https://objects.example.test")).resolves.toEqual({ packages: [], managed: false, descriptor: null });
  });
});
