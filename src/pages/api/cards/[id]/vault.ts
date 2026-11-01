import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { readVaultKey } from "../../../../lib/crypto";
import { clearVault, revealVault, setVault } from "../../../../lib/vault";
import { apiContext, readJson, toErrorResponse } from "../../_session";

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const vault = await revealVault(db, user.id, params.id ?? "", unlocked, readVaultKey(env));
    return Response.json({ vault });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const PUT: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    const body = await readJson(request);
    await setVault(db, user.id, params.id ?? "", unlocked, { number: body.number, pin: body.pin }, readVaultKey(env));
    return Response.json({ ok: true, has_vault: true });
  } catch (error) {
    return toErrorResponse(error);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const { db, user, unlocked } = await apiContext(request);
    await clearVault(db, user.id, params.id ?? "", unlocked);
    return Response.json({ ok: true, has_vault: false });
  } catch (error) {
    return toErrorResponse(error);
  }
};
