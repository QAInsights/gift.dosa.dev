import { describe, expect, it } from "vitest";
import { FakeDb, expectAuthError } from "./fake-db";
import { addTodo, editTodo, listUserTodos, normalizeTodoText, removeTodo, setTodoDone } from "./todos";

const NOW = 1_790_000_000_000;
const USER = "u-todo";

describe("normalizeTodoText", () => {
  it("trims, collapses, and bounds the note", async () => {
    expect(normalizeTodoText("  buy   stamps ")).toBe("buy stamps");
    await expectAuthError((async () => normalizeTodoText("   "))(), 400);
    await expectAuthError((async () => normalizeTodoText("x".repeat(201)))(), 400);
    await expectAuthError((async () => normalizeTodoText(7))(), 400);
  });
});

describe("todos", () => {
  it("adds, orders open-first newest-first, toggles, edits, and deletes", async () => {
    const db = new FakeDb();
    const first = await addTodo(db, USER, "First note", NOW);
    const second = await addTodo(db, USER, "Second note", NOW + 1000);
    await setTodoDone(db, USER, first.id, true, NOW + 2000);
    const list = await listUserTodos(db, USER);
    expect(list.map((t) => t.text)).toEqual(["Second note", "First note"]);
    expect(list[1].done).toBe(1);
    const edited = await editTodo(db, USER, second.id, "Second note, updated", NOW + 3000);
    expect(edited.text).toBe("Second note, updated");
    await removeTodo(db, USER, first.id);
    await expect(listUserTodos(db, USER)).resolves.toHaveLength(1);
  });

  it("keeps notes per user and 404s across accounts", async () => {
    const db = new FakeDb();
    const mine = await addTodo(db, USER, "Mine", NOW);
    await expect(listUserTodos(db, "someone-else")).resolves.toEqual([]);
    await expectAuthError(setTodoDone(db, "someone-else", mine.id, true), 404);
    await expectAuthError(removeTodo(db, "someone-else", mine.id), 404);
    await expectAuthError(editTodo(db, USER, "missing", "Nope"), 404);
  });
});
