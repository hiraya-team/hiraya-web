import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarBlank, CheckCircle, FilePlus, FloppyDisk, FolderOpen, ListChecks, PencilSimple, Plus, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { HirayaSdkError, type AppCapabilities, type FileHandle, type HirayaClient, type LaunchContext } from "@hiraya/apps-sdk";
import { TODO_EXTENSION, TODO_MIME_TYPE, addTask, clearCompleted, createTodoDocument, deleteTask, editTask, hasTodoChanges, parseTodoText, serializeTodo, type Priority, type TodoDocument } from "./todo";

export const APP_ID = "dev.hiraya.todo";

type Filter = "all" | "active" | "completed";
type Status = Readonly<{ message: string; danger?: boolean }>;
type Snapshot = Readonly<{ document: TodoDocument; revision: number; name: string }>;
type Session = Readonly<{
  handle: FileHandle | null;
  name: string;
  revision: number | null;
  persisted: TodoDocument;
  draft: TodoDocument;
  remote?: Snapshot;
}>;

const EMPTY = createTodoDocument();
const MAX_TODO_BYTES = 8 * 1024 * 1024;

export function App({ hiraya, launch }: Readonly<{ hiraya: HirayaClient; launch: LaunchContext }>) {
  const [session, setSession] = useState<Session>({ handle: null, name: `Untitled${TODO_EXTENSION}`, revision: null, persisted: EMPTY, draft: EMPTY });
  const [capabilities, setCapabilities] = useState<AppCapabilities>({ files: { write: false, writeReason: "temporarily-unavailable" }, externalEmbeddedPreviews: false });
  const [status, setStatus] = useState<Status>({ message: "Starting a new list..." });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [editingId, setEditingId] = useState<string | null>(null);
  const sessionRef = useRef(session);
  const busyRef = useRef(busy);
  const startRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const commandRef = useRef<(id: string) => void>(() => undefined);
  const reconcileRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const pendingReconcile = useRef(false);
  const started = useRef(false);
  sessionRef.current = session;
  busyRef.current = busy;
  startRef.current = start;
  reconcileRef.current = reconcile;

  const documentDirty = hasTodoChanges(session.draft, session.persisted);
  const formDirty = editingId !== null || title !== "" || dueDate !== "" || priority !== "normal";
  const dirty = session.handle === null || documentDirty || formDirty;
  const saveable = session.handle === null || documentDirty;
  const canWrite = capabilities.files.write && !busy;
  const activeCount = session.draft.tasks.filter((task) => !task.completed).length;
  const completedCount = session.draft.tasks.length - activeCount;
  const visibleTasks = session.draft.tasks.filter((task) => filter === "all" || (filter === "active" ? !task.completed : task.completed));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startRef.current();
  }, []);

  useEffect(() => {
    const unsubscribeCapabilities = hiraya.on("capabilities.changed", (next) => {
      setCapabilities(next);
      if (!next.files.write) setStatus({ message: writeRestriction(next.files.writeReason, dirty), danger: dirty });
    });
    const unsubscribeFiles = hiraya.on("files.changed", ({ handles }) => {
      const current = sessionRef.current;
      if (!current.handle || !handles.includes(current.handle)) return;
      if (busyRef.current) pendingReconcile.current = true;
      else void reconcileRef.current();
    });
    const unsubscribeCommands = hiraya.on("commands.invoked", ({ id }) => commandRef.current(id));
    return () => { unsubscribeCapabilities(); unsubscribeFiles(); unsubscribeCommands(); };
  }, [dirty, hiraya]);

  useEffect(() => {
    if (busy || !pendingReconcile.current) return;
    pendingReconcile.current = false;
    void reconcileRef.current();
  }, [busy]);

  useEffect(() => {
    void hiraya.window.setDirty(dirty);
    void hiraya.window.setTitle(`${dirty ? "*" : ""}${session.name} - Todo`);
  }, [dirty, hiraya, session.name]);

  useEffect(() => {
    void hiraya.commands.set([
      { id: "new", title: "New Todo list", shortcut: "Ctrl+N", enabled: !busy },
      { id: "open", title: "Open Todo list", shortcut: "Ctrl+O", enabled: !busy },
      { id: "save", title: "Save Todo list", shortcut: "Ctrl+S", enabled: saveable && capabilities.files.write && !busy },
      { id: "save-as", title: "Save Todo list as", shortcut: "Ctrl+Shift+S", enabled: capabilities.files.write && !busy },
    ]).catch(() => undefined);
  }, [busy, capabilities.files.write, hiraya, saveable]);

  useEffect(() => {
    commandRef.current = (id) => {
      if (id === "new") void newList();
      if (id === "open") void openList();
      if (id === "save") void save();
      if (id === "save-as") void saveAs();
    };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") { event.preventDefault(); void (event.shiftKey ? saveAs() : save()); }
      if (event.key.toLowerCase() === "o") { event.preventDefault(); void openList(); }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); void newList(); }
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  });

  async function start() {
    try {
      setCapabilities(await hiraya.app.getCapabilities());
      if (launch.files[0]) await load(launch.files[0]);
      else setStatus({ message: "New unsaved list. Add a task to begin." });
    } catch (error) {
      report(error, "Todo could not finish starting.");
    }
  }

  async function readSnapshot(handle: FileHandle): Promise<Snapshot> {
    const before = await hiraya.files.stat(handle, { timeoutMs: 120_000 });
    if (before.kind !== "file") throw new Error("The selected item is not a Todo file.");
    if (before.metadata.size > MAX_TODO_BYTES) throw new Error("Todo files must be 8 MiB or smaller.");
    const { data } = await hiraya.files.readAll(handle, { timeoutMs: 120_000 });
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { throw new Error("This Todo file is not valid UTF-8 text."); }
    const document = parseTodoText(text);
    const after = await hiraya.files.stat(handle, { timeoutMs: 120_000 });
    if (after.kind !== "file" || before.metadata.contentRevision !== after.metadata.contentRevision || before.metadata.size !== after.metadata.size) throw new HirayaSdkError("The Todo file changed while it was being read.", "CONFLICT");
    return { document, revision: after.metadata.contentRevision, name: after.metadata.name };
  }

  async function load(handle: FileHandle) {
    setBusy(true);
    setStatus({ message: "Opening Todo list..." });
    try {
      const snapshot = await readSnapshot(handle);
      setSession({ handle, name: snapshot.name, revision: snapshot.revision, persisted: snapshot.document, draft: snapshot.document });
      resetForm();
      setStatus({ message: `Opened ${snapshot.name}.` });
    } catch (error) {
      report(error, "The Todo list could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDiscard(action: string): Promise<boolean> {
    if (!dirty) return true;
    return hiraya.dialogs.confirm({ title: "Discard unsaved changes?", message: `${action} will discard changes to ${session.name}.`, confirmLabel: "Discard changes", destructive: true });
  }

  async function newList() {
    if (busyRef.current || !await confirmDiscard("Creating a new list")) return;
    const document = createTodoDocument();
    setSession({ handle: null, name: `Untitled${TODO_EXTENSION}`, revision: null, persisted: document, draft: document });
    resetForm();
    setFilter("all");
    setStatus({ message: "New unsaved list. Add a task to begin." });
  }

  async function openList() {
    if (busyRef.current || !await confirmDiscard("Opening another list")) return;
    try {
      const handles = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: [TODO_EXTENSION, TODO_MIME_TYPE] });
      if (handles?.[0]) await load(handles[0]);
    } catch (error) {
      report(error, "The Todo list could not be selected.");
    }
  }

  async function save() {
    const current = sessionRef.current;
    if (!capabilities.files.write || busyRef.current || !saveable) return;
    if (!current.handle || current.revision === null) { await saveAs(); return; }
    setBusy(true);
    setStatus({ message: `Saving ${current.name}...` });
    try {
      const source = current.draft;
      const saved = await hiraya.files.writeAll(current.handle, exactBuffer(new TextEncoder().encode(serializeTodo(source))), { mimeType: TODO_MIME_TYPE, expectedRevision: current.revision, timeoutMs: 120_000 });
      setSession({ ...current, revision: saved.contentRevision, persisted: source, draft: source, remote: undefined });
      setStatus({ message: `Saved ${current.name} locally.` });
    } catch (error) {
      if (error instanceof HirayaSdkError && error.code === "CONFLICT") await preserveConflict(current, "The file changed elsewhere. Your draft is preserved.");
      else report(error, `Could not save ${current.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function saveAs() {
    const current = sessionRef.current;
    if (!capabilities.files.write || busyRef.current) return;
    setBusy(true);
    try {
      const handle = await hiraya.dialogs.saveFile({ suggestedName: ensureName(current.name), mimeType: TODO_MIME_TYPE }, { timeoutMs: 120_000 });
      if (!handle) return;
      const entry = await hiraya.files.stat(handle, { timeoutMs: 120_000 });
      if (entry.kind !== "file") throw new Error("Hiraya did not create a Todo file.");
      const source = current.draft;
      const saved = await hiraya.files.writeAll(handle, exactBuffer(new TextEncoder().encode(serializeTodo(source))), { mimeType: TODO_MIME_TYPE, expectedRevision: entry.metadata.contentRevision, timeoutMs: 120_000 });
      setSession({ handle, name: saved.name, revision: saved.contentRevision, persisted: source, draft: source });
      setStatus({ message: `Saved ${saved.name} locally.` });
    } catch (error) {
      report(error, "The Todo list could not be saved as a new file.");
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    const current = sessionRef.current;
    if (!current.handle || busyRef.current) return;
    try {
      const remote = await readSnapshot(current.handle);
      const latest = sessionRef.current;
      if (latest.handle !== current.handle || latest.revision !== null && remote.revision <= latest.revision) return;
      if (hasTodoChanges(latest.draft, latest.persisted)) {
        setSession({ ...latest, remote });
        setStatus({ message: "The file changed elsewhere. Your draft is preserved.", danger: true });
      } else {
        setSession({ handle: latest.handle, name: remote.name, revision: remote.revision, persisted: remote.document, draft: remote.document });
        setStatus({ message: `Reloaded ${remote.name} after an external change.` });
      }
    } catch (error) {
      report(error, "The changed Todo file could not be reconciled. Your current list is preserved.");
    }
  }

  async function preserveConflict(current: Session, message: string) {
    if (!current.handle) return;
    try {
      const remote = await readSnapshot(current.handle);
      setSession({ ...current, remote });
      setStatus({ message, danger: true });
    } catch (error) {
      report(error, `${message} The remote version could not be read.`);
    }
  }

  async function acceptRemote() {
    const current = sessionRef.current;
    if (!current.remote || !await hiraya.dialogs.confirm({ title: "Use the remote version?", message: "Your preserved draft will be discarded and replaced with the remote Todo list.", confirmLabel: "Use remote", destructive: true })) return;
    const remote = current.remote;
    setSession({ handle: current.handle, name: remote.name, revision: remote.revision, persisted: remote.document, draft: remote.document });
    resetForm();
    setStatus({ message: "Loaded the remote Todo list." });
  }

  async function saveCopy() {
    const current = sessionRef.current;
    if (!current.remote || !capabilities.files.write || busyRef.current) return;
    setBusy(true);
    try {
      const handle = await hiraya.dialogs.saveFile({ suggestedName: copyName(current.name), mimeType: TODO_MIME_TYPE }, { timeoutMs: 120_000 });
      if (!handle) return;
      const entry = await hiraya.files.stat(handle, { timeoutMs: 120_000 });
      if (entry.kind !== "file") throw new Error("Hiraya did not create a Todo file.");
      await hiraya.files.writeAll(handle, exactBuffer(new TextEncoder().encode(serializeTodo(current.draft))), { mimeType: TODO_MIME_TYPE, expectedRevision: entry.metadata.contentRevision, timeoutMs: 120_000 });
      setStatus({ message: "Saved a copy. The original conflict is still waiting for a choice." });
    } catch (error) {
      report(error, "The preserved draft could not be saved as a copy.");
    } finally {
      setBusy(false);
    }
  }

  async function replaceRemote() {
    const current = sessionRef.current;
    if (!current.handle || !current.remote || !capabilities.files.write || busyRef.current) return;
    if (!await hiraya.dialogs.confirm({ title: "Replace the remote version?", message: `Overwrite the remote ${current.name} with your preserved draft?`, confirmLabel: "Replace remote", destructive: true })) return;
    setBusy(true);
    try {
      const source = current.draft;
      const saved = await hiraya.files.writeAll(current.handle, exactBuffer(new TextEncoder().encode(serializeTodo(source))), { mimeType: TODO_MIME_TYPE, expectedRevision: current.remote.revision, timeoutMs: 120_000 });
      setSession({ ...current, name: saved.name, revision: saved.contentRevision, persisted: source, draft: source, remote: undefined });
      setStatus({ message: `Replaced the remote ${saved.name}.` });
    } catch (error) {
      if (error instanceof HirayaSdkError && error.code === "CONFLICT") await preserveConflict(current, "The remote file changed again. Your draft is still preserved.");
      else report(error, "The remote Todo list could not be replaced.");
    } finally {
      setBusy(false);
    }
  }

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) return;
    try {
      const draft = editingId
        ? editTask(session.draft, editingId, { title, dueDate: dueDate || null, priority })
        : addTask(session.draft, { title, dueDate: dueDate || undefined, priority });
      setSession({ ...session, draft });
      setStatus({ message: editingId ? "Task updated. Save the list to keep this change." : "Task added. Save the list to keep this change." });
      resetForm();
    } catch (error) {
      report(error, "The task could not be saved.");
    }
  }

  function beginEdit(id: string) {
    const task = session.draft.tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    setEditingId(id);
    setTitle(task.title);
    setDueDate(task.dueDate ?? "");
    setPriority(task.priority);
  }

  function updateTask(id: string, changes: Parameters<typeof editTask>[2], message: string) {
    if (!canWrite) return;
    try {
      setSession({ ...session, draft: editTask(session.draft, id, changes) });
      setStatus({ message });
    } catch (error) {
      report(error, "The task could not be updated.");
    }
  }

  async function removeCompleted() {
    if (!canWrite || completedCount === 0 || !await hiraya.dialogs.confirm({ title: "Clear completed tasks?", message: `Delete ${completedCount} completed task${completedCount === 1 ? "" : "s"} from this list?`, confirmLabel: "Clear completed", destructive: true })) return;
    setSession({ ...session, draft: clearCompleted(session.draft) });
    if (editingId && session.draft.tasks.find((task) => task.id === editingId)?.completed) resetForm();
    setStatus({ message: "Completed tasks cleared. Save the list to keep this change." });
  }

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setDueDate("");
    setPriority("normal");
  }

  function report(error: unknown, fallback: string) {
    const message = describeError(error, fallback);
    if (message) setStatus({ message, danger: true });
  }

  return (
    <main className="todo-shell">
      <hiraya-toolbar label="Todo file controls" wrap>
        <div className="app-title"><ListChecks weight="duotone" aria-hidden="true" /><span><strong>Todo</strong><small>{session.name}</small></span></div>
        <div className="file-state">{session.remote ? <hiraya-badge tone="danger">Conflict</hiraya-badge> : dirty ? <hiraya-badge tone="accent">Unsaved</hiraya-badge> : <hiraya-badge>Saved</hiraya-badge>}{!capabilities.files.write && <hiraya-badge tone="readonly">Read only</hiraya-badge>}</div>
        <hiraya-button slot="actions" variant="quiet" onClick={() => void newList()} disabled={busy}><FilePlus slot="icon-start" />New</hiraya-button>
        <hiraya-button slot="actions" variant="quiet" onClick={() => void openList()} disabled={busy}><FolderOpen slot="icon-start" />Open</hiraya-button>
        <hiraya-button slot="actions" onClick={() => void saveAs()} disabled={!capabilities.files.write || busy}>Save As</hiraya-button>
        <hiraya-button slot="actions" variant="primary" onClick={() => void save()} disabled={!capabilities.files.write || !saveable || busy} loading={busy}><FloppyDisk slot="icon-start" />Save</hiraya-button>
      </hiraya-toolbar>

      <div className="todo-workspace">
        {session.remote && (
          <hiraya-notice tone="danger" live="assertive">
            <WarningCircle slot="icon" weight="fill" aria-hidden="true" />
            <strong slot="title">Another version exists</strong>
            <p>Your unsaved draft is preserved. Choose which version should continue.</p>
            <div slot="actions" className="conflict-actions">
              <hiraya-button onClick={() => void acceptRemote()}>Use remote</hiraya-button>
              <hiraya-button onClick={() => void saveCopy()} disabled={!capabilities.files.write || busy}>Save copy</hiraya-button>
              <hiraya-button variant="danger" onClick={() => void replaceRemote()} disabled={!capabilities.files.write || busy}>Replace remote</hiraya-button>
            </div>
          </hiraya-notice>
        )}

        <hiraya-panel className="composer">
          <div slot="header" className="panel-heading"><div><strong>{editingId ? "Edit task" : "Add a task"}</strong><span>{editingId ? "Update the selected task without changing its completion state." : "Capture the work, then save the list when ready."}</span></div>{editingId && <hiraya-button variant="quiet" onClick={resetForm}><X slot="icon-start" />Cancel edit</hiraya-button>}</div>
          <form className="task-form" onSubmit={submitTask}>
            <label className="title-field">Task title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="What needs to be done?" autoComplete="off" disabled={!canWrite} required /></label>
            <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={!canWrite} /></label>
            <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as Priority)} disabled={!canWrite}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
            <button className="submit-task" type="submit" disabled={!canWrite || !title.trim()}><Plus aria-hidden="true" />{editingId ? "Update task" : "Add task"}</button>
          </form>
        </hiraya-panel>

        <hiraya-panel className="task-ledger">
          <div slot="header" className="ledger-heading">
            <div><strong>{activeCount} active</strong><span>{completedCount} completed</span></div>
            <div className="filters" role="group" aria-label="Filter tasks">
              {(["all", "active", "completed"] as const).map((value) => <button type="button" className={filter === value ? "filter-active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}
            </div>
          </div>
          {visibleTasks.length === 0 ? (
            <hiraya-empty-state>
              <CheckCircle slot="icon" size={34} weight="duotone" aria-hidden="true" />
              <strong slot="title">{session.draft.tasks.length === 0 ? "No tasks yet" : `No ${filter} tasks`}</strong>
              <span>{session.draft.tasks.length === 0 ? "Use the form above to add the first task." : "Choose another filter to see the rest of this list."}</span>
            </hiraya-empty-state>
          ) : (
            <ul className="task-list">
              {visibleTasks.map((task) => (
                <li className={task.completed ? "task-completed" : ""} key={task.id}>
                  <label className="task-check"><input type="checkbox" checked={task.completed} onChange={(event) => updateTask(task.id, { completed: event.target.checked }, event.target.checked ? "Task completed. Save the list to keep this change." : "Task restored. Save the list to keep this change.")} disabled={!canWrite} /><span className="hiraya-sr-only">Mark {task.title} {task.completed ? "active" : "completed"}</span></label>
                  <div className="task-copy"><strong>{task.title}</strong><div className="task-meta"><span className={`priority priority-${task.priority}`}>{task.priority} priority</span>{task.dueDate && <span className={isOverdue(task.dueDate, task.completed) ? "overdue" : ""}><CalendarBlank aria-hidden="true" />Due {formatDate(task.dueDate)}</span>}</div></div>
                  <div className="task-actions"><hiraya-button variant="quiet" aria-label={`Edit ${task.title}`} title={`Edit ${task.title}`} onClick={() => beginEdit(task.id)} disabled={!canWrite}><PencilSimple slot="icon-start" /><span className="action-label">Edit</span></hiraya-button><hiraya-button variant="quiet" aria-label={`Delete ${task.title}`} title={`Delete ${task.title}`} onClick={() => { setSession({ ...session, draft: deleteTask(session.draft, task.id) }); if (editingId === task.id) resetForm(); setStatus({ message: "Task deleted. Save the list to keep this change." }); }} disabled={!canWrite}><Trash slot="icon-start" /><span className="action-label">Delete</span></hiraya-button></div>
                </li>
              ))}
            </ul>
          )}
          <div slot="footer" className="ledger-footer"><span>{session.draft.tasks.length} task{session.draft.tasks.length === 1 ? "" : "s"} in this file</span><hiraya-button variant="quiet" onClick={() => void removeCompleted()} disabled={!canWrite || completedCount === 0}><Trash slot="icon-start" />Clear completed</hiraya-button></div>
        </hiraya-panel>
      </div>

      <hiraya-status-bar tone={status.danger ? "danger" : dirty ? "accent" : "neutral"} live={status.danger ? "assertive" : "polite"}>{status.danger ? <WarningCircle aria-hidden="true" /> : dirty ? <PencilSimple aria-hidden="true" /> : <CheckCircle aria-hidden="true" />}<span>{status.message}</span></hiraya-status-bar>
    </main>
  );
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof HirayaSdkError) {
    if (error.code === "CANCELLED") return "";
    if (error.code === "OFFLINE") return "This Todo file is not available offline. Reconnect or download it through Hiraya, then try again.";
    if (error.code === "PERMISSION_DENIED") return "Todo no longer has permission to perform that action.";
    if (error.code === "CONFLICT") return "The Todo file changed elsewhere. Your draft is preserved.";
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : fallback;
}

function writeRestriction(reason: AppCapabilities["files"]["writeReason"], dirty: boolean): string {
  const explanation = reason === "read-only" ? "This Todo list is read-only." : reason === "shared-offline" ? "Reconnect to edit this shared Todo list." : "Writing is temporarily unavailable.";
  return dirty ? `Unsaved draft preserved. ${explanation}` : explanation;
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function ensureName(name: string): string {
  return name.toLocaleLowerCase().endsWith(TODO_EXTENSION) ? name : `${name.replace(/\.[^.]+$/, "")}${TODO_EXTENSION}`;
}

function copyName(name: string): string {
  const safe = ensureName(name);
  return `${safe.slice(0, -TODO_EXTENSION.length)} copy${TODO_EXTENSION}`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function isOverdue(value: string, completed: boolean): boolean {
  if (completed) return false;
  const today = new Date();
  const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return value < local;
}
