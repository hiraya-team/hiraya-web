/** @jsxRuntime classic */
/** @jsx createElement */
/** @jsxFrag Fragment */
import { createElement, Fragment, useCallback, useEffect, useRef, useState, type ComponentType, type FormEvent } from "react";
import type { PublicAuthority } from "../lib/publication-alias";
import type { DesktopEntry, FileEntry } from "../types";
import type { CoreWorkspace, DesktopStart, ShellStartup } from "./startup";
import "./shell.css";

type ShellState = { kind: "loading" } | ShellStartup | { kind: "authentication-required" } | { kind: "error"; message: string };
type RichDesktop = ComponentType<DesktopStart>;
type PublicDesktop = ComponentType<{ authority: PublicAuthority }>;

function Startup() {
  return <main className="startup-state" role="status"><img src={`${import.meta.env.BASE_URL}hiraya-icon.svg`} alt="" /><div><strong>Hiraya</strong><span>Opening desktop...</span></div></main>;
}

function EntryIcon({ entry }: { entry: DesktopEntry }) {
  return <i className={`shell-entry__icon shell-entry__icon--${entry.kind}`} aria-hidden="true" />;
}

function CoreDesktop({ initialWorkspace, onRich }: { initialWorkspace: CoreWorkspace; onRich: () => void }) {
  const [entries, setEntries] = useState(initialWorkspace.entries);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [openedFileId, setOpenedFileId] = useState<string | null>(null);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const runtime = useRef<Promise<typeof import("../platform/storage/desktop-runtime")> | null>(null);
  const activeWorkspaceId = useRef(initialWorkspace.id);
  const unsubscribe = useRef<() => void>(() => undefined);

  useEffect(() => () => unsubscribe.current(), []);

  const openRuntime = () => {
    runtime.current ??= import("../platform/storage/desktop-runtime").then(async (storage) => {
      await storage.prepareDesktopRuntime();
      const registry = await storage.listDesktops();
      const selected = registry.desktops.some(({ id }) => id === activeWorkspaceId.current) ? activeWorkspaceId.current : registry.activeDesktopId ?? registry.desktops[0]?.id;
      if (!selected) throw new Error("No desktop is available.");
      activeWorkspaceId.current = selected;
      await storage.switchDesktop(selected);
      const initialized = await storage.initializeDesktop(selected, { x: window.innerWidth, y: Math.max(1, window.innerHeight - 44) });
      setEntries(initialized.desktop.entries);
      unsubscribe.current();
      unsubscribe.current = storage.subscribeToSync((desktop) => setEntries(desktop.entries), (reason) => setError(String(reason)));
      return storage;
    });
    return runtime.current;
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const kind = creating;
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name || !kind) return;
    setBusy(true);
    setError("");
    try {
      const storage = await openRuntime();
      if (kind === "folder") await storage.createFolder(name, folderId, { x: 72, y: 72 });
      else await storage.createTextFile(name, folderId, { x: 72, y: 72 });
      if (activeWorkspaceId.current) setEntries(await storage.readDesktopEntries(activeWorkspaceId.current));
      setCreating(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `The ${kind} could not be created.`);
    } finally {
      setBusy(false);
    }
  };

  const rootEntries = entries.filter(({ parentId }) => parentId === null);
  const folder = folderId ? entries.find((entry) => entry.id === folderId && entry.kind === "folder") : undefined;
  const folderEntries = folder ? entries.filter(({ parentId }) => parentId === folder.id) : [];
  const openedFile = openedFileId ? entries.find((entry): entry is FileEntry => entry.id === openedFileId && entry.kind === "file") : undefined;
  const openEntry = (entry: DesktopEntry) => entry.kind === "folder" ? (setOpenedFileId(null), setFolderId(entry.id)) : setOpenedFileId(entry.id);
  const entryButton = (entry: DesktopEntry, row = false) => <button className={`shell-entry${row ? " shell-entry--row" : ""}`} type="button" key={entry.id} onDoubleClick={() => openEntry(entry)} aria-label={`${entry.name}, ${entry.kind}`}><EntryIcon entry={entry} /><span className="shell-entry__label">{entry.name}</span></button>;

  return <main className="shell-desktop" aria-label="Hiraya desktop">
    <header className="shell-menu-bar">
      <span className="shell-brand"><img src={`${import.meta.env.BASE_URL}hiraya-icon.svg`} alt="" /><strong>Hiraya</strong></span>
      <nav aria-label="Desktop actions">
        <button type="button" onClick={() => setCreating("file")}>New file</button>
        <button type="button" onClick={() => setCreating("folder")}>New folder</button>
        <button type="button" onClick={onRich}>Open full desktop</button>
      </nav>
    </header>
    <section className="shell-surface" aria-label="Desktop files">{rootEntries.length ? rootEntries.map((entry) => entryButton(entry)) : <p className="shell-empty">This desktop is empty.</p>}</section>
    {folder && <section className="shell-window" role="dialog" aria-label={folder.name}>
      <header><strong>{folder.name}</strong><button type="button" onClick={() => setFolderId(null)} aria-label={`Close ${folder.name}`}><i className="shell-close-icon" aria-hidden="true" /></button></header>
      <div className="shell-window__content">{folderEntries.length ? folderEntries.map((entry) => entryButton(entry, true)) : <p>This folder is empty.</p>}</div>
    </section>}
    {openedFile && <section className="shell-window" role="dialog" aria-label={openedFile.name}>
      <header><strong>{openedFile.name}</strong><button type="button" onClick={() => setOpenedFileId(null)} aria-label={`Close ${openedFile.name}`}><i className="shell-close-icon" aria-hidden="true" /></button></header>
      <div className="shell-window__content shell-file-details"><EntryIcon entry={openedFile} /><p><strong>{openedFile.mimeType}</strong><span>{openedFile.size.toLocaleString()} bytes</span></p><button type="button" onClick={onRich}>Edit with Integrated Editor</button></div>
    </section>}
    {creating && <form className="shell-dialog" role="dialog" aria-label={`New ${creating}`} onSubmit={(event) => void create(event)}>
      <label>Name<input name="name" autoFocus required /></label>
      <span><button type="button" disabled={busy} onClick={() => setCreating(null)}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Creating..." : "Create"}</button></span>
    </form>}
    {error && <aside className="shell-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss error"><i className="shell-close-icon" aria-hidden="true" /></button></aside>}
  </main>;
}

