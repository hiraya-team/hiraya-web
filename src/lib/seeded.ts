import { strToU8, zip, type Zippable } from "fflate";
import { toPortableSeededManifest } from "./seeded-manifest";
import type { DesktopStateSnapshot } from "../domain/desktop-state";
import type { DesktopEntry } from "../types";

/** Defines the export root. */
const EXPORT_ROOT = "hiraya-seeded";

/** Returns logical path. */
function logicalPath(entry: DesktopEntry, byId: Map<string, DesktopEntry>) {
  const segments = [entry.name];
  let parentId = entry.parentId;
  while (parentId !== null) {
    const parent = byId.get(parentId);
    if (!parent || parent.kind !== "folder") throw new Error("The desktop contains an invalid folder hierarchy.");
    segments.unshift(parent.name);
    parentId = parent.parentId;
  }
  return segments.join("/");
}

/** Returns portable path. */
function portablePath(entry: DesktopEntry, byId: Map<string, DesktopEntry>) {
  return logicalPath(entry, byId).split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

/** Creates zip. */
function createZip(files: Zippable) {
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (error, archive) => {
      if (error) reject(error);
      else resolve(archive);
    });
  });
}

/** Returns export seeded desktop. */
export async function exportSeededDesktop(snapshot: DesktopStateSnapshot, readContent: (id: string) => Promise<Blob>) {
  const byId = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  const archive: Zippable = { [`${EXPORT_ROOT}/`]: new Uint8Array() };
  await Promise.all(snapshot.entries.map(async (entry) => {
    const path = portablePath(entry, byId);
    if (entry.kind === "folder") {
      archive[`${EXPORT_ROOT}/content/${path}/`] = new Uint8Array();
      return;
    }
    const content = await readContent(entry.id);
    if (content.size !== entry.size) throw new Error(`The contents of “${entry.name}” could not be read.`);
    archive[`${EXPORT_ROOT}/content/${path}`] = new Uint8Array(await content.arrayBuffer());
    return;
  }));
  const manifest = toPortableSeededManifest({
    layout: snapshot.layout,
    editorSettings: snapshot.editorSettings,
    appearance: snapshot.appearance,
    entries: snapshot.entries,
  }, (entry) => `content/${portablePath(entry, byId)}`);
  archive[`${EXPORT_ROOT}/manifest.json`] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const zipped = await createZip(archive);
  const bytes = zipped.slice().buffer as ArrayBuffer;
  return new Blob([bytes], { type: "application/zip" });
}
