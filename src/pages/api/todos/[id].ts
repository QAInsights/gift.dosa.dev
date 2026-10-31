import type { APIRoute } from "astro";
import { editTodo, removeTodo, setTodoDone } from "../../../lib/todos";
import { apiContext, readJson, toErrorResponse } from "../_session";

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const { db, user } = await apiContext(request);
    const body = await readJson(request);
    const id = params.id ?? "";
    if (body.text !== undefined) {
      return Response.json({ todo: await editTodo(db, user.id, id, body.text) });
    }
    return Response.json({ todo: await setTodoDone(db, user.id, id, body.done) });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const { db, user } = await apiContext(request);
    await removeTodo(db, user.id, params.id ?? "");
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
};