export default function Shell() {
  const [state, setState] = useState<ShellState>({ kind: "loading" });
  const [richDesktop, setRichDesktop] = useState<RichDesktop | false | null>(null);
  const [richError, setRichError] = useState("");
  const [publicDesktop, setPublicDesktop] = useState<PublicDesktop | null>(null);

  const requestRich = useCallback(() => {
    setRichError("");
    setRichDesktop(false);
    void import("./rich").then(({ loadRichDesktop }) => loadRichDesktop()).then((Desktop) => setRichDesktop(() => Desktop)).catch((reason: unknown) => { setRichDesktop(null); setRichError(reason instanceof Error ? reason.message : String(reason)); });
  }, []);

  useEffect(() => {
    let active = true;
    void import("./startup").then(({ startShell }) => startShell()).then((next) => {
      if (!active) return;
      setState(next);
      if (next.kind === "public") void import("../PublicDesktop").then(({ default: Desktop }) => { if (active) setPublicDesktop(() => Desktop); });
      else if (/^\/desktops\//.test(window.location.pathname)) requestRich();
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof Error && error.name === "AuthenticationRequiredError") setState({ kind: "authentication-required" });
      else setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, [requestRich]);

  if (richDesktop === false) return <Startup />;
  if (richDesktop) {
    const Desktop = richDesktop;
    return <Desktop {...(state as Extract<ShellStartup, { kind: "desktop" }>).start} />;
  }
  if (state.kind === "loading" || state.kind === "authentication-required") return <Startup />;
  if (state.kind === "error") return <main className="startup-error"><h1>Hiraya could not start</h1><p>{state.message}</p><button className="button button--primary" type="button" onClick={() => window.location.reload()}>Reload Hiraya</button></main>;
  if (state.kind === "public") {
    const Desktop = publicDesktop;
    return Desktop ? <Desktop authority={state.authority} /> : <Startup />;
  }
  return createElement(Fragment, null, <CoreDesktop initialWorkspace={state.workspace} onRich={requestRich} />, richError && <aside className="shell-error" role="alert">The full desktop could not open. {richError}<button type="button" onClick={() => setRichError("")} aria-label="Dismiss error"><i className="shell-close-icon" aria-hidden="true" /></button></aside>);
}
