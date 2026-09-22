# Layer 9 (Product Website) — reconnaissance record

Status: **design source FOUND and read in full. All 3 decisions RESOLVED and
implemented.** Recon only below; see DEFERRED.md item 10 for the matching-
vocabulary defect found and fixed during verification.

Tree at reconnaissance time: clean, `afffcbb`.

## Decisions — all resolved

| # | Question | Decision |
|---|---|---|
| 1 | Palette | **(A)** project tokens only; translate layout/structure. The design's palette disagreed with the normative brand doc on 8 of 10 colours and would have repainted Layers 2–8. |
| 2 | Match auth | **(a)** capture concern on landing → route to auth → fire the real match post-login → land in the existing Layer 6 flow. **Layer 4's guards untouched.** |
| 3 | Logo | Existing `arai-logo-mark-light.png` at its native 2.83:1, not the design's embedded 900×499 artwork. |

## Design source — FOUND

Filename is `ARAI.CO_landing_polished.html` (dots, not underscores) and it
lives in **`~/Downloads`**, not the planning-docs folder:

```
/Users/jean/Downloads/ARAI.CO_landing_polished.html   121604 bytes, 22 Sep 23:25
```

134 lines, one long minified line. Contains an inline `<style>` (9699 chars),
an 80 KB base64 PNG logo, and one `<script>` (1223 chars). Both were extracted
and read in full.

Also in the planning-docs folder: `Pasted 2026-09-23 at 12.33.20 AM.textClipping`
(4140 b). Decoded, it is an Apple binary plist holding a UTF-16 copy of my own
earlier reconnaissance message. Not a design file.

`landing-mockup-reference.html` (11896 b) is an **older, different** artifact.
Superseded; do not build from it. All findings below are from the polished file.

## Design vs. older reference — the polished file is a full redesign

Not a tweak. Differs in layout, structure, palette, copy and interaction.

| | older reference | polished design |
| --- | --- | --- |
| layout | 1440px fixed, tall scroll | `100svh` grid, `overflow:hidden`, no scroll |
| hero | open; 12 tint circles + logo watermark | rounded `.hero-panel`; mint gradient; 1 tint circle; ring shadows; dot-grid |
| header | logo + 3 nav links + "Simulan!" btn | logo + lock-icon "Fictional prototype" notice pill |
| eyebrow | "ARAI — Alagang Remote, AI-Powered" | "Alagang Remote + AI" |
| subhead | "…para sa'yo." | "…para sayo." |
| trust strip | removed | `.signal` pill "Simulan sa nararamdaman mo" replaces it |
| widget chips | 5, invented doctors attached | **7 body parts, inline SVG icons** |
| textarea | none | present, `#concern` |
| match preview | invented doctor card | **removed entirely** |
| CTA | dead button | disabled→ready state machine + spinner |
| steps | none | `1 · Concern / 2 · Doctor / 3 · Schedule` |
| nav links | present | **gone** |
| footer | 3-column | **gone** |
| `lang` | `fil` | `en` |
| title | ARAI.CO — Landing | ARAI.CO — May aray ka? |

Earlier flags about dual hero CTAs, footer columns, an "AI Match" badge and nav
links all describe the OLD reference and **do not apply**.

### Widget behaviour — honest, but fake

The `<script>` is a real state machine: `aria-pressed` single-select across 7
`.part` buttons; `input` listener on the textarea; CTA disabled until
part-selected OR text typed; `.cta.ready` class toggled; helper copy switches to
"Ready na—hanapan ka na natin ng doctor."; spinner on submit. But the result is
a hardcoded 1600 ms timeout with **no network call**:

```
setTimeout(() => { …; helper.textContent =
  'Prototype complete—doctor results would open next.' }, 1600);
```

The helper admits it. This is the "demo-only quick-book widget JS" Layer 9
replaces with real functionality.

## 🛑 Decision 1 (key) — the polished design redefines the brand palette

The design's `:root` is **not** a rename of project tokens. Almost every colour
differs. Verified by direct hex comparison:

