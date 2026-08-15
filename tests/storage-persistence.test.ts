import { describe, expect, test } from "bun:test";
import { requestStoragePersistence } from "../src/lib/storage-persistence";

describe("browser storage persistence", () => {
  test("reports unsupported without requesting persistence", async () => {
    expect(await requestStoragePersistence(undefined)).toBe("unsupported");
  });

  test("retains an existing grant without another request", async () => {
    let requests = 0;
    expect(await requestStoragePersistence({ persisted: async () => true, persist: async () => { requests += 1; return true; } })).toBe("granted");
    expect(requests).toBe(0);
  });

  test("reports granted, denied, and rejected requests without throwing", async () => {
    expect(await requestStoragePersistence({ persisted: async () => false, persist: async () => true })).toBe("granted");
    expect(await requestStoragePersistence({ persisted: async () => false, persist: async () => false })).toBe("denied");
    expect(await requestStoragePersistence({ persisted: async () => false, persist: async () => { throw new Error("blocked"); } })).toBe("denied");
  });

  test("coalesces repeated requests for the same storage manager", async () => {
    let requests = 0;
    const storage = { persisted: async () => false, persist: async () => { requests += 1; return true; } };
    expect(await Promise.all([requestStoragePersistence(storage), requestStoragePersistence(storage)])).toEqual(["granted", "granted"]);
    expect(requests).toBe(1);
  });
});
