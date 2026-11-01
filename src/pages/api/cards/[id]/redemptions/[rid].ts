import type { APIRoute } from "astro";
import { toPublicCard, todayYmd } from "../../../../../lib/cards";
import { undoRedemption } from "../../../../../lib/redemptions";
import { apiContext, toErrorResponse } from "../../../_session";

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const card = await undoRedemption(db, user.id, params.id ?? "", params.rid ?? "", unlocked);
    return Response.json({ card: toPublicCard(card, todayYmd()) });
  } catch (error) {
    return toErrorResponse(error);
  }
};
