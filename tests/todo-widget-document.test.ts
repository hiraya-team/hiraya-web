import { expect, test } from "bun:test";
import { activeTodoItems, parseTodoText, serializeTodo, setTodoCompleted } from "../src/features/widgets/todo-document";

test("reads legacy and current Todo files and updates one task without losing fields", () => {
  const legacy = parseTodoText(JSON.stringify({ schemaVersion: 1, tasks: [{ id: "one", title: "First", completed: false, priority: "normal", dueDate: "2026-08-10" }] }));
  expect(legacy).toMatchObject({ schemaVersion: 2, tasks: [{ id: "one", subitems: [] }] });

  const current = parseTodoText(JSON.stringify({ schemaVersion: 2, tasks: [{ id: "one", title: "First", completed: false, priority: "high", description: "Context", subitems: [{ id: "sub", title: "Subtask", completed: false, priority: "low" }] }] }));
  const changed = setTodoCompleted(current, "sub", true);
  expect(changed.tasks[0].subitems[0].completed).toBe(true);
  expect(changed.tasks[0].description).toBe("Context");
  expect(parseTodoText(serializeTodo(changed))).toEqual(changed);
  const parentCompleted = setTodoCompleted(current, "one", true);
  expect(activeTodoItems(parentCompleted).map(({ item }) => item.id)).toEqual(["one", "sub"]);
});

test("rejects malformed Todo data before rendering it", () => {
  expect(() => parseTodoText("{")).toThrow("valid JSON");
  expect(() => parseTodoText(JSON.stringify({ schemaVersion: 2, tasks: [{ id: "same", title: "One", completed: false, priority: "normal", subitems: [{ id: "same", title: "Two", completed: false, priority: "normal" }] }] }))).toThrow("unique");
  expect(() => parseTodoText(JSON.stringify({ schemaVersion: 2, tasks: [{ id: "one", title: "One", completed: false, priority: "urgent", subitems: [] }] }))).toThrow("priority");
});
