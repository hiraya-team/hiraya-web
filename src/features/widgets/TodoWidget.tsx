import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CheckCircle, CheckSquare, WarningCircle } from "@phosphor-icons/react";
import type { FileEntry } from "../../types";
import { useStableHandler } from "../../ui/use-stable-handler";
import { activeTodoItems, parseTodoText, serializeTodo, setTodoCompleted, type TodoDocument, type TodoItem } from "./todo-document";

type Props = {
  file: FileEntry | null;
  contentRevision: number;
  readOnly: boolean;
  readContent: (file: FileEntry) => Promise<Blob>;
  writeContent?: (file: FileEntry, content: Blob, expectedRevision: number) => Promise<unknown>;
  onOpen: (file: FileEntry) => void;
};

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; document: TodoDocument };

/** Renders and persists the interactive Todo desktop widget. */
export function TodoWidget({ file, contentRevision, readOnly, readContent, writeContent, onOpen }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [savingId, setSavingId] = useState("");
  const loadGeneration = useRef(0);
  const load = useStableHandler(async () => {
    const generation = ++loadGeneration.current;
    if (!file) {
      setState({ status: "error", message: "The linked Todo file is no longer available." });
      return;
    }
    setState({ status: "loading" });
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("This Todo file is too large to show here.");
      const document = parseTodoText(await (await readContent(file)).text());
      if (loadGeneration.current === generation) setState({ status: "ready", document });
    } catch (reason) {
      if (loadGeneration.current === generation) setState({ status: "error", message: reason instanceof Error ? reason.message : "The Todo list could not be loaded." });
    }
  });

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [contentRevision, file?.id, load]);

  async function toggle(item: TodoItem, completed: boolean) {
    if (!file || !writeContent || state.status !== "ready") return;
    const previous = state.document;
    const next = setTodoCompleted(previous, item.id, completed);
    setSavingId(item.id);
    setState({ status: "ready", document: next });
    try {
      await writeContent(file, new Blob([serializeTodo(next)], { type: file.mimeType }), contentRevision);
    } catch (reason) {
      setState({ status: "error", message: reason instanceof Error ? reason.message : "The task could not be updated." });
    } finally {
      setSavingId("");
    }
  }

  const items = state.status === "ready" ? activeTodoItems(state.document) : [];
  const total = state.status === "ready" ? state.document.tasks.reduce((count, task) => count + 1 + task.subitems.length, 0) : 0;
  const completed = state.status === "ready" ? state.document.tasks.reduce((count, task) => count + Number(task.completed) + task.subitems.filter((item) => item.completed).length, 0) : 0;

  return <section className="todo-widget" aria-label={file?.name ?? "Todo list"}>
    <header className="todo-widget__header">
      <CheckSquare size={19} weight="duotone" aria-hidden="true" />
      <span><strong>{file?.name ?? "Todo list"}</strong>{state.status === "ready" && <small>{completed} of {total} complete</small>}</span>
      {file && <button type="button" aria-label={`Open ${file.name} in Todo`} title="Open in Todo" onClick={() => onOpen(file)}><ArrowSquareOut size={17} /></button>}
    </header>
    <div className="todo-widget__list" aria-live="polite">
      {state.status === "loading" && <p className="todo-widget__state">Loading tasks...</p>}
      {state.status === "error" && <p className="todo-widget__state todo-widget__state--error"><WarningCircle size={18} />{state.message}</p>}
      {state.status === "ready" && total === 0 && <p className="todo-widget__state">This list has no tasks yet.</p>}
      {state.status === "ready" && total > 0 && items.length === 0 && <p className="todo-widget__state"><CheckCircle size={18} />All tasks complete.</p>}
      {items.map(({ item, nested }) => <label className="todo-widget__task" data-nested={nested || undefined} key={item.id}>
        <input type="checkbox" checked={item.completed} disabled={readOnly || Boolean(savingId)} onChange={(event) => void toggle(item, event.target.checked)} />
        <span><strong>{item.title}</strong>{(item.dueDate || item.priority !== "normal") && <small>{item.priority !== "normal" ? `${item.priority} priority` : ""}{item.dueDate ? `${item.priority !== "normal" ? " · " : ""}Due ${item.dueDate}` : ""}</small>}</span>
      </label>)}
    </div>
  </section>;
}
