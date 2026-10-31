import type { APIRoute } from "astro";
import { createCard, listCabinet, toPublicCard, todayYmd } from "../../lib/cards";
import { apiContext, readJson, toErrorResponse } from "./_session";

export const GET: APIRoute = async ({ request }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const params = new URL(request.url).searchParams;
    const result = await listCabinet(
      db,
      user.id,
      unlocked,
      {
        q: params.get("q") ?? undefined,
        drawer: params.get("drawer") ?? undefined,
        state: params.get("state") ?? undefined,
        memories: params.get("memories") === "1",
        sort: params.get("sort") ?? undefined,
      },
      todayYmd(),
    );
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const body = await readJson(request);
    const card = await createCard(
      db,
      user.id,
      {
        drawer_id: body.drawer_id,
        retailer: body.retailer,
        nickname: body.nickname,
        last4: body.last4,
        balance: body.balance,
        currency: body.currency,
        expiry: body.expiry,
        occasion: body.occasion,
        tags: body.tags,
        notes: body.notes,
        reminder: body.reminder,
      },
      unlocked,
    );
    return Response.json({ card: toPublicCard(card, todayYmd()) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
};
