# Gift Cabinet — Design Language "Letterpress Luxe" (v1.0 locked)

Working brand: **Gift Cabinet** (`gift.dosa.dev`). Status: **locked**. The mockups under `mockups/a/app-*` are the reference implementation. Rejected landing variants (Overprint, Dose) and type specimens (B/C) were removed; only the winning direction remains on disk.

## 1. Concept

A collector's cabinet printed like fine stationery: ivory stock, espresso ink, gold foil for every action, oxblood wax for seals and warnings, deep teal for calm. The signature: filing a card ends with a stamp landing and a three-colour burst. Professional throughout; playful only in celebrations, seals, and empty states.

## 2. Color (roles, not decoration)

Full-palette posture. Neutrals are warm-tinted; no pure black, white, or gray.

| Role | Token | Value | Job |
|---|---|---|---|
| Ground / wells | `--color-paper`, `-paper-2`, `-paper-3` | `oklch(93% 0.028 78)` et al | Surfaces only |
| Text | `--color-ink`, `-ink-2`, `--color-muted` | `oklch(21% … 45)` et al | Text at ≥4.5:1, rules |
| Signal (acts) | `--color-gold`, `-deep`, `-soft` | `oklch(72% 0.15 88)` et al | Primary buttons, active tab, pulls, focus of celebration |
| Seal (warns) | `--color-oxblood…` | `oklch(44% 0.16 8)` et al | Due-soon, vault seals, errors (always with icon + text) |
| Calm (rests) | `--color-teal…` | `oklch(48% 0.09 195)` et al | Filed states, answers, info |

Gold-deep is the only gold cleared for text. Oxblood and teal never meet on one element. Brand marks render monochrome ink at 28px; monogram tiles (gold-soft, display initial) cover the rest.

## 3. Typography (locked)

- **Display — Fraunces** (`opsz` 144, 600): screen titles, wordmark, empty-state leads. One display moment per screen.
- **Body/UI — Figtree** (400/600/700): everything functional, tabular numerals for figures.
- **Measured — Plex Mono** (400/500): money, dates, masked numbers, counts. One outlier, one job.

App type scale is fixed (12/14/16/19/22/30), sentence case everywhere, left-aligned. The winning type specimen remains at `mockups/a/type-a.html` (styled by `type-faceoff.css`) as the locked-type reference; rejected specimens B/C were removed.

## 4. Icons

One set: **Lucide via Iconify** (24-grid, 2px, currentColor), delivered as a single injected sprite (`app/icons.js`) referenced with `<use>`. Sizes: 14 pills, 16 buttons/labels, 18 tabs, 20 inline, 32 empty states. Brand marks via Simple Icons paths (Amazon, Target, Tesco, Flipkart) plus monogram fallback. No emoji, no icon tiles, no decorative dots.

## 5. Motion (key transactions)

Transform and opacity only; everything collapses under `prefers-reduced-motion`. Durations 120/220/420ms, expo-out.

| Transaction | Motion |
|---|---|
| File a card | Steps crossfade; `Filed` stamp lands (scale 1.35→1); gold/oxblood/teal burst, once |
| Vault | Tab panels crossfade; seal pulses once on submit |
| Ask | Bubbles rise in, answer 180ms behind; thread scrolls to newest |
| Reminder test | Toast slides up, auto-dismisses, pauses on hover/focus |
| Settings | Save morphs to `Saved`; region shelf crossfades |
| Danger confirm | Disclosure opens with a rise; no layout animation |

Skeletons pulse; buttons press 1px; pulls press with their drawer. Nothing else moves.

Amendment (2026-10-30): the cabinet home is furniture, not a table — doors swing once per session, drawer fronts tip toward the reader, trays pull open, and cards fan up. Same budget as everything else: transform and opacity only, expo-out, gone under reduced motion. Reference: `mockups/a/app-cabinet-physical.html`, implemented in `src/pages/cabinet.astro`.

## 6. Modules (no duplicates)

```
mockups/a/app/
  tokens.css       palette, type scale, space, radii, shadow, motion, z
  base.css         reset, shell, topbar, buttons, fields, panels, foot
  components.css   stats, tables, pills, drawers, thread, steps, seals, marks
  motion.css       keyframes, entrances, toast, confetti, reduced-motion
  icons.js         the one sprite (Lucide + brand marks)
  prefs.js         region/currency/date prefs + Intl formatting
```

Screens link the four stylesheets and two scripts, then carry only their own copy and page behaviour. The landing `style.css` is a parked exploration, not system code; `type-faceoff.css` styles only the winning type specimen.

## 7. Shape, responsive, accessibility

Radii 6/10/14/pill; hairline rules; warm soft shadow; gold rule under every screen title. Mobile: brand collapses to mark, tabs scroll sideways, stats/tables/forms stack, targets stay ≥44px. WCAG 2.2 AA: contrast pairs in §2, visible oxblood focus everywhere, keyboard-complete, live regions on filters/threads/saves, status never by colour alone.

## 8. Voice

Warm, precise, brief. Empty states teach; errors say what broke and what to do; celebrations (`Filed.`) stay one line.

## 9. Open items

- Landing page design (parked until after the app build).
- Midnight dark theme (deferred).
- Working brand name "Gift Cabinet" still renamable; tokens don't depend on it.
