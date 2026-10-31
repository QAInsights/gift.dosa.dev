import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { aiConfigFromEnv, extractCardFields } from "../../lib/ai";
import { AuthError } from "../../lib/auth";
import { apiContext, toErrorResponse } from "./_session";

const MAX_PHOTO_BYTES = 5_000_000;

export const POST: APIRoute = async ({ request }) => {
  try {
    await apiContext(request);
    const config = aiConfigFromEnv(env as unknown as Record<string, string | undefined>);
    if (!config) throw new AuthError(503, "Photo reading is not switched on yet. Type the card instead.");
    const form = await request.formData().catch(() => null);
    const photo = form?.get("photo");
    if (!(photo instanceof File)) throw new AuthError(400, "Attach a photo of the card.");
    if (!photo.type.startsWith("image/")) throw new AuthError(400, "That file is not a photo.");
    if (photo.size > MAX_PHOTO_BYTES) throw new AuthError(400, "That photo is too large. Keep it under 5 MB.");
    const fields = await extractCardFields(config, await photo.arrayBuffer(), photo.type || "image/jpeg");
    return Response.json({ fields });
  } catch (error) {
    return toErrorResponse(error);
  }
};
