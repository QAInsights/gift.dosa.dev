import type { APIRoute } from "astro";
import { toPublicCard, todayYmd } from "../../../../lib/cards";
import { recordRedemption } from "../../../../lib/redemptions";
import { apiContext, readJson, toErrorResponse } from "../../_session";

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const body = await readJson(request);
    const { card, redemption } = await recordRedemption(db, user.id, params.id ?? "", unlocked, {
      mode: body.mode,
      amount: body.amount,
    });
    return Response.json({
      card: toPublicCard(card, todayYmd()),
      redemption: { id: redemption.id, before_cents: redemption.before_cents, after_cents: redemption.after_cents },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};
