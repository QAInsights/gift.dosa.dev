import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { aiConfigFromEnv } from "../../lib/ai";
import { askContext } from "../../lib/ask";
import { AuthError } from "../../lib/auth";
import { todayYmd } from "../../lib/cards";
import { normalizeErrands, planErrands } from "../../lib/plan";
import { DEFAULT_PREFS, getPrefs } from "../../lib/prefs";
import { allowRequest } from "../../lib/throttle";
import { apiContext, readJson, toErrorResponse } from "./_session";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    if (!allowRequest(`plan:${user.id}`, 10, 60_000)) {
      throw new AuthError(429, "Too many plans at once. Wait a moment, then try again.");
    }
    const body = await readJson(request);
    const errands = normalizeErrands(body.errands);
    const today = todayYmd();
    const shelf = await askContext(db, user.id, unlocked, today);
    const prefs = await getPrefs(db, user.id).catch(() => ({ ...DEFAULT_PREFS }));
    const config = aiConfigFromEnv(env as unknown as Record<string, string | undefined>);
    const plan = await planErrands(config, errands, shelf, today, (...args) => fetch(...args), prefs.dateFormat);
    return Response.json({
      summary: plan.summary,
      lines: plan.lines.map((l) => ({
        errand: l.errand,
        note: l.note,
        card: l.card
          ? {
              id: l.card.id,
              retailer: l.card.retailer,
              balance_cents: l.card.balance_cents,
              currency: l.card.currency,
              expiry: l.card.expiry,
            }
          : null,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};
