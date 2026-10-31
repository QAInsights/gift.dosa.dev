import type { APIRoute } from "astro";
import { getPrefs, updateProfile } from "../../lib/prefs";
import { apiContext, readJson, toErrorResponse } from "./_session";

export const GET: APIRoute = async ({ request }) => {
  try {
    const { db, user } = await apiContext(request);
    const prefs = await getPrefs(db, user.id);
    return Response.json({ user: { email: user.email, name: user.name }, prefs });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const { db, user } = await apiContext(request);
    const body = await readJson(request);
    const saved = await updateProfile(db, user.id, {
      name: body.name,
      region: body.region,
      currency: body.currency,
      date_format: body.date_format ?? body.dateFormat,
    });
    return Response.json({ user: { email: user.email, name: saved.name }, prefs: saved.prefs });
  } catch (error) {
    return toErrorResponse(error);
  }
};
