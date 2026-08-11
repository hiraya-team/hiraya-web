import { describe, expect, test } from "bun:test";
import { inspectSceneArchive } from "@hiraya-team/app-cli";
import { archiveWritePayload, SceneArchiveState, starterSceneArchive } from "./scene";

describe("Integrated Editor Scene archive state", () => {
  test("opens, edits, and repacks a valid Scene", async () => {
    const { state } = await SceneArchiveState.open(starterSceneArchive(), 3);
    state.writeText("scene.js", "document.body.textContent='edited'");
    expect(state.dirty).toBe(true);
    expect(state.pathDirty("scene.js")).toBe(true);
    expect((await inspectSceneArchive(state.pack())).manifest.entrypoint).toBe("index.html");
  });

  test("saves invalid drafts without losing editability", async () => {
    const { state } = await SceneArchiveState.open(starterSceneArchive(), 1);
    state.writeText("hiraya.scene.json", "{");
    expect((await state.inspectDraft()).manifestError).toBeTruthy();
    const saved = state.beginSave();
    expect(saved.bytes.byteLength).toBeGreaterThan(0);
    expect(new Uint8Array(archiveWritePayload(saved.bytes))).toEqual(saved.bytes);
    expect(await SceneArchiveState.open(saved.bytes, 2)).toBeTruthy();
  });

  test("preserves newer edits and reports remote conflicts", async () => {
    const { state } = await SceneArchiveState.open(starterSceneArchive(), 1);
    state.writeText("scene.js", "first");
    const pending = state.beginSave();
    state.writeText("scene.js", "newer");
    state.saved(pending.files, 2);
    expect(state.dirty).toBe(true);
    expect(await state.remote(starterSceneArchive(), 3)).toBe(false);
    expect(state.conflict).toBe(true);
    expect(state.readText("scene.js")).toBe("newer");
  });
});
