import type { APIRoute } from "astro";
import { updateSessionUnlocked } from "../../../../lib/db";
import { publicDrawer, relockDrawer, removeLock, setLock } from "../../../../lib/drawers";
import { apiContext, readJson, toErrorResponse } from "../../_session";

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked, tokenHash } = await apiContext(request);
    const body = await readJson(request);
    const id = params.id ?? "";
    const drawer = await setLock(db, user.id, id, body.password, body.current);
    const next = unlocked.includes(id) ? unlocked : [...unlocked, id];
    await updateSessionUnlocked(db, tokenHash, JSON.stringify(next));
    return Response.json({ drawer: await publicDrawer(db, user.id, drawer, next) });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked, tokenHash } = await apiContext(request);
    const body = await readJson(request);
    const id = params.id ?? "";
    const drawer = await removeLock(db, user.id, id, body.password);
    const next = relockDrawer(id, unlocked);
    await updateSessionUnlocked(db, tokenHash, JSON.stringify(next));
    return Response.json({ drawer: await publicDrawer(db, user.id, drawer, next) });
  } catch (error) {
    return toErrorResponse(error);
  }
};
