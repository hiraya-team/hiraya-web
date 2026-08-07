import { describe, expect, test } from "bun:test";
import { desktopCreateProtection, desktopDeleteProtection, parseDesktopCatalog, resolveDesktopContext } from "../src/lib/desktop-catalog";
import { remoteDesktopIdentity } from "./fixtures";

describe("desktop catalog", () => {
  test("parses strict schema version 2", () => {
    const value = { schemaVersion: 2, catalogId: "catalog-1", catalogRevision: 7, desktops: [remoteDesktopIdentity()], quota: { storageBytes: { used: 12, limit: 100 }, desktops: { used: 1, limit: 10 }, entries: { used: 2, limit: 5000 } } };
    expect(parseDesktopCatalog(value)).toEqual(value);
    expect(() => parseDesktopCatalog({ ...value, schemaVersion: 1 })).toThrow("schema version");
    expect(() => parseDesktopCatalog({ ...value, catalogRevision: -1 })).toThrow("revision");
    expect(parseDesktopCatalog({ ...value, desktops: [{ ...remoteDesktopIdentity(), pinned: undefined }] }).desktops[0].pinned).toBeFalse();
    expect(() => parseDesktopCatalog({ ...value, desktops: [{ ...remoteDesktopIdentity(), pinned: "yes" }] })).toThrow("pinned preference");
    expect(() => parseDesktopCatalog({ ...value, quota: { ...value.quota, entries: { used: 2, limit: 0 } } })).toThrow("entry quota");
  });

  test("identifies the deployment app store without accepting arbitrary purposes", () => {
    const store = { ...remoteDesktopIdentity(), purpose: "app-store" };
    const value = { schemaVersion: 2, catalogId: "catalog-1", catalogRevision: 7, desktops: [store], quota: { storageBytes: { used: 12, limit: 100 }, desktops: { used: 1, limit: 10 }, entries: { used: 2, limit: 5000 } } };
    expect(parseDesktopCatalog(value).desktops[0].purpose).toBe("app-store");
    expect(() => parseDesktopCatalog({ ...value, desktops: [{ ...store, purpose: "marketplace" }] })).toThrow("purpose");
  });

  test("uses tab-local selection and protects only the last desktop", () => {
    const desktops = [{ id: "one", name: "One" }, { id: "two", name: "Two" }];
    expect(resolveDesktopContext("two", desktops)).toBe("two");
    expect(resolveDesktopContext("missing", desktops)).toBe("one");
    expect(desktopDeleteProtection(2)).toBe("");
    expect(desktopDeleteProtection(1)).toContain("last desktop");
    expect(desktopCreateProtection(9, { storageBytes: { used: 0, limit: 1 }, desktops: { used: 9, limit: 10 }, entries: { used: 0, limit: 1 } })).toBe("");
    expect(desktopCreateProtection(10, { storageBytes: { used: 0, limit: 1 }, desktops: { used: 10, limit: 10 }, entries: { used: 0, limit: 1 } })).toContain("Desktop limit reached");
  });
});
