/**
 * Layer 9 — the landing quick-book widget's body-part selector.
 *
 * SOURCE OF TRUTH
 * ---------------
 * These 7 parts and their icon paths come from the polished design
 * (ARAI.CO_landing_polished.html). They are a UI affordance ONLY: picking "Ulo"
 * is a shortcut for typing a concern, and its `concern` string is what actually
 * flows into matching.
 *
 * IMPORTANT — the LABELS are Filipino; the CONCERNS are English.
 * ------------------------------------------------------------------
 * This is deliberate and load-bearing, not an oversight. The seeded
 * symptom→specialty table (`GET /doctors/match/options`, see
 * apps/backend/prisma/seed.ts) is entirely ENGLISH: "cough", "chest pain",
 * "rash", … The design's own body-part labels are Filipino.
 *
 * `matchSymptomToSpecialties` does a normalized contains-match in both
 * directions. It tolerates noise ("chest" matches "chest pain"), but it can NOT
 * cross languages: no Filipino phrase contains an English one or vice versa.
 * Every canned Filipino concern therefore resolved to ZERO doctors — the widget
 * looked wired end to end and could not produce a single match.
 *
 * So `concern` must hold a phrase that is ACTUALLY in the seeded table. Only
 * the labels keep the design's voice. Verified against the live API: each of the
 * six canned concerns below resolves to at least one specialty.
 *
 * KNOWN IMPRECISION: the seed has no entry for "headache" or "stomach ache", so
 * `Ulo` (head) borrows "anxiety" and `Tiyan` (stomach) borrows "fever". These
 * are the nearest available seeded phrases, not clinically accurate mappings —
 * a user tapping "Ulo" sees Psychiatry. Fixing that properly means adding
 * symptom rows to the seed, which is a Layer 6/7 change; see DEFERRED.md.
 *
 * A part whose concern does not match returns the normal empty-match state,
 * which the Layer 6 screen already handles as a non-error outcome.
 */

export interface BodyPart {
  /** Stable id, used for React keys and tests. */
  id: string;
  /** Filipino label shown on the chip, exactly as in the design. */
  label: string;
  /**
   * The free-text concern sent to matching when this part is chosen.
   *
   * MUST be a phrase present in the seeded symptom→specialty table, otherwise
   * the widget silently dead-ends. Do not "improve" these into more natural
   * Filipino — that is what broke them. `body-parts.test.ts` guards this, and
   * `scripts/evidence-layer9-landing.mjs` re-verifies it against the live API.
   */
  concern: string;
  /** Single-path SVG icon geometry, from the design. */
  icon: string;
}

/**
 * The 7 parts, in the design's order. Path data is taken verbatim from the
 * design's inline SVGs so the icons match; each is drawn on a 24x24 viewBox with
 * `fill:none` and stroked with `currentColor`.
 */
export const BODY_PARTS: readonly BodyPart[] = [
  {
    id: 'ulo',
    label: 'Ulo',
    concern: 'anxiety',
    icon: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM8 21v-5a4 4 0 0 1 8 0v5',
  },
  {
    id: 'lalamunan',
    label: 'Lalamunan',
    concern: 'cough',
    icon: 'M8 3c0 4 1 6 4 7 3-1 4-3 4-7M9 21v-5m6 5v-5M8 13h8',
  },
  {
    id: 'dibdib',
    label: 'Dibdib',
    concern: 'chest pain',
    icon: 'M12 20S4 15 4 9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 6-6 11-6 11Z',
  },
  {
    id: 'tiyan',
    label: 'Tiyan',
    concern: 'fever',
    icon: 'M8 3v5c0 2-2 3-2 6a6 6 0 0 0 12 0c0-3-2-4-2-6V3M9 14c2 1 4 1 6 0',
  },
  {
    id: 'likod',
    label: 'Likod',
    concern: 'fatigue',
    icon: 'M8 3v5l-2 5 2 8m8-18v5l2 5-2 8M9 11h6m-6 5h6',
  },
  {
    id: 'balat',
    label: 'Balat',
    concern: 'rash',
    icon: 'M12 3c4 0 7 3 7 7 0 6-4 10-7 11-3-1-7-5-7-11 0-4 3-7 7-7Z M9 9h.01M15 12h.01M11 16h.01',
  },
  {
    id: 'iba-pa',
    label: 'Iba pa',
    concern: '',
    icon: 'M5 12h14M12 5v14',
  },
] as const;

/**
 * Resolve the concern to send to matching for a given selection.
 *
 * "Iba pa" deliberately has no canned concern: it means "none of these describe
 * me", so the honest answer is whatever the user types. Returning the label as a
 * fallback would send the literal string "Iba pa" to the matcher, which would
 * find nothing and look like a bug rather than an unhandled case.
 */
export function resolveConcern(part: BodyPart | null, typed: string): string {
  const typedTrimmed = typed.trim();
  if (typedTrimmed) return typedTrimmed;
  return part?.concern ?? '';
}

/** True when the widget has enough input to proceed. */
export function isReady(part: BodyPart | null, typed: string): boolean {
  return resolveConcern(part, typed).length > 0;
}
