import type { APIRoute } from "astro";
import { publicDrawer, removeDrawer, renameDrawer } from "../../../lib/drawers";
import { apiContext, readJson, toErrorResponse } from "../_session";

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const body = await readJson(request);
    const id = params.id ?? "";
    const drawer = await renameDrawer(db, user.id, id, body.name);
    return Response.json({ drawer: await publicDrawer(db, user.id, drawer, unlocked) });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    await removeDrawer(db, user.id, params.id ?? "", unlocked);
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
};