| token | project | design | same? |
| --- | --- | --- | --- |
| ink | `#14213D` | `#132b3e` | NO |
| background / surface | `#F2F2F2` | `#f8fbf8` | NO |
| coral / accent | `#FF7F50` | `#ff705b` | NO |
| green | `#06D6A0` | `#bdebd2` | NO |
| mint / green-tint | `#D9FAF0` | `#dff7ec` | NO |
| peach / danger-tint | `#FFE4D9` | `#ffe0d2` | NO |
| muted-fg | `#5B6651` | `#526777` | NO |
| border | `#DCDCD6` | `#dbe6e1` | NO |
| yellow | `#FFD166` | `#ffd166` | YES |
| blue | `#118AB2` | `#118ab2` | YES |

The brand doc (`arai-brand-design-reference.md` lines 44-53) is **normative**
and specifies the PROJECT values: `#F2F2F2`, `#14213D`, `#FF7F50`, `#D9FAF0`,
`#FFE4D9`. The design also introduces hues with no brand equivalent:
`--coral-dark #e95a46`, `--green #bdebd2`, `--surface #f8fbf8`, `--line #dbe6e1`.

Contrast measured (WCAG ratio):

| pair | ratio | verdict |
| --- | --- | --- |
| `#fff` on design coral `#ff705b` | **2.72** | sub-AA |
| `#fff` on project coral `#FF7F50` | **2.50** | sub-AA; explicitly accepted by brand doc open item #1, scoped to `variant="cta"` |
| `#14213D` on `#ff705b` | 5.87 | passes |
| `#132b3e` on `#f8fbf8` | 13.96 | passes |
| `#526777` on `#f8fbf8` (design body text) | 5.65 | passes |
| `#5B6651` on `#f2f2f2` (project body text) | 5.41 | passes |
| `#91a0aa` on `#fff` (design `.step`, 10px) | **2.69** | **fails — new problem** |
| `#7b8983` on `#d9dfdc` (design disabled CTA) | 2.70 | fails; disabled controls exempt |

The design's coral is marginally better for white text than the project's
(2.72 vs 2.50) but still sub-AA, so the brand doc's accepted tradeoff still
governs. The `.step` colour `#91a0aa` is a genuine new accessibility defect.

**Swapping the project palette to the design's would repaint every screen built
in Layers 2-8** (badges, buttons, sidebar, tables, status pills) and invalidate
the normative brand doc. That is not a Layer 9 decision. Options:

- **(A)** Keep the project palette. Translate the design's *layout and
  structure* only, mapping colours onto existing tokens: design coral→
  `--brand-accent`, `#f8fbf8`→`--brand-surface`/`background`, `#132b3e`→
  `--brand-ink`, `#dff7ec`→`--brand-green-tint`, `#ffe0d2`→`--brand-danger-tint`.
  Design-only hues (`--coral-dark`, `#bdebd2`, `#dbe6e1`) drop or become new
  decorative tokens. Fix `.step` to a passing colour.
- **(B)** Adopt the design palette project-wide as a named rebrand, with its own
  layer, evidence run, and brand-doc update.
- **(C)** Hybrid: brand tokens for semantics, a few design hues as new
  decorative tokens.

Recommend **(A)** — preserves the normative brand doc, leaves Layers 2-8
untouched, still delivers the design's layout. Your call.

## 🛑 Decision 2 — public landing cannot call the match endpoint

The Layer 6 flow already owns match → doctor → booking in
`features/patient/guided-matching-screen.tsx`: `GET /doctors/match/options` on
mount (~line 132), `GET /doctors/match?symptom=…` on submit (~line 152), and
each card hands off to `/patient/book/${doctor.id}` (line 59). That screen sits
behind `RequireRole allow={['PATIENT']}` at `/patient/book`.

Both match routes are auth-guarded — `apps/backend/src/doctors/doctors.controller.ts`:

```
@Get('match/options')  @UseGuards(JwtAuthGuard)  listMatchOptions()
@Get('match')          @UseGuards(JwtAuthGuard)  match(@Query('symptom') symptom: string)
```

Live curl without a token on both → HTTP 401.

So a PUBLIC landing widget cannot produce a live match. Options:

- **(a)** Widget captures the concern locally only, routes to `/register` or
  `/login` carrying it forward; matching happens post-auth in guided-matching.
  No backend change; public page stays public; step indicator honestly shows
  `1 · Concern` as the only completed step.
