import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowsClockwise,
  BookOpenText,
  CaretRight,
  CheckCircle,
  Eye,
  FileText,
  FloppyDisk,
  Folder,
  FolderOpen,
  PencilSimple,
  Plus,
  RocketLaunch,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  HirayaSdkError,
  type AppCapabilities,
  type FileHandle,
  type FolderHandle,
  type HirayaClient,
  type LaunchContext,
} from "@hiraya/apps-sdk";
import { Editor } from "./Editor";
import {
  MAX_PUBLICATION_BYTES,
  OUTPUT_PATH,
  PROJECT_FILE,
  SITE_CSS_FILE,
  buildPublication,
  markdownAssetPaths,
  parseProjectText,
  serializeProject,
  type ProjectDefinition,
} from "./project";
import {
  describeError,
  exactBuffer,
  formatBytes,
  indexProject,
  isEditablePath,
  mimeTypeForPath,
  readTextSnapshot,
  type IndexedEntry,
} from "./studio";

type Surface = "files" | "write" | "preview" | "publish";
type Status = Readonly<{ message: string; danger?: boolean }>;
type Preferences = Readonly<{ fontSize: number; lineWrap: boolean }>;
type ProjectSession = Readonly<{
  root: FolderHandle;
  name: string;
  entries: IndexedEntry[];
  definition: ProjectDefinition | null;
}>;
type DocumentState = Readonly<{
  handle: FileHandle;
  path: string;
  name: string;
  mimeType: string;
  draft: string;
  persisted: string;
  revision: number;
  saving: boolean;
  conflict: boolean;
  remote?: string;
}>;

const APP_ID = "dev.hiraya.project-studio";
const PREFERENCES_KEY = "preferences-v1";
const DEFAULT_PREFERENCES: Preferences = { fontSize: 15, lineWrap: true };
const STARTER_MARKDOWN = `# Your publication starts here

Write in Markdown, add pages from the Files view, and preview the exact portable site before publishing.

## A durable workflow

- Your source remains ordinary Hiraya files.
- Saves detect changes from other writers.
- Publishing creates one self-contained HTML file.
`;
const STARTER_CSS = `/* Optional publication styles. This file is embedded into dist/index.html. */\n`;

