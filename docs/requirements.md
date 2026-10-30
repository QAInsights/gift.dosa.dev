# Gift Cabinet — Locked Requirements (v2.0)

Status: **locked** for hackathon build. Solo builder, indie track, submissions due Nov 4, 9:00 PM ET. Companions: [idea.md](../idea.md), [features.md](../features.md), [design language](design-language.md), [design context](../.impeccable.md).

## 1. Product

AI-native gift-card concierge. Core loop: **capture** (web upload + WhatsApp photo) → **Muse-model extraction** → cabinet filing → **ask / spend-next optimization** → **reminders**. Theme: Build for Your World. Framing: WhatsApp is the hands, Muse is the brain — every smart behavior traces to a model call.

## 2. Functional requirements

**AUTH** — Email sign-up/sign-in with one-time password. Sessions persist across devices.
**CABINET** — Card CRUD: retailer, nickname, last-4 (optional), balance, expiry, occasion, tags, receipt photo. Catalog-drawer folders with counts; dashboard totals and per-drawer subtotals.
**VAULT (opt-in)** — Full card number + PIN stored only if the user opts in per card. Masked by default, revealed only after the drawer-lock password, never sent to the model, never written to logs.
**AI-CAPTURE (web)** — Photo upload → model extraction (retailer, amount, expiry — non-sensitive fields only) → user confirms/edits → card saved. Manual entry always available as fallback.
**AI-ASSIST** — Natural-language ask bar over the cabinet ("what expires first?") with answers citing source cards, plus a "spend next" suggestion driven by expiry and balance.
**WA-CHANNEL (added)** — WhatsApp capture + reminders via WhatsApp Cloud API on Meta's free test number:
- Inbound photo → webhook → media download → same extraction pipeline as web → reply with summary + quick replies (Confirm / Edit / Discard).
- WhatsApp number → account linking flow in the web app (verification code), so inbound photos land in the right cabinet.
- Expiry/low-balance reminders as utility templates; email remains as fallback channel.
- Sequenced **after** the web thin slice (photo → saved card) works standalone.
**REMIND** — Scheduled expiry and low-balance nudges via WhatsApp template + email fallback; user-configurable lead time per card.
**DASH** — Total balance hero figure, spend-next pull-line, cabinet grid with one spotlight tile, expiring-soon ribbon states.
**HOME** — Thin editorial slice: manifesto, gift-card forgetfulness figures, how-it-works, single CTA. No deep stats pages.

## 3. Non-functional

- **Responsive:** mobile-first per the design language (bottom sheet → docked panel, 1 → 4 column cabinet, ≥44px targets).
- **Accessibility:** WCAG 2.2 AA, visible focus, keyboard-complete, `prefers-reduced-motion` honored.
- **Security:** TLS in transit, encryption at rest, masked credentials, no sensitive values in logs/analytics/prompts.
- **Design compliance:** every surface follows `docs/design-language.md` (Foil & Paper) and `.impeccable.md`.

## 4. Out of scope / stretch

- **Out:** Instagram, Messenger, Facebook/Threads integrations, Facebook Login, dark theme, deep marketing/stats content, HSM-grade vault.
- **Stretch (only if core + WA ship early):** WhatsApp Flows confirm form, Midnight Cabinet dark tokens.

## 5. Constraints and risks

- Test number accepts only pre-registered recipients → demo via recorded video + builder's live phone; register test numbers early.
- WhatsApp production messaging carries small per-message charges (Oct 2026 pricing) — irrelevant on the test number, don't pitch "free forever."
- Scope guard: anything not serving the demo script below gets cut.

## 6. Acceptance — the demo script

Fresh account → sign up via OTP → scan a card on web → send a second card photo via WhatsApp → confirm both → ask "what should I spend first?" → lock a drawer, fail and pass unlock → receive a reminder → dashboard totals correct → responsive on phone and desktop.

## 7. Open until scaffold

Exact Cloudflare services, frontend stack, and model picks (API credits already in hand — verify access keys at scaffold time).

## 8. v2 delta (from features.md, spec'd against locked UI)

**Accepted into v2:**
- **PROFILE** — update display name and preferences (lives on the settings screen).
- **MEMORY** — cards flaggable as memories: excluded from spend-next and delete until unmarked; separate memories view.
- **CABINET-VIEWS** — grid + list views, search, filter, sort (list reuses the locked table pattern).
- **STORE-MARKS** — logo per card from the locked brand-mark set, monogram fallback.
- **HOME-ACTIVITY** — homepage adds a small recent-activity strip to the v1 thin slice.

**Cut or deferred (with reason):**
- **Custom cabinet/card colors and patterns** — cut for the hackathon; locked Letterpress Luxe tokens are fixed.
- **Raw PIN display** — stays vault-gated and masked per §2 VAULT; no always-visible PIN.
- **Full WhatsApp cabinet management** — deferred to stretch; v1 capture + confirm/edit/discard + reminders stands.
- **Occasion-based AI recommendations** — stretch after ask + spend-next ship.

Scope re-check: v2 fits ~6 build days with the cuts above. v2 is locked; further asks go to stretch.
