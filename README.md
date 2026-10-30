# Gift Cabinet

AI-native gift-card concierge: capture cards, file them in a cabinet, ask what to spend next, and get reminded before value expires. Built with Astro on Cloudflare Workers + D1 for the Meta Global AI Developer Hackathon (indie track).

## Quickstart

Requires Node 22+. No Cloudflare account needed for local work.

```sh
npm install
npm run cf:types
npm run dev
```

In a second terminal, create the local tables once:

```sh
npm run db:local
```

Open http://localhost:4321. Sign-up codes print in the page (dev builds skip real email).

## Scripts

| Command           | What it does                                   |
| ----------------- | ---------------------------------------------- |
| `npm run dev`     | Local dev server with emulated Cloudflare APIs |
| `npm run build`   | Production build                               |
| `npm run check`   | Astro + TypeScript checks                      |
| `npm run test`    | Unit tests (auth logic)                        |
| `npm run cf:types`| Regenerate `Env` types from `wrangler.jsonc`   |
| `npm run db:local`| Apply `schema.sql` to local D1                 |
| `npm run deploy`  | Build and deploy to Cloudflare                 |

## Going remote

1. `npx wrangler login`, then `npm run db:create` and paste the `database_id` into `wrangler.jsonc`.
2. Apply the schema remotely: `npx wrangler d1 execute gift-cabinet --remote --file=./schema.sql`.
3. Verify a sender domain in Cloudflare Email Sending and set `OTP_FROM` in `wrangler.jsonc` to match.
4. `npm run deploy`.

## Layout

- `src/pages/` — prerendered pages (`/`, `/signup`, `/signin`, `/404`) plus the server-rendered `/account` and `/api/auth/*` endpoints.
- `src/components/AuthForm.astro` — shared two-step email + code form.
- `src/layouts/Base.astro` — shell with locked Letterpress Luxe tokens, fonts, and icon sprite.
- `src/lib/` — framework-free auth logic with colocated tests; endpoints are thin adapters over it.
- `schema.sql` — D1 tables for users, OTP codes, and sessions.
