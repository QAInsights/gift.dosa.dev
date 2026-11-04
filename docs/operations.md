# Operations

Deployment and maintenance notes for Gift Cabinet. Nothing here is needed to run the app locally; see the README quickstart for that.

## Environment

Local dev reads `.dev.vars` (gitignored):

| Name | Purpose |
| ---- | ------- |
| `META_AI_ENDPOINT`, `META_AI_MODEL`, `META_AI_API_KEY` | Muse Spark via the Meta Model API. Without these, snap/voice/ask/plan use their non-AI paths. |
| `VAULT_KEY` | 32 random bytes, base64url. Master key for card number/PIN encryption. |
| `CRON_SECRET` | Bearer secret for `POST /api/cron/nudges`. |
| `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp Cloud API access, webhook handshake, and payload signature. |

Non-secret vars live in `wrangler.jsonc`: `OTP_FROM`, `META_AI_ENDPOINT`, `META_AI_MODEL`, `WHATSAPP_PHONE_ID`, `WHATSAPP_DISPLAY_NUMBER`.

On Windows under Git Bash, `npm`/`npx` shims can be unreliable; `npm.cmd` / `npx.cmd` always work.

## Database changes

`schema.sql` is the full snapshot for a fresh database; `migrations/0002…0010` is the numbered forward path. Add a migration and the matching `schema.sql` change together.

Migrations are applied explicitly with `d1 execute --file`, not the `d1_migrations` journal: transparent and order-obvious, but each file must be run once per environment by hand.

```sh
npx wrangler d1 execute gift-cabinet --local --file=./migrations/0010_redemptions.sql
npx wrangler d1 execute gift-cabinet --remote --file=./migrations/0010_redemptions.sql
```

## Going remote

1. `npx wrangler login`.
2. Apply schema/migrations remotely (see above).
3. Verify a sender domain in Email Sending; set `OTP_FROM` to match.
4. Set secrets: `npx wrangler secret put META_AI_API_KEY`, `VAULT_KEY`, `CRON_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
5. `npm run deploy`.
6. Add `CRON_SECRET` (same value as step 4) under GitHub Settings > Secrets and variables > Actions. The `Expiry nudges` workflow then POSTs the cron endpoint daily at 12:20 UTC; run it once by hand first to confirm green.

## WhatsApp webhook

`GET /api/whatsapp/webhook` answers Meta's subscribe handshake with `WHATSAPP_VERIFY_TOKEN`. `POST` enforces `X-Hub-Signature-256` when `WHATSAPP_APP_SECRET` is set, throttles each number to 20 requests/minute, and always returns 200 so Meta never retries.

Gotcha we hit live: a verified callback URL is not enough. The Meta app must also be subscribed to the WhatsApp Business Account (`POST /{WABA_ID}/subscribed_apps`), or real messages never arrive while Test events do.

## Demo account

`npm run demo:seed` is dev-only: `POST /api/dev/demo` returns 404 outside `astro dev`. Re-running resets the caller's cabinet first, so it is safe to run before every recording.
