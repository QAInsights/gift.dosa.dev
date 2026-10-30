import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { AuthError, sessionCookie } from "../../../lib/auth";
import { verifyCode } from "../../../lib/otp";

export const POST: APIRoute = async ({ request }) => {
  if (!env.DB) return Response.json({ error: "The cabinet database is not connected." }, { status: 503 });
  let body: { email?: unknown; code?: unknown; name?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; code?: unknown; name?: unknown };
  } catch {
    return Response.json({ error: "Send JSON with an email address and code." }, { status: 400 });
  }
  try {
    const { newUser, token } = await verifyCode(env.DB, body.email, body.code, body.name);
    const secure = new URL(request.url).protocol === "https:";
    return new Response(JSON.stringify({ ok: true, newUser }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(token, secure) },
    });
  } catch (error) {
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
};
