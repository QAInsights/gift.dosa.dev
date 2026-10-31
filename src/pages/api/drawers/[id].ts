import type { APIRoute } from "astro";
import { publicDrawer, removeDrawer, renameDrawer, setDrawerEmoji } from "../../../lib/drawers";
import { findDrawer } from "../../../lib/db";
import { apiContext, readJson, toErrorResponse } from "../_session";

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const body = await readJson(request);
    const id = params.id ?? "";
    if (body.emoji !== undefined) await setDrawerEmoji(db, user.id, id, body.emoji, Date.now());
    if (body.name !== undefined) await renameDrawer(db, user.id, id, body.name, Date.now(), unlocked);
    const drawer = await findDrawer(db, id, user.id);
    if (!drawer) return Response.json({ error: "That drawer is not on file." }, { status: 404 });
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
