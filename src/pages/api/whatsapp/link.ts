import type { APIRoute } from "astro";
import { findWhatsappLinkByUser } from "../../../lib/db";
import { startLink, unlinkNumber } from "../../../lib/whatsapp";
import { apiContext, readJson, toErrorResponse } from "../_session";

export const GET: APIRoute = async ({ request }) => {
  try {
    const { db, user } = await apiContext(request);
    const link = await findWhatsappLinkByUser(db, user.id);
    return Response.json({
      link: link ? { phone: link.phone, verified: link.verified_at !== null } : null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { db, user } = await apiContext(request);
    const body = await readJson(request);
    const link = await startLink(db, user.id, body.phone);
    return Response.json({ link: { phone: link.phone, code: link.code, verified: false } }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const { db, user } = await apiContext(request);
    await unlinkNumber(db, user.id);
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
};
