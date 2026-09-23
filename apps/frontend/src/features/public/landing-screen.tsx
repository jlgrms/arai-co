import { Link, useNavigate } from 'react-router-dom';

import { BrandLogo } from '@/components/brand/logo';
import { SignInForm } from '@/features/auth/sign-in-form';
import { useAuth } from '@/features/auth/auth-context';
import { HOME_BY_ROLE } from '@/app/nav';
import * as React from 'react';

/**
 * Layer 9 — Product Website: the public landing page.
 *
 * TRANSLATION NOTES (design -> our design system)
 * ------------------------------------------------
 * The polished design (ARAI.CO_landing_polished.html) is a full-page,
 * no-scroll composition. Per the agreed decision, we translate its LAYOUT AND
 * STRUCTURE and map its colours onto the EXISTING project tokens. The design's
 * own palette is NOT adopted: it disagrees with arai-brand-design-reference.md
 * (arai-design-guideline-v3.md, which is normative) on 8 of 10 colours, and
 * adopting it would repaint every screen delivered in Layers 2-8.
 *
 * v3 ADOPTION: the project tokens were migrated to the v3 palette in Layer 10
 * (see index.css). The mapping below is therefore now an identity on colour:
 * the "design hex" column below is the same hex v3 specifies, and it arrives
 * through the v3 token on the right. The landing page's rendered output is
 * unchanged by that migration — it already used tokens rather than raw hex.
 *
 *   v3 hex   -> token
 *   #f5f8f6  -> bg-background / bg-surface   (--surface-page)
 *   #132b3e  -> text-ink                     (--ink)
 *   #ff705b  -> bg-accent / text-accent      (--brand-coral)
 *   #dff7ec  -> bg-green-tint                (--brand-mint)
 *   #ffe0d2  -> bg-danger-tint               (--accent-peach)
 *   #dde7e2  -> border-border                (--border-default)
 *   #536979  -> text-muted-foreground        (--ink-muted)
 *
 * Two design-only fixes applied deliberately:
 *   - The design's `.step` colour (#91a0aa on white) measures 2.69:1, below AA.
 *     Steps use text-muted-foreground (5.41:1 on our background) instead.
 *   - The design's disabled CTA (#7b8983 on #d9dfdc) is 2.70:1. Disabled
 *     controls are exempt under WCAG, and we keep a disabled state, but we use
 *     muted-foreground on a muted surface for better legibility.
 *
 * THE HERO PANEL IS NOW SIGN-IN, NOT QUICK-BOOK
 * ---------------------------------------------
 * The hero's quick-book widget (body-part chips + free-text concern, handing
 * off across the auth boundary via sessionStorage) has been RETIRED. The panel
 * now holds a sign-in form in the same visual slot: same card dimensions,
 * rounded corners, shadow and off-axis coral backing card, so the hero layout
 * is unchanged and only the contents of the panel differ.
 *
 * The form is NOT reimplemented here. It is the same `SignInForm` the dedicated
 * /login route renders, which owns the login() call, the parseAuthError mapping
 * (401 invalid credentials / 403 suspended account) and the post-login redirect
 * to HOME_BY_ROLE[role]. Two sign-in surfaces, one implementation.
 *
 * What this page no longer does: capture a concern, or know anything about
 * matching. There is no anchor into a matching flow, because there is no
 * matching entry point here any more.
 */

/** Decorative background wash for the hero panel — the design's mint gradient. */
function HeroDecor() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Soft mint wash, the design's hero-panel gradient. */}
      <div className="absolute inset-0 bg-gradient-to-br from-green-tint/70 via-green-tint to-green-tint/80" />
      {/* Concentric rings, bottom-right (design .hero-panel:before). */}
      <div className="absolute -bottom-40 -right-32 size-[360px] rounded-full border border-ink/10 shadow-[0_0_0_54px_rgb(255_255_255/0.16),0_0_0_108px_rgb(255_255_255/0.10)]" />
      {/* Warm circle, top-left (design .hero-panel:after). */}
      <div className="absolute -left-14 -top-16 size-[150px] rounded-full bg-yellow/20" />
      {/* Dot grid (design .dot-grid), hidden on small screens. */}
      <div
        className="absolute right-10 top-9 hidden size-[92px] opacity-[0.18] lg:block"
        style={{
          backgroundImage: 'radial-gradient(var(--color-ink) 1.5px, transparent 1.5px)',
          backgroundSize: '14px 14px',
        }}
      />
    </div>
  );
}

/**
 * The hero's sign-in panel.
 *
 * Replaces the retired quick-book widget in the SAME slot, keeping the exact
 * card treatment (the `rounded-[30px]` surface, `shadow-xl`, and the rotated
 * coral backing card behind it) so the hero's layout and proportions are
 * unchanged. Only the panel's contents are new.
 *
 * An already-signed-in visitor is sent to their role home rather than being
 * shown a form they have no use for — the same courtesy /login extends.
 */
function HeroSignInPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (user) navigate(HOME_BY_ROLE[user.role], { replace: true });
  }, [user, navigate]);

  return (
    <div className="relative lg:-ml-14">
      {/* Coral card peeking out behind the widget (design .book-wrap:before).
          Kept as-is: it is part of the panel's established visual slot. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-[-14px] inset-y-[15px] -z-10 rotate-[1.8deg] rounded-[32px] bg-accent/15"
      />
      <div className="rounded-[30px] border border-border bg-surface/95 p-5 shadow-xl backdrop-blur sm:p-7">
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.13em] text-danger-text">
          Sign in
        </p>
        <h2 className="mb-5 font-heading text-2xl font-extrabold tracking-tight text-ink sm:text-[37px] sm:leading-[1.12]">
          Maligayang pagbabalik.
        </h2>

        <SignInForm
          idPrefix="hero-login"
          footer={
            <p className="text-center text-[13px] text-muted-foreground">
              Wala pang account?{' '}
              <Link
                to="/register/patient"
                className="font-medium text-ink underline underline-offset-4"
              >
                Register as Patient
              </Link>{' '}
              ·{' '}
              <Link
                to="/register/doctor"
                className="font-medium text-ink underline underline-offset-4"
              >
                Register as Doctor
              </Link>
            </p>
          }
        />
      </div>
    </div>
  );
}

/**
 * The public landing page. Replaces PublicHomePlaceholder at `/`.
 */
export function LandingScreen() {
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background">
      {/* Peach wash bleeding off the top-right (design .page:before). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-48 -top-60 -z-10 size-[440px] rounded-full bg-danger-tint/55"
      />

      <header className="flex h-[92px] w-full items-center justify-between gap-6 px-6 sm:px-10">
        <Link to="/" aria-label="ARAI.co home" className="shrink-0">
          {/* Native 2.83:1 aspect ratio, sized by height — no fixed box. */}
          <BrandLogo size="lg" />
        </Link>
        <div className="flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-2 text-[11px] font-semibold text-muted-foreground backdrop-blur sm:text-xs">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-[15px] shrink-0 text-blue"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          <span className="hidden sm:inline">Fictional prototype · No real patient data</span>
          <span className="sr-only sm:hidden">Fictional prototype, no real patient data</span>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1220px] flex-1 grid-cols-1 items-center gap-8 px-6 pb-10 sm:px-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(420px,0.88fr)] lg:gap-14">
        <section
          aria-labelledby="hero-title"
          className="relative overflow-hidden rounded-[38px] px-7 py-11 sm:px-14 sm:py-16 lg:self-stretch"
        >
          <HeroDecor />
          <div className="relative z-10 max-w-[650px]">
            <p className="mb-4 inline-flex items-center gap-2.5 font-heading text-xs font-extrabold uppercase tracking-[0.13em] text-ink">
              <span aria-hidden="true" className="h-1 w-7 rounded-full bg-accent" />
              Alagang Remote + AI
            </p>
            <h1
              id="hero-title"
              className="font-heading text-[clamp(2.4rem,6vw,5.25rem)] font-extrabold leading-[0.98] tracking-[-0.06em] text-ink"
            >
              May aray ka?
              <br />
              Mag-
              <em className="relative not-italic text-accent">
                ARAI
                {/* Yellow underline swoosh (design h1 em:after). */}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0.5 -bottom-1.5 -z-10 h-2 rotate-[-1.5deg] rounded-full bg-yellow opacity-65"
                />
              </em>{' '}
              ka na.
            </h1>
            <p className="mt-6 max-w-[600px] text-base leading-relaxed text-muted-foreground sm:text-lg">
              Hindi dapat tinitiis ang sakit. Sabihin lang ang nararamdaman, kami na ang bahala
              pumili ng doktor para sayo.
            </p>
          </div>
          <div className="relative z-10 mt-8 hidden w-max items-center gap-2.5 rounded-full border border-ink/10 bg-surface/60 px-3.5 py-2.5 text-xs font-bold text-muted-foreground sm:inline-flex">
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-full bg-surface shadow-small"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-accent-green shadow-[0_0_0_4px_rgb(189_235_210/0.35)]"
              />
            </span>
            Simulan sa nararamdaman mo
          </div>
        </section>

        <HeroSignInPanel />
      </main>

      {/*
        The design has no footer. One is added anyway: the trust disclaimer is a
        Layer 9 scope requirement, and it must be reachable without scrolling the
        hero.

        The former "Find a doctor" link pointed at GUIDED_MATCHING_PATH
        (/patient/book) — the destination the quick-book widget handed off to.
        With the widget retired there is no longer anything on this page that
        leads there, and the route is patient-only, so an anonymous visitor
        clicking it was bounced straight back to /login. It now points at the
        landing page's own register chooser instead, which is a visitor's actual
        next step from here.
      */}
      <footer className="border-t border-border px-6 py-5 text-center text-xs text-muted-foreground sm:px-10">
        ARAI.co — prototype for demonstration only. Not for real medical use.{' '}
        <Link to="/register" className="underline underline-offset-4 hover:text-ink">
          Create an account
        </Link>
      </footer>
    </div>
  );
}
