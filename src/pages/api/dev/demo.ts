import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { readVaultKey } from "../../../lib/crypto";
import { DEMO_DRAWER_PASSWORD, seedDemoCabinet } from "../../../lib/demo";
import { apiContext, toErrorResponse } from "../_session";

export const POST: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV) return Response.json({ error: "Not found." }, { status: 404 });
  try {
    const { db, user } = await apiContext(request);
    await seedDemoCabinet(db, user.id, Date.now(), readVaultKey(env));
    return Response.json({ ok: true, email: user.email, drawerPassword: DEMO_DRAWER_PASSWORD });
  } catch (error) {
    return toErrorResponse(error);
  }
};
