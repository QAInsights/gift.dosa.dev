# Gift Cabinet — Build Tracker

Solo · indie track · submissions due **Nov 4, 9:00 PM ET**. Design is locked ([Letterpress Luxe](docs/design-language.md)); requirements v1 locked ([requirements](docs/requirements.md)). I (Muse) keep this file current: checkboxes flip as work lands, and live session todos mirror the active phase.

Legend: `[x]` done · `[ ]` todo · `[~]` in progress · `[cut]` explicitly cut.

## Phase 0 — Design lock (done)

- [x] Three landing directions explored (Ink, Overprint, Dose) — Overprint/Dose removed, Ink kept as lead
- [x] Rejected mockups pruned (landings B/C, type specimens B/C); `mockups/a` holds the locked set only
- [x] App screen set built (cabinet, card, drawers, ask, file, reminders, settings)
- [x] Letterpress Luxe system: palette, Fraunces/Figtree/Plex Mono, Lucide icons, brand marks
- [x] Key-transaction motion (stamp, burst, toasts, entrances; reduced-motion safe)
- [x] CSS modularized (`tokens/base/components/motion` + `icons.js`/`prefs.js`), zero duplicates, lint clean

## Phase 1 — Requirements round 2 (done)

Goal: fold your additional requirements into the spec before scaffolding.

- [x] You share additional requirements (`features.md`)
- [x] I spec them against the locked UI and update `docs/requirements.md` to v2
- [x] Re-confirm scope fits ~6 build days; cut list agreed (custom colors cut, WA management + occasion-AI stretch)

Exit: requirements v2 locked, no open scope questions.

## Phase 2 — Scaffold and stack lock (target: Oct 29)

Goal: runnable skeleton deployed to the `.dev` domain.

- [x] Lock stack: Astro frontend, Cloudflare hosting + D1 (auth/data; OTP rows live in D1, no KV; R2 for photos lands Phase 4); Lucide sprite ported from mockups
- [x] Verify Meta Model API keys/credits with one real call (Muse Spark 1.1: text + vision calls succeed; key in `wrangler secret`, endpoint/model in vars)
- [x] Repo layout, env config, deploy pipeline, preview URL live (workers.dev + gift.dosa.dev); remote D1 created + schema applied
- [x] Verify Email Sending sender domain so prod OTP emails deliver (DNS healthy, prod send returns ok)
- [x] Auth shell (email + OTP), design tokens + fonts + icons ported from mockups
- [x] Database schema (cards, drawers, locks, reminders, prefs) — live local + remote via `migrations/0002_cabinet.sql`

Exit: preview URL loads the shell on phone + desktop; one model call succeeds from project env.

## Phase 3 — Web thin slice (done Oct 30)

Goal: the cabinet works end to end without AI or WhatsApp.

- [x] Card CRUD, drawers, per-drawer lock/unlock, dashboard totals
- [x] Vault opt-in: masked, lock-gated, never logged
- [x] Manual entry fallback for every AI path (manual entry is the path; AI deferred)
- [x] Responsive pass per locked system; empty + error states live (server-rendered, no async skeleton needed)

Exit: demo script runs minus AI/WhatsApp from a fresh account.

## Phase 4 — AI core (target: Oct 31–Nov 1) [~]

Goal: Muse models do the headline work. Every smart behavior traces to a model call.

- [~] Photo → extraction (retailer, amount, expiry; non-sensitive fields only) → confirm-and-save — live (Muse Spark 1.1); synthetic card read 2/3 fields (balance missed) — real-photo accuracy check still owed
- [x] Ask bar over the cabinet with cited answers (Muse Spark 1.1 grounded in shelf JSON; deterministic shelf fallback when the model is off or garbles; citations link to cards)
- [x] Spend-next suggestion from expiry + balance (dashboard pull-line, sealed/memories excluded)
- [ ] Extraction accuracy check on 5+ real photos; graceful manual fallback

Exit: one photo becomes a filed card; scripted questions answer correctly on seeded data.

## Phase 5 — WhatsApp channel (target: Nov 2)

Goal: WhatsApp as second front door (hands), models as brain. Starts only after Phase 4.

- [ ] Meta app + Cloud API test number + webhook verified
- [x] Inbound photo → media download → extraction → quick-reply confirm/edit/discard
- [x] Number → account linking flow in web app
- [ ] Test recipients registered (demo phones)

Exit: live phone sends a photo, confirms, sees it in the cabinet.

## Phase 6 — Reminders, homepage, polish (target: Nov 3 morning)

Goal: everything around the core earns its place.

- [x] Scheduled expiry/low-balance nudges, email channel (per-card lead time, once per expiry window; low balance ≤ $5 on a 7-day cooldown; sent via the EMAIL binding from a secret-guarded `POST /api/cron/nudges` — schedule any daily cron at it after `wrangler secret put CRON_SECRET`; WhatsApp templates join with Phase 5)
- [x] Homepage thin slice (manifesto, figures, how-it-works, CTA, recent-activity strip) — figures are product-true (1 photo, 30 days' warning, 0 numbers to the model); signed-in visitors see their real shelf totals and latest cards, signed-out visitors see a labeled sample shelf
- [x] Profile settings page (display name, region/currency/date preferences) — saved to the account (D1 prefs); currency defaults new filings, date format applies across cabinet, card, trays, and ask
- [ ] Full responsive + accessibility pass; copy review; demo account seeded

Exit: reminder received in a real inbox; homepage reads clean on phone + desktop.

## Phase 7 — Demo and submission (target: Nov 3–4)

Goal: submitted early, nothing left to chance.

- [ ] Full demo run-through from a fresh account (web + WhatsApp + reminder)
- [ ] Demo video recorded (WhatsApp test-number limits make video essential)
- [x] README (setup, architecture, model usage, tradeoffs)
- [ ] Submit before Nov 4, 9:00 PM ET; confirmation saved

Exit: submission confirmed with working demo + video.

## Risks on watch

- Model API limits/pricing under real use (mitigate: verify Day 1 of build)
- Photo extraction accuracy on real cards (mitigate: manual fallback always present)
- Scope creep (mitigate: anything outside the demo script gets cut)
- WhatsApp test-number recipient limits (mitigate: register early, lean on video)
