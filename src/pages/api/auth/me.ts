import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { readSessionCookie } from "../../../lib/auth";
import { sessionUser } from "../../../lib/otp";

export const GET: APIRoute = async ({ request }) => {
  if (!env.DB) return Response.json({ error: "The cabinet database is not connected." }, { status: 503 });
  const user = await sessionUser(env.DB, readSessionCookie(request.headers.get("cookie")));
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  return Response.json({ user: { email: user.email, name: user.name } });
};
