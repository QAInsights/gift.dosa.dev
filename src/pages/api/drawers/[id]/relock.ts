import type { APIRoute } from "astro";
import { updateSessionUnlocked } from "../../../../lib/db";
import { relockDrawer } from "../../../../lib/drawers";
import { apiContext, toErrorResponse } from "../../_session";

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const { db, unlocked, tokenHash } = await apiContext(request);
    const next = relockDrawer(params.id ?? "", unlocked);
    await updateSessionUnlocked(db, tokenHash, JSON.stringify(next));
    return Response.json({ ok: true, unlocked: next });
  } catch (error) {
    return toErrorResponse(error);
  }
};