- **(b)** Drop `JwtAuthGuard` from both match routes. Layer 4 backend change,
  own evidence run, exposes the seeded symptom→specialty map and approved-doctor
  list to anonymous users.
- **(c)** Jean specifies.

## 🛑 Decision 3 — logo asset is a third artwork, different aspect ratio

The design embeds a base64 PNG. It is **not** either project asset:

| asset | dimensions | ratio | md5 |
| --- | --- | --- | --- |
| embedded in design | 900 x 499 | 1.80:1 | `bf38a22b…` |
| `arai-logo-mark-light.png` | 1312 x 464 | 2.83:1 | `2720dbb0…` |
| `arai-logo-mark-outline.png` | 1312 x 464 | 2.83:1 | `e4ff45ae…` |

Ink-occupancy profiles (40 buckets, `#`=ink):

```
design-embed   ##############.#########.###############   contiguous, single row
project-light  #############   ########   ############.   three ink groups, two gaps
```

Different artwork, not a re-crop. The design's `.logo{width:178px;height:74px}`
is tuned to the 1.80:1 embedded lockup. `BrandLogo` sizes by height with
`w-auto` for a 2.83:1 mark, and its doc comment claims "mark+wordmark lockup",
which the profile suggests is actually mark plus two word groups. Reusing
`BrandLogo` inside a baked 178x74 box would mis-fit.

Options: (i) add the design's embedded 900x499 PNG as a new asset under
`src/assets/` and let the design's box stand, or (ii) reuse `BrandLogo` with
height-derived width and drop the fixed box. There is no `apps/frontend/public/`
and the standalone-runtime rule forbids external image hosts, so any new asset
must be imported from `src/assets/`.

## Brand-name conflict — needs a decision

Brand doc says **ARAI.co / ARAI.CO**. All shipped code says **"aray.co!"**:

```
apps/frontend/index.html:6                 <title>aray.co! — Telehealth</title>
features/auth/auth-screens.tsx:33,46,128   aray.co! home / footer / subtitle
features/public/public-screens.tsx:24,42,55
```

The polished design uses `ARAI.CO` and `<html lang="en">`. Landing copy,
`<title>`, logo `aria-label` and the trust disclaimer are all affected. The
disclaimer is a trust/safety requirement, not decoration. Not silently picking.

## Other confirmed facts

- `router.tsx:64` maps `/` to `PublicHomePlaceholder`. Layer 9 replaces it; it is
  the last placeholder-shaped route (Layer 8 sub-item 5 retired `PlaceholderPage`).
- `Button` `variant="cta"` is the ONLY white-on-coral surface
  (`components/ui/button.tsx:39`), scoped to hero/CTA scale with `size="xl"`. It
  does not extend to small coral text (badges, 13px buttons).
- Design copy (polished): eyebrow "Alagang Remote + AI"; h1 "May aray ka? /
  Mag-<em>ARAI</em> ka na."; lead "Hindi dapat tinitiis ang sakit. Sabihin lang
  ang nararamdaman, kami na ang bahala pumili ng doktor para sayo."; aria-label
  on `.parts` = "Pumili ng bahagi ng katawan"; placeholder "Masakit tiyan ko
  kagabi pa"; CTA "Mag-hanap ng Doctor"; helper default "Pumili o mag-type para
  makapagsimula."
- Design headline has a yellow underline swoosh on `<em>ARAI</em>`
  (`.brands em:after`, rotated -1.5deg, opacity .65).
- 7 body parts, exact labels: Ulo, Lalamunan, Dibdib, Tiyan, Likod, Balat, Iba pa.
- Design uses `overflow:hidden` on `html,body` and `height:100svh` — a strict
  no-scroll full-viewport layout with 4 breakpoints (900px, 520px, and
  `max-height:700px & max-width:900px`) plus `prefers-reduced-motion`.
- Design decorative bits: `.page:before` peach circle; `.hero-panel:before/.after`
  rings; `.dot-grid`; `.book-wrap:before` coral card rotated 1.8deg. All
  decorative — must stay `aria-hidden` and `pointer-events:none`.

## Standing reminders

- Run `scripts/db-clean-harness-users.sh --apply` before Jean reviews any admin
  screen. Not optional.
- Deferred items 1-9 remain open; item 5 (close-out visual pass, eight
  compositions) is marked DUE NOW.
