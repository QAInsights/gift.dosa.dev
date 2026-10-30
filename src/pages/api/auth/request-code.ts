import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { AuthError } from "../../../lib/auth";
import { sendOtpEmail } from "../../../lib/email";
import { requestCode } from "../../../lib/otp";

export const POST: APIRoute = async ({ request }) => {
  if (!env.DB) return Response.json({ error: "The cabinet database is not connected." }, { status: 503 });
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return Response.json({ error: "Send JSON with an email address." }, { status: 400 });
  }
  try {
    const { code, email } = await requestCode(env.DB, body.email);
    if (import.meta.env.DEV) return Response.json({ ok: true, devCode: code });
    if (!env.EMAIL) return Response.json({ error: "Email is not configured yet." }, { status: 503 });
    try {
      await sendOtpEmail(env.EMAIL, email, env.OTP_FROM, code);
    } catch (error) {
      console.error(JSON.stringify({ event: "otp-email-failed", code: (error as { code?: unknown }).code ?? "unknown" }));
      return Response.json({ error: "Could not send the email. Try again." }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
};
