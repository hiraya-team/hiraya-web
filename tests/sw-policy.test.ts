import assert from "node:assert/strict";
import { test } from "node:test";
import { requestPolicy } from "../src/sw-policy";

const origin = "https://hiraya.example";

test("keeps API, server, and cross-origin requests out of the shell cache", () => {
  assert.equal(requestPolicy(`${origin}/api/files`, "cors", origin), "network-only");
  assert.equal(requestPolicy(`${origin}/api/events`, "cors", origin), "network-only");
  assert.equal(requestPolicy(`${origin}/login`, "navigate", origin), "network-only");
  assert.equal(requestPolicy(`${origin}/system-apps/editor.hiraya.app`, "navigate", origin), "network-only");
  assert.equal(requestPolicy("https://objects.example/chunk", "cors", origin), "network-only");
});

test("uses cache-first only for built assets and falls back only for shell navigation", () => {
  assert.equal(requestPolicy(`${origin}/assets/index-a1b2c3d4.js`, "cors", origin), "cache-first");
  assert.equal(requestPolicy(`${origin}/folder/notes`, "navigate", origin), "navigation");
  assert.equal(requestPolicy(`${origin}/hiraya/assets/index-a1b2c3d4.js`, "cors", origin, "/hiraya/"), "cache-first");
  assert.equal(requestPolicy(`${origin}/hiraya/folder/notes`, "navigate", origin, "/hiraya/"), "navigation");
});
