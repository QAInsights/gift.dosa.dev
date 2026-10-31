import type { APIRoute } from "astro";
import { createDrawer, drawersWithCounts, toPublicDrawer } from "../../lib/drawers";
import { apiContext, readJson, toErrorResponse } from "./_session";

export const GET: APIRoute = async ({ request }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const drawers = await drawersWithCounts(db, user.id, unlocked);
    return Response.json({ drawers: drawers.map((d) => toPublicDrawer(d, unlocked, d.cardCount, d.subtotals)) });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { db, user } = await apiContext(request);
    const body = await readJson(request);
    const drawer = await createDrawer(db, user.id, body.name, body.password);
    return Response.json({ drawer: toPublicDrawer(drawer, [], 0, {}) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
};
