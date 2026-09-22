import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { BrandLogo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  BODY_PARTS,
  isReady,
  resolveConcern,
  type BodyPart,
} from './body-parts';
import {
  buildConcernHandoffState,
  setPendingConcern,
  GUIDED_MATCHING_PATH,
} from './concern-handoff';

/**
 * Layer 9 — Product Website: the public landing page.
 *
 * TRANSLATION NOTES (design -> our design system)
 * ------------------------------------------------
 * The polished design (ARAI.CO_landing_polished.html) is a full-page,
 * no-scroll composition. Per the agreed decision, we translate its LAYOUT AND
 * STRUCTURE and map its colours onto the EXISTING project tokens. The design's
 * own palette is NOT adopted: it disagrees with arai-brand-design-reference.md
 * (which is normative) on 8 of 10 colours, and adopting it would repaint every
 * screen delivered in Layers 2-8.
 *
 *   design hex   -> token
 *   #f8fbf8      -> bg-background / bg-surface
 *   #132b3e      -> text-ink
 *   #ff705b      -> bg-accent / text-accent   (brand coral #FF7F50)
 *   #dff7ec      -> bg-green-tint
 *   #ffe0d2      -> bg-danger-tint
 *   #dbe6e1      -> border-border
 *   #526777      -> text-muted-foreground
 *
 * Two design-only fixes applied deliberately:
 *   - The design's `.step` colour (#91a0aa on white) measures 2.69:1, below AA.
 *     Steps use text-muted-foreground (5.41:1 on our background) instead.
 *   - The design's disabled CTA (#7b8983 on #d9dfdc) is 2.70:1. Disabled
 *     controls are exempt under WCAG, and we keep a disabled state, but we use
 *     muted-foreground on a muted surface for better legibility.
 *
 * WHAT THIS PAGE DOES NOT DO
 * --------------------------
 * It does not match. The match endpoints require authentication and Layer 4's
 * guards are not being changed, so the widget captures the concern, carries it
 * across the auth boundary, and hands off to the real Layer 6 flow. The step
 * indicator shows exactly that: step 1 is the only thing this page completes.
 *
 * The design's own script faked a match with a 1600ms setTimeout. That is
 * replaced by a real handoff; see concern-handoff.ts.
 */

const LOGIN_PATH = '/login';

/**
 * Decorative background wash for the hero panel — the design's mint gradient.
 * Rendered as a CSS gradient from existing tokens rather than a new colour, and
 * marked aria-hidden: it carries no meaning.
 */
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

/** One body-part chip. Single-select, `aria-pressed` like the design. */
function BodyPartButton({
  part,
  selected,
  onSelect,
}: {
  part: BodyPart;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-[72px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border px-1 py-2 text-[11px] font-semibold transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected
          ? 'border-accent bg-danger-tint text-ink shadow-[inset_0_0_0_1px_var(--color-accent)]'
          : 'border-border bg-surface text-ink hover:-translate-y-0.5 hover:border-accent hover:shadow-sm',
      )}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={cn('size-[23px]', selected ? 'text-accent' : 'text-current')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={part.icon} />
      </svg>
      {part.label}
    </button>
  );
}

/**
 * The three-step indicator.
 *
 * Honest by construction: `completed` is how many steps this page actually
 * finishes, and steps beyond that are rendered as not-yet-done. The landing page
 * only ever completes step 1, so 2 and 3 stay unfilled — they are not this
 * page's to claim. This is the visible contract of decision (a).
 */
