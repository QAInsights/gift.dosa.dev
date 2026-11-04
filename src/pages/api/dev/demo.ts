import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { readVaultKey } from "../../../lib/crypto";
import { createUser, findUserByEmail, type UserRow } from "../../../lib/db";
import {
  DEMO_DRAWER_PASSWORD,
  DEMO_NAME,
  readDemoConfig,
  seedDemoCabinet,
} from "../../../lib/demo";
import { cronSecretMatches } from "../../../lib/nudges";
import { allowRequest } from "../../../lib/throttle";
import { apiContext, toErrorResponse } from "../_session";

export const POST: APIRoute = async ({ request }) => {
  if (import.meta.env.DEV) {
    try {
      const { db, user } = await apiContext(request);
      const drawerPassword = readDemoConfig(env).drawerPassword ?? DEMO_DRAWER_PASSWORD;
      await seedDemoCabinet(db, user.id, Date.now(), readVaultKey(env), drawerPassword);
      return Response.json({ ok: true, email: user.email, drawerPassword });
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  const db = env.DB;
  if (!db) return Response.json({ error: "The cabinet database is not connected." }, { status: 503 });
  const { secret, drawerPassword, email } = readDemoConfig(env);
  if (!secret) return Response.json({ error: "Not found." }, { status: 404 });
  if (!drawerPassword) {
    return Response.json({ error: "Demo drawer password is not configured." }, { status: 503 });
  }
  const caller = request.headers.get("cf-connecting-ip") ?? "local";
  if (!allowRequest(`demo:${caller}`, 5, 60_000)) {
    return Response.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!(await cronSecretMatches(provided, secret))) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  try {
    const now = Date.now();
    let user = await findUserByEmail(db, email);
    if (!user) {
      const row: UserRow = { id: crypto.randomUUID(), email, name: DEMO_NAME, created_at: now, updated_at: now };
      await createUser(db, row);
      user = row;
    }
    await seedDemoCabinet(db, user.id, now, readVaultKey(env), drawerPassword);
    return Response.json({ ok: true, email: user.email });
  } catch (error) {
    return toErrorResponse(error);
  }
};
