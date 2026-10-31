import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { cronSecretMatches, dispatchNudges } from "../../../lib/nudges";
import { allowRequest } from "../../../lib/throttle";

export const POST: APIRoute = async ({ request }) => {
  if (!env.DB) return Response.json({ error: "The cabinet database is not connected." }, { status: 503 });
  const secret = (env as unknown as Record<string, string | undefined>).CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "Nudges are not switched on yet." }, { status: 503 });
  const caller = request.headers.get("cf-connecting-ip") ?? "local";
  if (!allowRequest(`cron:${caller}`, 10, 60_000)) {
    return Response.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = (header.startsWith("Bearer ") ? header.slice(7) : request.headers.get("x-cron-secret"))?.trim() || null;
  if (!(await cronSecretMatches(provided, secret))) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!env.EMAIL || !env.OTP_FROM) return Response.json({ error: "Email is not configured yet." }, { status: 503 });
  try {
    const result = await dispatchNudges(env.DB, env.EMAIL, env.OTP_FROM);
    console.log(JSON.stringify({ event: "nudges-dispatched", ...result }));
    return Response.json(result, { status: result.failed > 0 ? 502 : 200 });
  } catch {
    console.error(JSON.stringify({ event: "nudges-failed" }));
    return Response.json({ error: "The nudge run failed." }, { status: 500 });
  }
};
