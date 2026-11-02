import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { aiConfigFromEnv } from "../../../lib/ai";
import { AuthError } from "../../../lib/auth";
import { todayYmd } from "../../../lib/cards";
import { listDrawers } from "../../../lib/db";
import { DEFAULT_PREFS, getPrefs } from "../../../lib/prefs";
import { allowRequest } from "../../../lib/throttle";
import { extractVoiceDraft, normalizeTranscript } from "../../../lib/voice";
import { apiContext, readJson, toErrorResponse } from "../_session";

function clientToday(raw: unknown): string {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayYmd();
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { db, user } = await apiContext(request);
    if (!allowRequest(`voice:${user.id}`, 10, 60_000)) {
      throw new AuthError(429, "Too many recordings at once. Wait a moment, then try again.");
    }
    const body = await readJson(request);
    const transcript = normalizeTranscript(body.transcript);
    const today = clientToday(body.today);
    const timeZone = typeof body.timeZone === "string" && body.timeZone ? body.timeZone.slice(0, 80) : "UTC";
    const [drawers, prefs] = await Promise.all([
      listDrawers(db, user.id).then((r) => r.results.map((d) => ({ id: d.id, name: d.name }))),
      getPrefs(db, user.id).catch(() => ({ ...DEFAULT_PREFS })),
    ]);
    const config = aiConfigFromEnv(env as unknown as Record<string, string | undefined>);
    const draft = await extractVoiceDraft(
      config,
      transcript,
      { drawers, defaultCurrency: prefs.currency, today, timeZone },
      (...args) => fetch(...args),
    );
    return Response.json({ draft });
  } catch (error) {
    return toErrorResponse(error);
  }
};
