import type { APIRoute } from "astro";
import { addTodo, listUserTodos } from "../../lib/todos";
import { apiContext, readJson, toErrorResponse } from "./_session";

export const GET: APIRoute = async ({ request }) => {
  try {
    const { db, user } = await apiContext(request);
    return Response.json({ todos: await listUserTodos(db, user.id) });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { db, user } = await apiContext(request);
    const body = await readJson(request);
    const todo = await addTodo(db, user.id, body.text);
    return Response.json({ todo }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
};
