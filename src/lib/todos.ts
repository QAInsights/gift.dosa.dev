import { AuthError } from "./auth";
import {
  deleteTodo as deleteTodoRow,
  findTodo,
  insertTodo,
  listTodos,
  updateTodo,
  type Db,
  type TodoRow,
} from "./db";

export type Todo = TodoRow;

export function normalizeTodoText(raw: unknown): string {
  if (typeof raw !== "string") throw new AuthError(400, "Write the note first.");
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length === 0) throw new AuthError(400, "Write the note first.");
  if (text.length > 200) throw new AuthError(400, "Keep the note under 201 characters.");
  return text;
}

async function ownTodo(db: Db, userId: string, id: string): Promise<TodoRow> {
  const todo = await findTodo(db, id, userId);
  if (!todo) throw new AuthError(404, "That note is not on file.");
  return todo;
}

export async function listUserTodos(db: Db, userId: string): Promise<TodoRow[]> {
  return (await listTodos(db, userId)).results;
}

export async function addTodo(db: Db, userId: string, rawText: unknown, now = Date.now()): Promise<TodoRow> {
  const row: TodoRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    text: normalizeTodoText(rawText),
    done: 0,
    created_at: now,
    updated_at: now,
  };
  await insertTodo(db, row);
  return row;
}

export async function setTodoDone(
  db: Db,
  userId: string,
  id: string,
  rawDone: unknown,
  now = Date.now(),
): Promise<TodoRow> {
  const todo = await ownTodo(db, userId, id);
  const next: TodoRow = { ...todo, done: rawDone === true || rawDone === 1 ? 1 : 0, updated_at: now };
  await updateTodo(db, next);
  return next;
}

export async function editTodo(
  db: Db,
  userId: string,
  id: string,
  rawText: unknown,
  now = Date.now(),
): Promise<TodoRow> {
  const todo = await ownTodo(db, userId, id);
  const next: TodoRow = { ...todo, text: normalizeTodoText(rawText), updated_at: now };
  await updateTodo(db, next);
  return next;
}

export async function removeTodo(db: Db, userId: string, id: string): Promise<void> {
  await ownTodo(db, userId, id);
  await deleteTodoRow(db, id, userId);
}
