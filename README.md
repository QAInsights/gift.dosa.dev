# Gift Cabinet

AI-native gift-card concierge: snap a card, file it in a cabinet of drawers, ask what to spend next, and get reminded before value expires. Astro SSR on Cloudflare Workers + D1. Live at https://gift.dosa.dev.

## Quickstart

Requires Node 22+. Local work needs no Cloudflare account.

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

Local AI features need `.dev.vars` with `META_AI_ENDPOINT`, `META_AI_MODEL`, and `META_AI_API_KEY`; without them the app runs fully on manual entry plus a deterministic ask fallback.

## Scripts

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run check` | Astro + TypeScript checks (must be 0/0/0) |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright, 17 specs) |
| `npm run cf:types` | Regenerate `Env` types from `wrangler.jsonc` |
| `npm run db:local` | Apply `schema.sql` to local D1 |
| `npm run preview:cf` | Production build served by `wrangler dev` |
| `npm run deploy` | Build and deploy to Cloudflare |

## Architecture

- `src/pages/` — prerendered public pages (`/`, `/signup`, `/signin`, `/404`) plus server-rendered app routes: `/cabinet` (dashboard, ask bar, drawer furniture, filters), `/file` (photo + manual entry), `/cards/[id]` (detail, vault, memories), `/account` (auto-saving profile), `/notes` (to-dos).
- `src/pages/api/` — thin JSON endpoints over `src/lib`: auth (OTP request/verify, session), cards CRUD, drawers CRUD + lock/unlock/relock, ask, todos, profile, snap extraction, and secret-guarded `POST /api/cron/nudges`.
- `src/lib/` — framework-free domain logic with colocated tests: OTP sessions, cards, drawers (PBKDF2 locks, curated emoji), reminders, nudges (claim-before-send), ask (shelf grounding + fallback), todos, seed data, prefs, rate limiting.
- `src/components/`, `src/layouts/` — Astro components and shells; Letterpress Luxe design tokens in `src/styles/tokens.css`, one shared `global.css`.
- Data: D1 (`users`, `otp_codes`, `sessions`, `drawers`, `cards`, `reminders`, `prefs`, `todos`). `schema.sql` is the full snapshot for fresh databases; `migrations/` holds the numbered forward path.
- Auth: passwordless email + 6-digit OTP, signed session cookie, per-drawer password seals with attempt throttling. No secrets in the browser: the model key lives in server env and is sent only server-to-provider.

## Model usage

Two calls to a Muse Spark chat-completions endpoint, both server-side with a 15s timeout:

- **Snap extraction** (`src/lib/ai.ts`): vision read of a card photo into retailer/balance/expiry/number/PIN. The user always reviews and confirms; manual entry is a full path, never a dead end.
- **Ask** (`src/lib/ask.ts`): answers grounded in a JSON snapshot of the user's shelf (retailer, balance, expiry, drawer only — vault numbers/PINs are never sent). Answers must cite card IDs; anything uncited or any provider failure falls back to a deterministic shelf summary.

## Tradeoffs

- SSR-first Astro with vanilla client JS instead of a SPA framework: fast first paint (Lighthouse 100s, ~775ms mobile LCP) at the cost of full-page reloads after most mutations.
- D1 for everything (auth, data, prefs): one binding, zero new services; expiry nudges need an external daily cron hitting the guarded endpoint.
- Per-file migrations applied explicitly with `d1 execute --file`, not the `d1_migrations` journal: transparent and order-obvious, but each file must be run once per environment by hand.
- Store logos via Google's favicon service with a curated retailer→domain map; unknown shops keep a monogram rather than risk a wrong logo.
- Sealed drawers hide contents and rename/delete, but the header emoji is cosmetic metadata and stays changeable without unlocking.

## Database changes

Apply new migrations in numeric order, once per environment:

```sh
npx wrangler d1 execute gift-cabinet --local --file=./migrations/0008_starter_emoji.sql
npx wrangler d1 execute gift-cabinet --remote --file=./migrations/0008_starter_emoji.sql
```

Add a new migration together with the matching `schema.sql` update.

## Going remote

1. `npx wrangler login`.
2. Apply schema/migrations remotely (see above).
3. Verify a sender domain in Email Sending; set `OTP_FROM` to match.
4. Set secrets: `npx wrangler secret put META_AI_API_KEY`, `npx wrangler secret put CRON_SECRET`.
5. `npm run deploy`.
6. Schedule a daily `POST https://gift.dosa.dev/api/cron/nudges` with `Authorization: Bearer <CRON_SECRET>`.