export function App({ hiraya, launch }: Readonly<{ hiraya: HirayaClient; launch: LaunchContext }>) {
  const [capabilities, setCapabilities] = useState<AppCapabilities>({ files: { write: false, writeReason: "temporarily-unavailable" }, externalEmbeddedPreviews: false });
  const [project, setProject] = useState<ProjectSession | null>(null);
  const [documents, setDocuments] = useState<DocumentState[]>([]);
  const [activeHandle, setActiveHandle] = useState<FileHandle | null>(null);
  const [surface, setSurface] = useState<Surface>("files");
  const [status, setStatus] = useState<Status>({ message: "Connecting to Hiraya..." });
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewSize, setPreviewSize] = useState(0);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [newPageTitle, setNewPageTitle] = useState("");
  const projectRef = useRef(project);
  const documentsRef = useRef(documents);
  const activeHandleRef = useRef(activeHandle);
  const previewUrlRef = useRef(previewUrl);
  const commandRef = useRef<(id: string) => void>(() => undefined);
  const startRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const reconcileRef = useRef<(handle: FileHandle) => Promise<void>>(() => Promise.resolve());
  const refreshEntriesRef = useRef<(announce: boolean) => Promise<void>>(() => Promise.resolve());
  const chooseProjectRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const publishRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const refreshPreviewRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const saveAllRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const started = useRef(false);
  projectRef.current = project;
  documentsRef.current = documents;
  activeHandleRef.current = activeHandle;
  previewUrlRef.current = previewUrl;
  startRef.current = start;
  reconcileRef.current = reconcileDocument;
  refreshEntriesRef.current = refreshEntries;
  chooseProjectRef.current = chooseProject;
  publishRef.current = publish;
  refreshPreviewRef.current = refreshPreview;
  saveAllRef.current = saveAll;

  const activeDocument = documents.find((document) => document.handle === activeHandle) ?? null;
  const dirty = documents.some((document) => document.draft !== document.persisted);
  const canWrite = capabilities.files.write;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startRef.current();
  }, []);

  useEffect(() => {
    const unsubscribeCapabilities = hiraya.on("capabilities.changed", (next) => {
      setCapabilities(next);
      if (!next.files.write) setStatus({ message: writeRestriction(next.files.writeReason, documentsRef.current.some(isDirty)), danger: documentsRef.current.some(isDirty) });
    });
    const unsubscribeFiles = hiraya.on("files.changed", ({ handles }) => {
      for (const document of documentsRef.current) if (handles.includes(document.handle)) void reconcileRef.current(document.handle);
    });
    let focused = true;
    const unsubscribeWindow = hiraya.on("window.stateChanged", (state) => {
      if (state.focused && !focused) void refreshEntriesRef.current(false);
      focused = state.focused;
    });
    const unsubscribeCommands = hiraya.on("commands.invoked", ({ id }) => commandRef.current(id));
    return () => { unsubscribeCapabilities(); unsubscribeFiles(); unsubscribeWindow(); unsubscribeCommands(); };
  }, [hiraya]);

  useEffect(() => {
    void hiraya.window.setDirty(dirty);
    void hiraya.window.setTitle(project ? `${dirty ? "*" : ""}${project.name} - Project Studio` : "Project Studio");
  }, [dirty, hiraya, project]);

  useEffect(() => {
    const commands = [
      { id: "open-project", title: "Open project folder", shortcut: "Ctrl+Shift+O", enabled: !busy },
      { id: "refresh-project", title: "Refresh project", enabled: Boolean(project) && !busy },
      { id: "save", title: "Save active file", shortcut: "Ctrl+S", enabled: Boolean(activeDocument && isDirty(activeDocument) && canWrite && !activeDocument.saving) },
      { id: "save-all", title: "Save all files", shortcut: "Ctrl+Shift+S", enabled: dirty && canWrite && !busy },
      { id: "preview", title: "Refresh publication preview", shortcut: "Ctrl+Enter", enabled: Boolean(project?.definition) && !busy },
      { id: "publish", title: "Publish site", shortcut: "Ctrl+Shift+B", enabled: Boolean(project?.definition) && canWrite && !busy },
    ];
    void hiraya.commands.set(commands).catch(() => undefined);
  }, [activeDocument, busy, canWrite, dirty, hiraya, project]);

  useEffect(() => {
    commandRef.current = (id) => {
      if (id === "open-project") void chooseProject();
      if (id === "refresh-project") void refreshEntries(true);
      if (id === "save" && activeHandleRef.current) void saveDocument(activeHandleRef.current);
      if (id === "save-all") void saveAll();
      if (id === "preview") void refreshPreview();
      if (id === "publish") void publish();
    };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.shiftKey && event.key.toLowerCase() === "o") { event.preventDefault(); void chooseProjectRef.current(); }
      if (event.shiftKey && event.key.toLowerCase() === "s") { event.preventDefault(); void saveAllRef.current(); }
      if (event.shiftKey && event.key.toLowerCase() === "b") { event.preventDefault(); void publishRef.current(); }
      if (event.key === "Enter") { event.preventDefault(); void refreshPreviewRef.current(); }
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    void hiraya.storage.set(PREFERENCES_KEY, preferences).catch(() => undefined);
  }, [hiraya, preferences]);

  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);

  async function start() {
    try {
      const [nextCapabilities, stored] = await Promise.all([hiraya.app.getCapabilities(), hiraya.storage.get(PREFERENCES_KEY)]);
      setCapabilities(nextCapabilities);
      setPreferences(parsePreferences(stored));
      if (launch.folders[0]) await loadProject(launch.folders[0]);
      else setStatus({ message: "Choose a Hiraya folder to begin." });
    } catch (error) {
      setStatus({ message: describeError(error, "Project Studio could not start."), danger: true });
    }
  }

  async function chooseProject() {
    if (busy || !await confirmDiscardProject()) return;
    try {
      const root = await hiraya.dialogs.openFolder();
      if (root) await loadProject(root);
    } catch (error) {
      report(error, "Could not open the project folder.");
    }
  }

  async function confirmDiscardProject(): Promise<boolean> {
    if (!documentsRef.current.some(isDirty)) return true;
    return hiraya.dialogs.confirm({
      title: "Close unsaved drafts?",
      message: "Opening another project will discard unsaved changes in this Project Studio window.",
      confirmLabel: "Discard and open",
      destructive: true,
    });
  }

  async function loadProject(root: FolderHandle) {
    setBusy(true);
    setStatus({ message: "Reading project structure..." });
    try {
      const rootEntry = await hiraya.files.stat(root);
      if (rootEntry.kind !== "folder") throw new Error("The selected item is not a folder.");
      const entries = await indexProject(hiraya, root);
      const manifest = fileAt(entries, PROJECT_FILE);
      let definition: ProjectDefinition | null = null;
      if (manifest) definition = parseProjectText((await readTextSnapshot(hiraya, manifest.handle)).text);
      setDocuments([]);
      setActiveHandle(null);
      const session = { root, name: rootEntry.metadata.name, entries, definition };
      setProject(session);
      setSurface(definition ? "write" : "files");
      if (definition) {
        const firstPage = fileAt(entries, definition.pages[0].path);
        if (!firstPage) throw new Error(`The first page, ${definition.pages[0].path}, is missing.`);
        await openDocument(firstPage);
        setStatus({ message: `Opened ${definition.title}.` });
      } else {
        setStatus({ message: `This folder is ready to become a Project Studio publication.` });
      }
    } catch (error) {
      setProject(null);
      report(error, "Could not read the project folder.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshEntries(announce: boolean) {
    const current = projectRef.current;
    if (!current || busy) return;
    try {
      const entries = await indexProject(hiraya, current.root);
      setProject({ ...current, entries });
      if (announce) setStatus({ message: `Refreshed ${current.name}.` });
    } catch (error) {
      report(error, "Could not refresh the project.");
    }
  }

  async function initializeProject() {
    const current = projectRef.current;
    if (!current || current.definition || busy || !canWrite) return;
    const confirmed = await hiraya.dialogs.confirm({
      title: "Initialize this folder?",
      message: `Create ${PROJECT_FILE}, a starter page, optional site styles, and an assets folder in ${current.name}? Existing files will be preserved.`,
      confirmLabel: "Initialize project",
    });
    if (!confirmed) return;
    setBusy(true);
    const created: Array<FileHandle | FolderHandle> = [];
    try {
      const existing = new Set(current.entries.map(({ path }) => path.toLocaleLowerCase()));
      if (!existing.has("assets")) created.push((await hiraya.files.createFolder(current.root, "assets", { timeoutMs: 120_000 })).handle);
      if (!existing.has("index.md")) created.push((await createTextFile(current.root, "index.md", STARTER_MARKDOWN, "text/markdown; charset=utf-8")).handle);
      if (!existing.has(SITE_CSS_FILE)) created.push((await createTextFile(current.root, SITE_CSS_FILE, STARTER_CSS, "text/css; charset=utf-8")).handle);
      const definition: ProjectDefinition = { schemaVersion: 1, title: current.name, description: "A publication made with Hiraya Project Studio.", pages: [{ path: "index.md", title: "Home" }] };
      created.push((await createTextFile(current.root, PROJECT_FILE, serializeProject(definition), "application/json")).handle);
      await loadProject(current.root);
      setStatus({ message: `${current.name} is ready to write.` });
    } catch (error) {
      for (const handle of created.reverse()) try { await hiraya.files.delete(handle, true, { timeoutMs: 120_000 }); } catch { /* Preserve the initialization error. */ }
      report(error, "Could not initialize the project.");
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(entry: IndexedEntry) {
    if (entry.kind !== "file") return;
    if (!isEditablePath(entry.path)) {
      await hiraya.host.openEntry(entry.handle);
      return;
    }
    const existing = documentsRef.current.find((document) => document.handle === entry.handle);
    if (existing) {
      setActiveHandle(existing.handle);
      setSurface("write");
      return;
    }
    setStatus({ message: `Opening ${entry.name}...` });
    try {
      const snapshot = await readTextSnapshot(hiraya, entry.handle);
      const document: DocumentState = {
        handle: entry.handle,
        path: entry.path,
        name: entry.name,
        mimeType: snapshot.metadata.mimeType,
        draft: snapshot.text,
        persisted: snapshot.text,
        revision: snapshot.metadata.contentRevision,
        saving: false,
        conflict: false,
      };
      setDocuments((current) => current.some(({ handle }) => handle === document.handle) ? current : [...current, document]);
      setActiveHandle(document.handle);
      setSurface("write");
      setStatus({ message: `Opened ${entry.path}.` });
    } catch (error) {
      report(error, `Could not open ${entry.name}.`);
    }
  }

  function editDocument(handle: FileHandle, draft: string) {
    setDocuments((current) => current.map((document) => document.handle === handle ? { ...document, draft } : document));
  }

  async function saveDocument(handle: FileHandle) {
    const document = documentsRef.current.find((candidate) => candidate.handle === handle);
    if (!document || document.saving || !isDirty(document) || !canWrite) return;
    const source = document.draft;
    setDocuments((current) => current.map((candidate) => candidate.handle === handle ? { ...candidate, saving: true } : candidate));
    setStatus({ message: `Saving ${document.name}...` });
    try {
      const bytes = new TextEncoder().encode(source);
      const saved = await hiraya.files.writeAll(handle, exactBuffer(bytes), { mimeType: document.mimeType || mimeTypeForPath(document.path), expectedRevision: document.revision, timeoutMs: 120_000 });
      setDocuments((current) => current.map((candidate) => candidate.handle === handle ? {
        ...candidate,
        name: saved.name,
        persisted: source,
        revision: saved.contentRevision,
        saving: false,
        conflict: false,
        remote: undefined,
      } : candidate));
      setStatus({ message: `Saved ${document.name} locally.` });
      if (document.path === PROJECT_FILE) await reloadDefinition(source);
    } catch (error) {
      const conflict = error instanceof HirayaSdkError && error.code === "CONFLICT";
      let remote: string | undefined;
      if (conflict) {
        try { remote = (await readTextSnapshot(hiraya, handle)).text; } catch { /* The draft remains safe even if comparison loading fails. */ }
      }
      setDocuments((current) => current.map((candidate) => candidate.handle === handle ? { ...candidate, saving: false, conflict: conflict || candidate.conflict, ...(remote === undefined ? {} : { remote }) } : candidate));
      report(error, `Could not save ${document.name}.`);
    }
  }

  async function saveAll() {
    for (const document of documentsRef.current.filter(isDirty)) await saveDocument(document.handle);
  }

  async function closeDocument(handle: FileHandle) {
    const document = documentsRef.current.find((candidate) => candidate.handle === handle);
    if (!document) return;
    if (isDirty(document) && !await hiraya.dialogs.confirm({ title: "Close unsaved document?", message: `${document.name} has changes that have not been saved.`, confirmLabel: "Discard changes", destructive: true })) return;
    const index = documentsRef.current.findIndex((candidate) => candidate.handle === handle);
    const next = documentsRef.current[index + 1] ?? documentsRef.current[index - 1] ?? null;
    setDocuments((current) => current.filter((candidate) => candidate.handle !== handle));
    if (activeHandleRef.current === handle) setActiveHandle(next?.handle ?? null);
  }

  async function reconcileDocument(handle: FileHandle) {
    const document = documentsRef.current.find((candidate) => candidate.handle === handle);
    if (!document || document.saving) return;
    try {
      const snapshot = await readTextSnapshot(hiraya, handle);
      if (snapshot.metadata.contentRevision === document.revision) return;
      if (isDirty(document)) {
        setDocuments((current) => current.map((candidate) => candidate.handle === handle ? { ...candidate, conflict: true, remote: snapshot.text } : candidate));
        setStatus({ message: `${document.name} changed elsewhere. Your draft is preserved.`, danger: true });
      } else {
        setDocuments((current) => current.map((candidate) => candidate.handle === handle ? { ...candidate, draft: snapshot.text, persisted: snapshot.text, revision: snapshot.metadata.contentRevision, conflict: false, remote: undefined } : candidate));
        setStatus({ message: `Reloaded ${document.name} after an external change.` });
      }
    } catch (error) {
      report(error, `Could not reconcile ${document.name}.`);
    }
  }

  async function reloadRemote(handle: FileHandle) {
    const document = documentsRef.current.find((candidate) => candidate.handle === handle);
    if (document && isDirty(document) && !await hiraya.dialogs.confirm({ title: "Discard your preserved draft?", message: `Replace your unsaved ${document.name} draft with the latest remote version?`, confirmLabel: "Discard draft", destructive: true })) return;
    try {
      const snapshot = await readTextSnapshot(hiraya, handle);
      setDocuments((current) => current.map((document) => document.handle === handle ? { ...document, draft: snapshot.text, persisted: snapshot.text, revision: snapshot.metadata.contentRevision, conflict: false, remote: undefined } : document));
      setStatus({ message: "Loaded the remote version." });
    } catch (error) {
      report(error, "Could not load the remote version.");
    }
  }

  async function saveCopy(handle: FileHandle) {
    const document = documentsRef.current.find((candidate) => candidate.handle === handle);
    if (!document || !canWrite) return;
    try {
      const destination = await hiraya.dialogs.saveFile({ suggestedName: copyName(document.name), mimeType: document.mimeType });
      if (!destination) return;
      const entry = await hiraya.files.stat(destination);
      if (entry.kind !== "file") throw new Error("The selected destination is not a file.");
      const bytes = new TextEncoder().encode(document.draft);
      await hiraya.files.writeAll(destination, exactBuffer(bytes), { mimeType: document.mimeType, expectedRevision: entry.metadata.contentRevision, timeoutMs: 120_000 });
      setStatus({ message: `Saved a copy of ${document.name}.` });
    } catch (error) {
      report(error, `Could not save a copy of ${document.name}.`);
    }
  }

  async function overwriteRemote(handle: FileHandle) {
    const document = documentsRef.current.find((candidate) => candidate.handle === handle);
    if (!document || !canWrite) return;
    if (!await hiraya.dialogs.confirm({ title: "Replace the remote version?", message: `Overwrite the latest version of ${document.name} with your preserved draft?`, confirmLabel: "Replace remote", destructive: true })) return;
    try {
      const entry = await hiraya.files.stat(handle);
      if (entry.kind !== "file") throw new Error("The document is no longer a file.");
      const bytes = new TextEncoder().encode(document.draft);
      const saved = await hiraya.files.writeAll(handle, exactBuffer(bytes), { mimeType: document.mimeType, expectedRevision: entry.metadata.contentRevision, timeoutMs: 120_000 });
      setDocuments((current) => current.map((candidate) => candidate.handle === handle ? { ...candidate, persisted: document.draft, revision: saved.contentRevision, conflict: false, remote: undefined } : candidate));
      setStatus({ message: `Replaced the remote version of ${document.name}.` });
    } catch (error) {
      report(error, `Could not replace ${document.name}.`);
    }
  }

  async function createPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = projectRef.current;
    if (!current?.definition || !canWrite || busy) return;
    const name = newPageName.trim().replace(/\.md$/i, "");
    const path = `${name}.md`;
    const title = newPageTitle.trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,119}$/u.test(name) || !title) {
      setStatus({ message: "Use a short page name without slashes and provide a page title.", danger: true });
      return;
    }
    setBusy(true);
    let created: FileHandle | null = null;
    try {
      if (current.entries.some((entry) => entry.path.toLocaleLowerCase() === path.toLocaleLowerCase())) throw new Error(`${path} already exists.`);
      const manifest = fileAt(current.entries, PROJECT_FILE);
      if (!manifest) throw new Error(`${PROJECT_FILE} is missing.`);
      const latest = await readTextSnapshot(hiraya, manifest.handle);
      const definition = parseProjectText(latest.text);
      const nextDefinition: ProjectDefinition = { ...definition, pages: [...definition.pages, { path, title }] };
      created = (await createTextFile(current.root, path, `# ${title}\n\nStart writing here.\n`, "text/markdown; charset=utf-8")).handle;
      const bytes = new TextEncoder().encode(serializeProject(nextDefinition));
      await hiraya.files.writeAll(manifest.handle, exactBuffer(bytes), { mimeType: "application/json", expectedRevision: latest.metadata.contentRevision, timeoutMs: 120_000 });
      setNewPageOpen(false);
      setNewPageName("");
      setNewPageTitle("");
      await loadProject(current.root);
      const next = projectRef.current?.entries.find((entry) => entry.path === path);
      if (next) await openDocument(next);
      setStatus({ message: `Created ${title}.` });
    } catch (error) {
      if (created) try { await hiraya.files.delete(created, false, { timeoutMs: 120_000 }); } catch { /* Preserve the create error. */ }
      report(error, "Could not create the page.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshPreview() {
    if (!projectRef.current?.definition || busy) return;
    setBusy(true);
    setSurface("preview");
    setStatus({ message: "Materializing publication preview..." });
    try {
      const { html, project: compiledProject } = await compilePublication(true);
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      setPreviewUrl(url);
      setPreviewSize(new TextEncoder().encode(html).byteLength);
      setStatus({ message: `Previewed ${compiledProject.pages.length} page${compiledProject.pages.length === 1 ? "" : "s"} from current drafts.` });
    } catch (error) {
      report(error, "Could not build the preview.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    const current = projectRef.current;
    if (!current?.definition || busy || !canWrite) return;
    setBusy(true);
    setSurface("publish");
    setStatus({ message: "Validating and publishing the current project snapshot..." });
    try {
      const { html, project: compiledProject } = await compilePublication(false);
      const bytes = new TextEncoder().encode(html);
      if (bytes.byteLength > MAX_PUBLICATION_BYTES) throw new Error(`The publication is ${formatBytes(bytes.byteLength)}; Hiraya app writes are limited to ${formatBytes(MAX_PUBLICATION_BYTES)}.`);
      const dist = await resolveOrCreateDist(current.root);
      const children = await hiraya.files.list(dist);
      const existing = children.find((entry) => entry.kind === "file" && entry.metadata.name.toLocaleLowerCase() === "index.html");
      if (existing?.kind === "file") {
        await hiraya.files.writeAll(existing.metadata.handle, exactBuffer(bytes), { mimeType: "text/html; charset=utf-8", expectedRevision: existing.metadata.contentRevision, timeoutMs: 120_000 });
      } else {
        const temporary = await hiraya.files.createFile({ parent: dist, name: `.project-studio-${Date.now().toString(36)}.html`, mimeType: "text/html; charset=utf-8" }, { timeoutMs: 120_000 });
        try {
          await hiraya.files.writeAll(temporary.handle, exactBuffer(bytes), { mimeType: "text/html; charset=utf-8", expectedRevision: temporary.contentRevision, timeoutMs: 120_000 });
          await hiraya.files.rename(temporary.handle, "index.html", { timeoutMs: 120_000 });
        } catch (error) {
          try { await hiraya.files.delete(temporary.handle, false, { timeoutMs: 120_000 }); } catch { /* Preserve the publication error. */ }
          throw error;
        }
      }
      setPreviewSize(bytes.byteLength);
      setStatus({ message: `Published ${compiledProject.pages.length} page${compiledProject.pages.length === 1 ? "" : "s"} to ${OUTPUT_PATH} (${formatBytes(bytes.byteLength)}), saved locally.` });
      await hiraya.notifications.show({ title: "Publication ready", body: `${OUTPUT_PATH} was saved locally in ${current.name}.`, tag: "project-publish" });
    } catch (error) {
      report(error, "Could not publish the site.");
    } finally {
      setBusy(false);
    }
  }

  async function compilePublication(preview: boolean) {
    const current = projectRef.current;
    if (!current) throw new Error("Open a project first.");
    const manifestEntry = fileAt(current.entries, PROJECT_FILE);
    if (!manifestEntry) throw new Error(`${PROJECT_FILE} is missing.`);
    const manifestText = await textForEntry(manifestEntry);
    const definition = parseProjectText(manifestText);
    const pageSources = new Map<string, string>();
    for (const page of definition.pages) {
      const entry = fileAt(current.entries, page.path);
      if (!entry) throw new Error(`Page source is missing: ${page.path}`);
      pageSources.set(page.path, await textForEntry(entry));
    }
    const assetPaths = new Set<string>();
    for (const [path, source] of pageSources) for (const asset of markdownAssetPaths(path, source)) assetPaths.add(asset);
    const assets = new Map<string, string>();
    for (const path of assetPaths) {
      const entry = fileAt(current.entries, path);
      if (!entry) continue;
      const result = await hiraya.files.readAll(entry.handle, { timeoutMs: 120_000 });
      if (!/^image\/(?:avif|gif|jpeg|png|webp)$/i.test(result.mimeType)) continue;
      assets.set(path, await dataUrl(result.data, result.mimeType));
    }
    const cssEntry = fileAt(current.entries, SITE_CSS_FILE);
    const siteCss = cssEntry ? await textForEntry(cssEntry) : "";
    const html = buildPublication({ project: definition, pages: pageSources, assets, siteCss, preview });
    if (new TextEncoder().encode(html).byteLength > MAX_PUBLICATION_BYTES) throw new Error(`The generated publication exceeds Hiraya's ${formatBytes(MAX_PUBLICATION_BYTES)} app-write limit.`);
    return { html, project: definition };
  }

  async function textForEntry(entry: IndexedEntry): Promise<string> {
    const open = documentsRef.current.find((document) => document.handle === entry.handle || document.path === entry.path);
    return open?.draft ?? (await readTextSnapshot(hiraya, entry.handle as FileHandle)).text;
  }

  async function resolveOrCreateDist(root: FolderHandle): Promise<FolderHandle> {
    try {
      const entry = await hiraya.files.resolve(root, "dist");
      if (entry.kind !== "folder") throw new Error("dist exists but is not a folder.");
      return entry.metadata.handle;
    } catch (error) {
      if (!(error instanceof HirayaSdkError && error.code === "NOT_FOUND")) throw error;
      return (await hiraya.files.createFolder(root, "dist", { timeoutMs: 120_000 })).handle;
    }
  }

  async function reloadDefinition(text: string) {
    const definition = parseProjectText(text);
    setProject((current) => current ? { ...current, definition } : current);
  }

  async function createTextFile(parent: FolderHandle, name: string, text: string, mimeType: string) {
    const bytes = new TextEncoder().encode(text);
    return hiraya.files.createFile({ parent, name, data: exactBuffer(bytes), mimeType }, { timeoutMs: 120_000 });
  }

  function report(error: unknown, fallback: string) {
    const message = describeError(error, fallback);
    if (message) setStatus({ message, danger: true });
  }

  const filePane = project ? (
    <aside className={`project-pane surface surface--files ${surface === "files" ? "surface--active" : ""}`} aria-label="Project files">
      <div className="pane-heading">
        <div><strong>{project.name}</strong><span>{project.entries.filter(({ kind }) => kind === "file").length} files</span></div>
        <button className="icon-button" type="button" onClick={() => void refreshEntries(true)} aria-label="Refresh project" disabled={busy}><ArrowsClockwise /></button>
      </div>
      {!project.definition ? (
        <div className="initialize-callout">
          <BookOpenText size={30} aria-hidden="true" />
          <h2>Make this a publication</h2>
          <p>Add a safe starter manifest and first page without changing existing files.</p>
          <button className="primary-button" type="button" onClick={() => void initializeProject()} disabled={!canWrite || busy}>Initialize project</button>
        </div>
      ) : (
        <>
          <div className="file-actions">
            <button type="button" onClick={() => setNewPageOpen((open) => !open)} disabled={!canWrite || busy}><Plus /> New page</button>
          </div>
          {newPageOpen && (
            <form className="new-page-form" onSubmit={(event) => void createPage(event)}>
              <label>File name<input value={newPageName} onChange={(event) => setNewPageName(event.target.value)} placeholder="field-notes" autoComplete="off" /></label>
              <label>Page title<input value={newPageTitle} onChange={(event) => setNewPageTitle(event.target.value)} placeholder="Field notes" autoComplete="off" /></label>
              <div><button type="button" onClick={() => setNewPageOpen(false)}>Cancel</button><button className="primary-button" type="submit">Create page</button></div>
            </form>
          )}
          <div className="file-tree" role="list">
            {project.entries.map((entry) => (
              <button
                className={`file-row ${activeDocument?.path === entry.path ? "file-row--active" : ""}`}
                type="button"
                role="listitem"
                key={entry.handle}
                style={{ "--depth": entry.depth } as React.CSSProperties}
                onClick={() => entry.kind === "file" ? void openDocument(entry) : undefined}
                disabled={entry.kind === "folder"}
              >
                {entry.kind === "folder" ? <Folder weight="fill" /> : <FileText />}
                <span>{entry.name}</span>
                {entry.kind === "file" && isEditablePath(entry.path) && <CaretRight className="file-row-caret" />}
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  ) : null;

  const editorPane = (
    <main className={`editor-pane surface surface--write ${surface === "write" ? "surface--active" : ""}`} aria-label="Editor">
      {documents.length > 0 && (
        <div className="document-tabs" role="toolbar" aria-label="Open documents">
          {documents.map((document) => (
            <div className={`document-tab ${document.handle === activeHandle ? "document-tab--active" : ""}`} role="presentation" key={document.handle}>
              <button type="button" aria-current={document.handle === activeHandle ? "page" : undefined} onClick={() => { setActiveHandle(document.handle); setSurface("write"); }}>
                {isDirty(document) && <span className="dirty-dot" aria-label="Unsaved changes" />}{document.name}
              </button>
              <button className="tab-close" type="button" onClick={() => void closeDocument(document.handle)} aria-label={`Close ${document.name}`}><X /></button>
            </div>
          ))}
        </div>
      )}
      {activeDocument ? (
        <>
          <div className="editor-toolbar">
            <div><strong>{activeDocument.name}</strong><span>{activeDocument.path}</span></div>
            <button className="save-button" type="button" onClick={() => void saveDocument(activeDocument.handle)} disabled={!canWrite || !isDirty(activeDocument) || activeDocument.saving}>
              <FloppyDisk /> {activeDocument.saving ? "Saving" : "Save"}
            </button>
          </div>
          {activeDocument.conflict && (
            <section className="conflict" aria-labelledby="conflict-title">
              <WarningCircle weight="fill" aria-hidden="true" />
              <div><strong id="conflict-title">Another version exists</strong><p>Your draft is preserved. Review both versions or choose how to continue.</p></div>
              <div className="conflict-actions">
                <button type="button" onClick={() => void reloadRemote(activeDocument.handle)}>Use remote</button>
                <button type="button" onClick={() => void saveCopy(activeDocument.handle)}>Save copy</button>
                <button className="danger-button" type="button" onClick={() => void overwriteRemote(activeDocument.handle)}>Replace remote</button>
              </div>
              {activeDocument.remote !== undefined && <details><summary>Compare text</summary><div className="conflict-review"><section><h3>Your draft</h3><pre>{activeDocument.draft}</pre></section><section><h3>Remote</h3><pre>{activeDocument.remote}</pre></section></div></details>}
            </section>
          )}
          <div className="editor-stage">
            <Editor path={activeDocument.path} value={activeDocument.draft} readOnly={!canWrite} fontSize={preferences.fontSize} lineWrap={preferences.lineWrap} onChange={(value) => editDocument(activeDocument.handle, value)} onSave={() => void saveDocument(activeDocument.handle)} />
          </div>
        </>
      ) : (
        <EmptyTask icon={<PencilSimple />} title="Choose something to write" body="Open a text file from the project rail, or create a new Markdown page." action={() => setSurface("files")} actionLabel="Browse files" />
      )}
    </main>
  );

  const publicationPane = (
    <aside className={`publication-pane surface ${surface === "preview" || surface === "publish" ? "surface--active" : ""}`} aria-label="Publication">
      <div className="publication-tabs" role="tablist" aria-label="Publication tools">
        <button type="button" role="tab" aria-selected={surface === "preview"} onClick={() => setSurface("preview")}><Eye /> Preview</button>
        <button type="button" role="tab" aria-selected={surface === "publish"} onClick={() => setSurface("publish")}><RocketLaunch /> Publish</button>
      </div>
      {surface !== "publish" ? (
        <div className="preview-surface">
          {previewUrl ? <iframe src={previewUrl} title="Publication preview" sandbox="allow-scripts" referrerPolicy="no-referrer" /> : <EmptyTask icon={<Eye />} title="Preview current drafts" body="Materialize every listed page, local image, and project style inside an isolated publication frame." action={() => void refreshPreview()} actionLabel="Build preview" />}
          {previewUrl && <button className="preview-refresh" type="button" onClick={() => void refreshPreview()} disabled={busy}><ArrowsClockwise /> Refresh preview</button>}
        </div>
      ) : (
        <div className="publish-surface">
          <div className="publish-mark"><RocketLaunch weight="duotone" /></div>
          <h2>One file, ready to travel</h2>
          <p>Project Studio validates the current drafts, embeds local raster images and styles, then atomically writes the finished publication.</p>
          <dl><div><dt>Destination</dt><dd>{OUTPUT_PATH}</dd></div><div><dt>Pages</dt><dd>{project?.definition?.pages.length ?? 0}</dd></div><div><dt>Last preview</dt><dd>{previewSize ? formatBytes(previewSize) : "Not built"}</dd></div><div><dt>Write access</dt><dd>{canWrite ? "Available" : writeRestriction(capabilities.files.writeReason, false)}</dd></div></dl>
          <button className="publish-button" type="button" onClick={() => void publish()} disabled={!project?.definition || !canWrite || busy}><RocketLaunch weight="fill" /> {busy ? "Publishing..." : "Publish site"}</button>
          <p className="publish-footnote">Completion means the output is committed locally to Hiraya. Server synchronization may continue afterward.</p>
          <fieldset>
            <legend>Writing preferences</legend>
            <label>Text size<select value={preferences.fontSize} onChange={(event) => setPreferences({ ...preferences, fontSize: Number(event.target.value) })}>{[13, 14, 15, 16, 18, 20].map((size) => <option value={size} key={size}>{size}px</option>)}</select></label>
            <label><input type="checkbox" checked={preferences.lineWrap} onChange={(event) => setPreferences({ ...preferences, lineWrap: event.target.checked })} /> Wrap long lines</label>
          </fieldset>
        </div>
      )}
    </aside>
  );

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <button className="brand" type="button" onClick={() => setSurface("files")} aria-label="Project Studio files"><BookOpenText weight="duotone" /><span><strong>Project Studio</strong><small>{project?.definition?.title ?? project?.name ?? "Portable publishing"}</small></span></button>
        <div className="header-actions">
          <button type="button" aria-label="Open project folder" onClick={() => void chooseProject()} disabled={busy}><FolderOpen /><span>Open</span></button>
          <button className="primary-button" type="button" aria-label="Save active file" onClick={() => activeHandle ? void saveDocument(activeHandle) : undefined} disabled={!activeDocument || !isDirty(activeDocument) || !canWrite || busy}><FloppyDisk /><span>Save</span></button>
        </div>
      </header>
      {!project ? (
        <section className="welcome">
          <div className="welcome-art" aria-hidden="true"><BookOpenText weight="thin" /><span /><span /><span /></div>
          <div><h1>Turn a folder into a publication.</h1><p>Write Markdown with revision-safe saves, inspect the exact portable result, and publish one self-contained site without leaving Hiraya.</p><button className="primary-button welcome-action" type="button" onClick={() => void chooseProject()} disabled={busy}><FolderOpen /> Open project folder</button></div>
        </section>
      ) : (
        <div className="workspace">{filePane}{editorPane}{publicationPane}</div>
      )}
      <div className={`studio-status ${status.danger ? "studio-status--danger" : ""}`} role="status" aria-live={status.danger ? "assertive" : "polite"}>
        {status.danger ? <WarningCircle weight="fill" /> : busy ? <ArrowsClockwise className="spin" /> : <CheckCircle weight="fill" />}
        <span>{status.message}</span>
        {!canWrite && project && <span className="status-badge">Read only</span>}
      </div>
      {project && (
        <nav className="mobile-nav" aria-label="Project Studio modes">
          <ModeButton mode="files" current={surface} label="Files" icon={<Folder />} onSelect={setSurface} />
          <ModeButton mode="write" current={surface} label="Write" icon={<PencilSimple />} onSelect={setSurface} />
          <ModeButton mode="preview" current={surface} label="Preview" icon={<Eye />} onSelect={(next) => { setSurface(next); if (!previewUrl) void refreshPreview(); }} />
          <ModeButton mode="publish" current={surface} label="Publish" icon={<RocketLaunch />} onSelect={setSurface} />
        </nav>
      )}
    </div>
  );
}

function EmptyTask({ icon, title, body, action, actionLabel }: Readonly<{ icon: React.ReactNode; title: string; body: string; action(): void; actionLabel: string }>) {
  return <div className="empty-task"><div>{icon}</div><h2>{title}</h2><p>{body}</p><button className="primary-button" type="button" onClick={action}>{actionLabel}</button></div>;
}

function ModeButton({ mode, current, label, icon, onSelect }: Readonly<{ mode: Surface; current: Surface; label: string; icon: React.ReactNode; onSelect(mode: Surface): void }>) {
  return <button type="button" aria-current={current === mode ? "page" : undefined} onClick={() => onSelect(mode)}>{icon}<span>{label}</span></button>;
}

function fileAt(entries: IndexedEntry[], path: string): IndexedEntry & { kind: "file"; handle: FileHandle } | null {
  const entry = entries.find((candidate) => candidate.kind === "file" && candidate.path === path);
  return entry ? entry as IndexedEntry & { kind: "file"; handle: FileHandle } : null;
}

function isDirty(document: DocumentState): boolean {
  return document.draft !== document.persisted;
}

function writeRestriction(reason: AppCapabilities["files"]["writeReason"], dirty: boolean): string {
  const explanation = reason === "read-only" ? "This project is read-only." : reason === "shared-offline" ? "Reconnect to edit this shared project." : reason === "available" ? "Writing is available." : "Writing is temporarily unavailable.";
  return dirty ? `Unsaved drafts preserved. ${explanation}` : explanation;
}

function parsePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_PREFERENCES;
  const object = value as Record<string, unknown>;
  return {
    fontSize: Number.isInteger(object.fontSize) && Number(object.fontSize) >= 13 && Number(object.fontSize) <= 20 ? Number(object.fontSize) : DEFAULT_PREFERENCES.fontSize,
    lineWrap: typeof object.lineWrap === "boolean" ? object.lineWrap : DEFAULT_PREFERENCES.lineWrap,
  };
}

function copyName(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? `${name.slice(0, index)} copy${name.slice(index)}` : `${name} copy`;
}

function dataUrl(data: ArrayBuffer, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not encode a project image.")), { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not encode a project image.")), { once: true });
    reader.readAsDataURL(new Blob([data], { type: mimeType }));
  });
}

export { APP_ID };
