import type { APIRoute } from "astro";
import { dashboard, todayYmd } from "../../lib/cards";
import { apiContext, toErrorResponse } from "./_session";

export const GET: APIRoute = async ({ request }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    return Response.json(await dashboard(db, user.id, unlocked, todayYmd()));
  } catch (error) {
    return toErrorResponse(error);
  }
};
