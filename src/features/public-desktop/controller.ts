import { useEffect, useEffectEvent, useRef, useState } from "react";
import { fetchPublicDesktop, fetchPublicFile, LargeDownloadAuthRequiredError, type PublicAuthority } from "../../lib/public-desktop";
import { fileCapabilities } from "../../ui/file-capabilities";
import type { DesktopEntry, FileEntry } from "../../types";

export type PublicOpenView = { kind: "folder"; folderId: string | null } | { kind: "file"; file: FileEntry; blob?: File; error?: string };

export function usePublicDesktop(authority: PublicAuthority) {
  const [desktop, setDesktop] = useState<Awaited<ReturnType<typeof fetchPublicDesktop>> | null>(null);
  const [error, setError] = useState("");
  const [open, setOpenState] = useState<PublicOpenView | null>(null);
  const fileLoadGenerationRef = useRef(0);
  const [downloadGate, setDownloadGate] = useState<{ loginUrl: string; fileName: string } | null>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState("");
	const [wallpaperFailed, setWallpaperFailed] = useState(false);
	const loadInitialFile = useEffectEvent((file: FileEntry, next: Awaited<ReturnType<typeof fetchPublicDesktop>>) => loadFile(file, false, next));

	useEffect(() => {
		let cancelled = false;
		const currentAuthority = { desktopAlias: authority.desktopAlias, ...(authority.itemAlias ? { itemAlias: authority.itemAlias } : {}) };
		void fetchPublicDesktop(currentAuthority)
		.then((next) => {
			if (cancelled) return;
			setDesktop(next);
			const root = next.publishedRootId ? next.entries.find((entry) => entry.id === next.publishedRootId) : undefined;
			if (root?.kind === "folder") setOpenState({ kind: "folder", folderId: root.id });
			else if (root?.kind === "file") void loadInitialFile(root, next);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "The public desktop could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
    // useEffectEvent callbacks are intentionally non-reactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authority.desktopAlias, authority.itemAlias]);

  useEffect(() => {
    setWallpaperUrl("");
    setWallpaperFailed(false);
    const source = desktop?.layout.wallpaper.source;
    if (!desktop || !source?.startsWith("file:")) return;
    const file = desktop.entries.find((entry) => entry.id === source.slice(5));
    if (!file || file.kind !== "file") return;
    let disposed = false;
    let objectUrl = "";
    const contentRevision = desktop.entries.find((entry) => entry.id === file.id)?.contentRevision ?? 0;
	const currentAuthority = { desktopAlias: authority.desktopAlias, ...(authority.itemAlias ? { itemAlias: authority.itemAlias } : {}) };
	void fetchPublicFile(currentAuthority, file, contentRevision)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setWallpaperUrl(objectUrl);
      })
      .catch(() => { if (!disposed) setWallpaperFailed(true); });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
	}, [authority.desktopAlias, authority.itemAlias, desktop]);

	async function loadFile(file: FileEntry, downloadOnly = false, desktopOverride = desktop) {
    const generation = downloadOnly ? null : ++fileLoadGenerationRef.current;
    if (!downloadOnly && fileCapabilities(file).preview === "none") {
      setOpenState({ kind: "file", file });
      return;
    }
    if (!downloadOnly) setOpenState({ kind: "file", file });
    try {
		const contentRevision = desktopOverride?.entries.find((entry) => entry.id === file.id)?.contentRevision ?? 0;
		const blob = await fetchPublicFile(authority, file, contentRevision);
      if (downloadOnly) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      } else if (fileLoadGenerationRef.current === generation) setOpenState({ kind: "file", file, blob });
    } catch (reason) {
      if (!downloadOnly && fileLoadGenerationRef.current !== generation) return;
      if (reason instanceof LargeDownloadAuthRequiredError) setDownloadGate({ loginUrl: reason.loginUrl, fileName: file.name });
      else if (!downloadOnly) setOpenState({ kind: "file", file, error: reason instanceof Error ? reason.message : "The file could not be opened." });
      else setError(reason instanceof Error ? reason.message : "The file could not be downloaded.");
    }
  }

  function setOpen(next: PublicOpenView | null) {
    fileLoadGenerationRef.current += 1;
    setOpenState(next);
  }

  async function resolveLinkedFile(from: FileEntry, relativePath: string) {
    if (!desktop) throw new Error("The public desktop is unavailable.");
    const resolved = resolvePublicLinkedEntry(desktop.entries, from, relativePath);
    const contentRevision = desktop.entries.find((entry) => entry.id === resolved.id)?.contentRevision ?? 0;
	return { file: resolved, blob: await fetchPublicFile(authority, resolved, contentRevision) };
  }

  return {
    desktop,
    error,
    open,
    setOpen,
    downloadGate,
    dismissDownloadGate: () => setDownloadGate(null),
    wallpaperUrl,
    wallpaperFailed,
    loadFile,
    resolveLinkedFile,
  };
}

export function resolvePublicLinkedEntry(entries: readonly DesktopEntry[], from: FileEntry, relativePath: string): FileEntry {
    const path = relativePath.split(/[?#]/, 1)[0];
    if (!path || path.startsWith("/") || path.startsWith("\\") || /^[a-z][a-z\d+.-]*:/i.test(path)) throw new Error("That link is not a local relative file path.");
    let parentId = from.parentId;
    let resolved: DesktopEntry | undefined;
    const segments = path.split("/");
    for (const [position, encoded] of segments.entries()) {
      let segment: string;
      try {
        segment = decodeURIComponent(encoded);
      } catch {
        throw new Error("That link contains invalid URL encoding.");
      }
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        if (parentId === null) throw new Error("That link points outside the desktop.");
        parentId = entries.find((entry) => entry.id === parentId)?.parentId ?? null;
        resolved = undefined;
        continue;
      }
      resolved = entries.find((entry) => entry.parentId === parentId && entry.name.localeCompare(segment, undefined, { sensitivity: "accent" }) === 0);
      if (!resolved || (position < segments.length - 1 && resolved.kind !== "folder")) throw new Error(`No public file exists at “${relativePath}”.`);
      parentId = resolved.kind === "folder" ? resolved.id : resolved.parentId;
    }
    if (!resolved || resolved.kind !== "file") throw new Error(`No public file exists at “${relativePath}”.`);
    return resolved;
}
