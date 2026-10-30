import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { clearSessionCookie, readSessionCookie } from "../../../lib/auth";
import { signOut } from "../../../lib/otp";

export const POST: APIRoute = async ({ request }) => {
  if (env.DB) {
    try {
      await signOut(env.DB, readSessionCookie(request.headers.get("cookie")));
    } catch {
      // Fall through: the cookie is cleared regardless.
    }
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": clearSessionCookie() },
  });
};
