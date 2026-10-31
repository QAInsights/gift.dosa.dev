import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { aiConfigFromEnv } from "../../lib/ai";
import { answerQuestion, askContext, normalizeQuestion } from "../../lib/ask";
import { AuthError } from "../../lib/auth";
import { todayYmd } from "../../lib/cards";
import { DEFAULT_PREFS, getPrefs } from "../../lib/prefs";
import { allowRequest } from "../../lib/throttle";
import { apiContext, readJson, toErrorResponse } from "./_session";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    if (!allowRequest(`ask:${user.id}`, 20, 60_000)) {
      throw new AuthError(429, "Too many questions at once. Wait a moment, then ask again.");
    }
    const body = await readJson(request);
    const question = normalizeQuestion(body.question);
    const today = todayYmd();
    const shelf = await askContext(db, user.id, unlocked, today);
    const prefs = await getPrefs(db, user.id).catch(() => ({ ...DEFAULT_PREFS }));
    const config = aiConfigFromEnv(env as unknown as Record<string, string | undefined>);
    const result = await answerQuestion(config, question, shelf, today, (...args) => fetch(...args), prefs.dateFormat);
    const byId = new Map(shelf.cards.map((c) => [c.id, c]));
    const citations = result.cardIds
      .map((id) => byId.get(id))
      .filter((c) => c !== undefined)
      .map((c) => ({ id: c.id, retailer: c.retailer, balance_cents: c.balance_cents, currency: c.currency, expiry: c.expiry }));
    return Response.json({ answer: result.answer, citations });
  } catch (error) {
    return toErrorResponse(error);
  }
};
