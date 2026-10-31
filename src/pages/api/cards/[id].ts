import type { APIRoute } from "astro";
import { deleteCard, toPublicCard, todayYmd, updateCard, visibleCard } from "../../../lib/cards";
import { apiContext, readJson, toErrorResponse } from "../_session";

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const card = await visibleCard(db, user.id, params.id ?? "", unlocked, todayYmd());
    return Response.json({ card });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const body = await readJson(request);
    const today = todayYmd();
    const card = await updateCard(db, user.id, params.id ?? "", unlocked, body, Date.now());
    return Response.json({ card: toPublicCard(card, today) });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    await deleteCard(db, user.id, params.id ?? "", unlocked);
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
};