function StepIndicator({ completed }: { completed: number }) {
  const steps = ['1 · Concern', '2 · Doctor', '3 · Schedule'];
  return (
    <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Booking progress">
      {steps.map((label, index) => {
        const done = index < completed;
        return (
          <li
            key={label}
            className={cn(
              'relative pt-3 text-[10px] font-bold uppercase tracking-[0.08em]',
              done ? 'text-ink' : 'text-muted-foreground',
            )}
            aria-current={index === completed - 1 ? 'step' : undefined}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-0 top-0 h-[3px] w-full rounded-full',
                done ? 'bg-accent' : 'bg-border',
              )}
            />
            {label}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The quick-book widget.
 *
 * Real behaviour, no simulated match: selecting a part or typing enables the
 * CTA; submitting stores the concern and routes to auth. The helper text says
 * what will actually happen rather than claiming a match has occurred.
 */
function QuickBookWidget() {
  const navigate = useNavigate();
  const [selected, setSelected] = React.useState<BodyPart | null>(null);
  const [typed, setTyped] = React.useState('');

  const ready = isReady(selected, typed);
  const concern = resolveConcern(selected, typed);

  // Steps completed by THIS page. Step 1 is done once there is a concern; steps
  // 2 and 3 belong to the authenticated Layer 6 flow and are never claimed here.
  const completed = ready ? 1 : 0;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    // Persist across the auth boundary, then hand off. Nothing is matched here.
    setPendingConcern(concern);
    navigate(LOGIN_PATH, { state: buildConcernHandoffState() });
  }

  const helper = ready
    ? 'Handa na — mag-sign in para hanapin ang tamang doktor.'
    : 'Pumili o mag-type para makapagsimula.';

  return (
    <div className="relative lg:-ml-14">
      {/* Coral card peeking out behind the widget (design .book-wrap:before). */}
      <div
        aria-hidden="true"
        className="absolute inset-x-[-14px] inset-y-[15px] -z-10 rotate-[1.8deg] rounded-[32px] bg-accent/15"
      />
      <form
        onSubmit={handleSubmit}
        className="rounded-[30px] border border-border bg-surface/95 p-5 shadow-xl backdrop-blur sm:p-7"
      >
        <StepIndicator completed={completed} />

        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.13em] text-danger-text">
          Quick Book
        </p>
        <h2 className="mb-5 font-heading text-2xl font-extrabold tracking-tight text-ink sm:text-[37px] sm:leading-[1.12]">
          Saan ka umaaray?
        </h2>

        <div
          role="group"
          aria-label="Pumili ng bahagi ng katawan"
          className="mb-3.5 grid grid-cols-4 gap-2"
        >
          {BODY_PARTS.map((part) => (
            <BodyPartButton
              key={part.id}
              part={part}
              selected={selected?.id === part.id}
              onSelect={() => setSelected((prev) => (prev?.id === part.id ? null : part))}
            />
          ))}
        </div>

        <label htmlFor="concern" className="sr-only">
          Ilarawan ang nararamdaman
        </label>
        <textarea
          id="concern"
          name="concern"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Masakit tiyan ko kagabi pa"
          className="block h-[75px] w-full resize-none rounded-xl border border-border bg-background/60 px-3.5 py-3 text-sm leading-snug text-ink transition placeholder:text-muted-foreground focus-visible:border-ink focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />

        <Button
          type="submit"
          variant="cta"
          disabled={!ready}
          className="mt-3 min-h-[54px] w-full"
        >
          Mag-hanap ng Doctor
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-[18px]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Button>

        <p aria-live="polite" className="mt-2 text-center text-[11px] text-muted-foreground">
          {helper}
        </p>
      </form>
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
              className="grid size-7 place-items-center rounded-full bg-surface shadow-sm"
            >
              <span className="size-2 rounded-full bg-green shadow-[0_0_0_4px_rgb(6_214_160/0.15)]" />
            </span>
            Simulan sa nararamdaman mo
          </div>
        </section>

        <QuickBookWidget />
      </main>

      {/*
        The design has no footer. One is added anyway: the trust disclaimer is a
        Layer 9 scope requirement, and it must be reachable without scrolling the
        hero. It names the Layer 6 flow the widget hands off to.
      */}
      <footer className="border-t border-border px-6 py-5 text-center text-xs text-muted-foreground sm:px-10">
        ARAI.co — prototype for demonstration only. Not for real medical use.{' '}
        <Link to={GUIDED_MATCHING_PATH} className="underline underline-offset-4 hover:text-ink">
          Find a doctor
        </Link>
      </footer>
    </div>
  );
}
