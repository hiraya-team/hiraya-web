import { expect, test } from "bun:test";
import { addTask, clearCompleted, createTodoDocument, deleteTask, editTask, hasTodoChanges, parseTodoText, serializeTodo } from "./todo";

test("parses and serializes strict schema version 1 documents", () => {
  const document = parseTodoText('{"schemaVersion":1,"tasks":[{"id":"task-1","title":"Ship Todo","completed":false,"priority":"high","dueDate":"2026-08-07"}]}');
  expect(parseTodoText(serializeTodo(document))).toEqual(document);
  expect(() => parseTodoText('{"schemaVersion":2,"tasks":[]}')).toThrow("unsupported schema version");
  expect(() => parseTodoText('{"schemaVersion":1,"tasks":[],"extra":true}')).toThrow("missing or unsupported fields");
  expect(() => parseTodoText('{"schemaVersion":1,"tasks":[{"id":"a","title":"Bad date","completed":false,"priority":"normal","dueDate":"2026-02-30"}]}')).toThrow("real calendar date");
});

test("adds, edits, completes, deletes, and clears tasks immutably", () => {
  const empty = createTodoDocument();
  const added = addTask(empty, { title: "  Write tests  ", priority: "normal" }, "task-1");
  const second = addTask(added, { title: "Package app", priority: "high", dueDate: "2026-08-08" }, "task-2");
  const completed = editTask(second, "task-1", { completed: true, title: "Write focused tests", dueDate: "2026-08-07" });
  expect(empty.tasks).toHaveLength(0);
  expect(completed.tasks[0]).toMatchObject({ title: "Write focused tests", completed: true, dueDate: "2026-08-07" });
  expect(clearCompleted(completed).tasks.map(({ id }) => id)).toEqual(["task-2"]);
  expect(deleteTask(second, "task-2").tasks.map(({ id }) => id)).toEqual(["task-1"]);
  expect(hasTodoChanges(second, added)).toBe(true);
  expect(hasTodoChanges(second, second)).toBe(false);
});
