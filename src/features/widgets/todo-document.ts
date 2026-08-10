export const TODO_MIME_TYPE = "application/vnd.hiraya.todo+json";
export const TODO_EXTENSION = ".hiraya.todo";

export type TodoItem = {
  id: string;
  title: string;
  completed: boolean;
  priority: "low" | "normal" | "high";
  dueDate?: string;
  description?: string;
};

export type TodoTask = TodoItem & { subitems: TodoItem[] };
export type TodoDocument = { schemaVersion: 2; tasks: TodoTask[] };

const MAX_TASKS = 10_000;

export function parseTodoText(text: string): TodoDocument {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("This Todo file is not valid JSON."); }
  const root = record(value, "Todo file");
  exact(root, ["schemaVersion", "tasks"], "Todo file");
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2) throw new Error("This Todo file uses an unsupported schema version.");
  if (!Array.isArray(root.tasks)) throw new Error(`Tasks must be an array with at most ${MAX_TASKS} items.`);
  const tasks = root.schemaVersion === 1
    ? root.tasks.map((task) => ({ ...parseItem(task, "Task", false), subitems: [] }))
    : root.tasks.map((task) => parseTask(task));
  const items = tasks.flatMap((task) => [task, ...task.subitems]);
  if (items.length > MAX_TASKS) throw new Error(`Tasks must contain at most ${MAX_TASKS} items.`);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Task IDs must be unique.");
  return { schemaVersion: 2, tasks };
}

export function serializeTodo(document: TodoDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function setTodoCompleted(document: TodoDocument, id: string, completed: boolean): TodoDocument {
  return { ...document, tasks: document.tasks.map((task) => task.id === id
    ? { ...task, completed }
    : { ...task, subitems: task.subitems.map((item) => item.id === id ? { ...item, completed } : item) }) };
}

export function activeTodoItems(document: TodoDocument): { item: TodoItem; nested: boolean }[] {
  return document.tasks.flatMap((task) => {
    const subitems = task.subitems.filter((item) => !item.completed);
    return !task.completed || subitems.length ? [{ item: task, nested: false }, ...subitems.map((item) => ({ item, nested: true }))] : [];
  });
}

function parseTask(value: unknown): TodoTask {
  const object = record(value, "Task");
  exact(object, ["id", "title", "completed", "priority", "subitems"], "Task", ["dueDate", "description"]);
  if (!Array.isArray(object.subitems)) throw new Error("Task subitems must be an array.");
  return { ...parseItem(object, "Task", true), subitems: object.subitems.map((item) => parseItem(item, "Subitem", false)) };
}

function parseItem(value: unknown, label: string, hasSubitems: boolean): TodoItem {
  const object = record(value, label);
  if (!hasSubitems) exact(object, ["id", "title", "completed", "priority"], label, ["dueDate", "description"]);
  const id = text(object.id, `${label} ID`, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) throw new Error(`${label} ID contains unsupported characters.`);
  const title = text(object.title, `${label} title`, 200);
  if (typeof object.completed !== "boolean") throw new Error(`${label} completion must be true or false.`);
  if (object.priority !== "low" && object.priority !== "normal" && object.priority !== "high") throw new Error(`${label} priority must be low, normal, or high.`);
  const dueDate = Object.hasOwn(object, "dueDate") ? date(object.dueDate) : undefined;
  const description = Object.hasOwn(object, "description") ? markdown(object.description, `${label} description`, 4_000) : undefined;
  return { id, title, completed: object.completed, priority: object.priority, ...(dueDate ? { dueDate } : {}), ...(description ? { description } : {}) };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(object: Record<string, unknown>, required: string[], label: string, optional: string[] = []) {
  const keys = Object.keys(object);
  if (required.some((key) => !Object.hasOwn(object, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) throw new Error(`${label} has missing or unsupported fields.`);
}

function text(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
  return result;
}

function markdown(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
  return value;
}

function date(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Task due date must use YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error("Task due date is not a real calendar date.");
  return value;
}
