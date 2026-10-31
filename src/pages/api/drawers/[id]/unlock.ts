import type { APIRoute } from "astro";
import { updateSessionUnlocked } from "../../../../lib/db";
import { unlockDrawer } from "../../../../lib/drawers";
import { apiContext, readJson, toErrorResponse } from "../../_session";

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked, tokenHash } = await apiContext(request);
    const body = await readJson(request);
    const next = await unlockDrawer(db, user.id, params.id ?? "", body.password, unlocked);
    await updateSessionUnlocked(db, tokenHash, JSON.stringify(next));
    return Response.json({ ok: true, unlocked: next });
  } catch (error) {
    return toErrorResponse(error);
  }
};
