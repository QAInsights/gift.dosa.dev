import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { allowRequest } from "../../../lib/throttle";
import { handleInboundEvent, parseWebhookEvents, verifyHandshake, whatsappEnv } from "../../../lib/whatsapp";

export const GET: APIRoute = async ({ url }) => {
  const challenge = verifyHandshake(
    url,
    (env as unknown as Record<string, string | undefined>).WHATSAPP_VERIFY_TOKEN?.trim(),
  );
  if (!challenge) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
};

export const POST: APIRoute = async ({ request }) => {
  if (!env.DB) return Response.json({ error: "The cabinet database is not connected." }, { status: 503 });
  const { config, ai } = whatsappEnv(env as unknown as Record<string, string | undefined>);
  if (!config) return Response.json({ error: "WhatsApp is not switched on yet." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as unknown;
  for (const event of parseWebhookEvents(body)) {
    if (!allowRequest(`wa:${event.from}`, 20, 60_000)) continue;
    try {
      await handleInboundEvent(env.DB, config, ai, event);
    } catch (error) {
      console.log(JSON.stringify({ event: "wa-inbound-error", kind: event.type, error: error instanceof Error ? error.message : "unknown" }));
    }
  }
  return Response.json({ ok: true });
};
