export const TODO_MIME_TYPE = "application/vnd.hiraya.todo+json";
export const TODO_EXTENSION = ".hiraya.todo";

export type Priority = "low" | "normal" | "high";

export type TodoTask = Readonly<{
  id: string;
  title: string;
  completed: boolean;
  priority: Priority;
  dueDate?: string;
}>;

export type TodoDocument = Readonly<{
  schemaVersion: 1;
  tasks: TodoTask[];
}>;

const MAX_TASKS = 10_000;

export function createTodoDocument(): TodoDocument {
  return { schemaVersion: 1, tasks: [] };
}

export function addTask(document: TodoDocument, input: Readonly<{ title: string; priority: Priority; dueDate?: string }>, id = crypto.randomUUID()): TodoDocument {
  if (document.tasks.length >= MAX_TASKS) throw new Error(`A Todo list can contain at most ${MAX_TASKS} tasks.`);
  if (document.tasks.some((task) => task.id === id)) throw new Error("Task IDs must be unique.");
  const task = parseTask({ id, title: input.title, completed: false, priority: input.priority, ...(input.dueDate ? { dueDate: input.dueDate } : {}) });
  return { ...document, tasks: [...document.tasks, task] };
}

export function editTask(document: TodoDocument, id: string, changes: Readonly<{ title?: string; completed?: boolean; priority?: Priority; dueDate?: string | null }>): TodoDocument {
  const index = document.tasks.findIndex((task) => task.id === id);
  if (index < 0) throw new Error("Task was not found.");
  const current = document.tasks[index];
  const candidate = {
    ...current,
    ...(changes.title === undefined ? {} : { title: changes.title }),
    ...(changes.completed === undefined ? {} : { completed: changes.completed }),
    ...(changes.priority === undefined ? {} : { priority: changes.priority }),
    ...(changes.dueDate === undefined ? {} : changes.dueDate === null || changes.dueDate === "" ? { dueDate: undefined } : { dueDate: changes.dueDate }),
  };
  if (candidate.dueDate === undefined) delete candidate.dueDate;
  const tasks = [...document.tasks];
  tasks[index] = parseTask(candidate);
  return { ...document, tasks };
}

export function deleteTask(document: TodoDocument, id: string): TodoDocument {
  if (!document.tasks.some((task) => task.id === id)) throw new Error("Task was not found.");
  return { ...document, tasks: document.tasks.filter((task) => task.id !== id) };
}

export function clearCompleted(document: TodoDocument): TodoDocument {
  return { ...document, tasks: document.tasks.filter((task) => !task.completed) };
}

export function parseTodoText(text: string): TodoDocument {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("This Todo file is not valid JSON."); }
  return parseTodo(value);
}

export function parseTodo(value: unknown): TodoDocument {
  const object = record(value, "Todo file");
  exact(object, ["schemaVersion", "tasks"], "Todo file");
  if (object.schemaVersion !== 1) throw new Error("This Todo file uses an unsupported schema version.");
  if (!Array.isArray(object.tasks) || object.tasks.length > MAX_TASKS) throw new Error(`Tasks must be an array with at most ${MAX_TASKS} items.`);
  const tasks = object.tasks.map(parseTask);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error("Task IDs must be unique.");
    ids.add(task.id);
  }
  return { schemaVersion: 1, tasks };
}

export function serializeTodo(document: TodoDocument): string {
  return `${JSON.stringify(parseTodo(document), null, 2)}\n`;
}

export function hasTodoChanges(draft: TodoDocument, persisted: TodoDocument): boolean {
  return serializeTodo(draft) !== serializeTodo(persisted);
}

function parseTask(value: unknown): TodoTask {
  const object = record(value, "Task");
  exact(object, ["id", "title", "completed", "priority"], "Task", ["dueDate"]);
  const id = text(object.id, "Task ID", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) throw new Error("Task ID contains unsupported characters.");
  const title = text(object.title, "Task title", 200);
  if (typeof object.completed !== "boolean") throw new Error("Task completion must be true or false.");
  if (object.priority !== "low" && object.priority !== "normal" && object.priority !== "high") throw new Error("Task priority must be low, normal, or high.");
  const dueDate = Object.hasOwn(object, "dueDate") ? date(object.dueDate) : undefined;
  return { id, title, completed: object.completed, priority: object.priority, ...(dueDate ? { dueDate } : {}) };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(object: Record<string, unknown>, required: string[], label: string, optional: string[] = []): void {
  const keys = Object.keys(object);
  if (required.some((key) => !Object.hasOwn(object, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) throw new Error(`${label} has missing or unsupported fields.`);
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
  return result;
}

function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Task due date must use YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error("Task due date is not a real calendar date.");
  return value;
}
