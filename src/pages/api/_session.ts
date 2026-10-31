import { env } from "cloudflare:workers";
import { AuthError, readSessionCookie } from "../../lib/auth";
import { sessionContext } from "../../lib/otp";

export async function apiContext(request: Request) {
  if (!env.DB) throw new AuthError(503, "The cabinet database is not connected.");
  const ctx = await sessionContext(env.DB, readSessionCookie(request.headers.get("cookie")));
  if (!ctx) throw new AuthError(401, "Sign in first.");
  return { db: env.DB, user: ctx.user, unlocked: ctx.unlocked, tokenHash: ctx.tokenHash };
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("no json object");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(400, "Send a JSON object.");
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
}
