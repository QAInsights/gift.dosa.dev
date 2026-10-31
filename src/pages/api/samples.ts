import type { APIRoute } from "astro";
import { clearSamples } from "../../lib/cards";
import { apiContext, toErrorResponse } from "./_session";

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const { db, user } = await apiContext(request);
    const removed = await clearSamples(db, user.id);
    return Response.json({ ok: true, removed });
  } catch (error) {
    return toErrorResponse(error);
  }
};
