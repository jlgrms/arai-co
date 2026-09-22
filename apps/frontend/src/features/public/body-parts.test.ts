import { describe, expect, it } from 'vitest';

import { BODY_PARTS, isReady, resolveConcern } from './body-parts';

/**
 * The seeded symptom→specialty vocabulary, mirrored from
 * apps/backend/prisma/seed.ts (the `symptomOrConcern` rows) and the options
 * returned by GET /doctors/match/options.
 *
 * This is duplicated ON PURPOSE. The bug it guards against shipped once already:
 * every canned concern was a natural Filipino phrase ("sakit ng ulo") while the
 * seeded table is English ("anxiety"), so all six paths resolved to zero doctors
 * and the widget silently matched nothing. A frontend unit test cannot call the
 * real API, but it CAN assert the concerns are drawn from the right vocabulary.
 *
 * `headache`, `migraine`, `sore throat` and `stomach ache` were added to the
 * seed specifically so Ulo / Lalamunan / Tiyan have a clinically sensible
 * target instead of borrowing the nearest English word.
 *
 * If the seed gains or renames symptoms, update this list — and re-run
 * `scripts/evidence-layer9-landing.mjs`, which re-checks against the live API
 * and will fail if this list has drifted from reality.
 */
const SEEDED_VOCABULARY = [
  'acne',
  'anxiety',
  'chest pain',
  'child fever',
  'cough',
  'depression',
  'eczema',
  'fatigue',
  'fever',
  'headache',
  'high blood pressure',
  'insomnia',
  'migraine',
  'palpitations',
  'rash',
  'sore throat',
  'stomach ache',
  'vaccination',
];

describe('BODY_PARTS', () => {
  it('has the 7 parts from the design, in order', () => {
    expect(BODY_PARTS.map((p) => p.label)).toEqual([
      'Ulo',
      'Lalamunan',
      'Dibdib',
      'Tiyan',
      'Likod',
      'Balat',
      'Iba pa',
    ]);
  });

  it('gives every part a unique id', () => {
    const ids = BODY_PARTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every part non-empty icon geometry', () => {
    for (const part of BODY_PARTS) {
      expect(part.icon.trim().length).toBeGreaterThan(0);
    }
  });

  it('gives every part except "Iba pa" a canned concern phrase', () => {
    for (const part of BODY_PARTS) {
      if (part.id === 'iba-pa') {
        expect(part.concern).toBe('');
      } else {
        expect(part.concern.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('does not send the raw label as the concern for any part', () => {
    // The labels are body parts ("Ulo"); the matcher's vocabulary is symptom
    // phrases. If a label leaked through as the concern we would be querying the
    // matcher with a word it cannot resolve.
    for (const part of BODY_PARTS) {
      if (part.concern) expect(part.concern).not.toBe(part.label);
    }
  });

  it('draws every canned concern from the SEEDED vocabulary', () => {
    // This is the regression test for the dead-end bug. An empty-match result is
    // a legitimate outcome for FREE TEXT, but a canned concern is a promise the
    // UI makes: tapping "Tiyan" must produce doctors. If a concern is not in the
    // seeded table, that promise is broken and the widget is a dead end.
    for (const part of BODY_PARTS) {
      if (!part.concern) continue;
      expect(
        SEEDED_VOCABULARY,
        `"${part.label}" sends "${part.concern}", which is not in the seeded symptom table — this part would match nothing`,
      ).toContain(part.concern);
    }
  });

  it('sends each part a clinically sensible concern, not a nearest-available substitute', () => {
    // Regression test for the imprecise mapping. Ulo ("head") once sent
    // "anxiety" and Tiyan ("stomach") once sent "fever" — real seeded phrases,
    // so they resolved to doctors, but the WRONG doctors: tapping "head" showed
    // a psychiatrist. These four are pinned because they are the ones whose
    // meaning is genuinely load-bearing.
    const byId = Object.fromEntries(BODY_PARTS.map((p) => [p.id, p.concern]));
    expect(byId['ulo']).toBe('headache');
    expect(byId['lalamunan']).toBe('sore throat');
    expect(byId['tiyan']).toBe('stomach ache');
    expect(byId['dibdib']).toBe('chest pain');
    expect(byId['balat']).toBe('rash');
  });

  it('does not route a symptom through an unrelated specialty', () => {
    // Ulo and Tiyan must never send a psychiatric or fever concern again.
    const byId = Object.fromEntries(BODY_PARTS.map((p) => [p.id, p.concern]));
    expect(byId['ulo']).not.toBe('anxiety');
    expect(byId['ulo']).not.toBe('depression');
    expect(byId['tiyan']).not.toBe('fever');
    expect(byId['tiyan']).not.toBe('child fever');
  });

  it('keeps the concern vocabulary free of the Filipino phrasing that broke it', () => {
    // Guards the specific regression: every concern must be an English seeded
    // phrase. The Filipino body-part LABELS are fine — only the concerns are
    // required to be English, because the seeded table is.
    for (const part of BODY_PARTS) {
      if (!part.concern) continue;
      expect(part.concern).toMatch(/^[a-z ]+$/);
    }
  });
});

describe('resolveConcern', () => {
  const ulo = BODY_PARTS.find((p) => p.id === 'ulo')!;

  it('returns the typed text when there is any', () => {
    expect(resolveConcern(ulo, 'masakit ang tiyan ko')).toBe('masakit ang tiyan ko');
  });

  it('prefers typed text over the selected part', () => {
    // The user's own words are always more specific than a body-part shortcut.
    expect(resolveConcern(ulo, 'pulsating pain behind the left eye')).toBe(
      'pulsating pain behind the left eye',
    );
  });

  it('falls back to the part concern when nothing was typed', () => {
    expect(resolveConcern(ulo, '')).toBe(ulo.concern);
  });

  it('trims typed text', () => {
    expect(resolveConcern(ulo, '   cough   ')).toBe('cough');
  });

  it('treats whitespace-only typing as no typing', () => {
    expect(resolveConcern(ulo, '    ')).toBe(ulo.concern);
  });

  it('returns empty for "Iba pa" with no typed text', () => {
    const ibaPa = BODY_PARTS.find((p) => p.id === 'iba-pa')!;
    expect(resolveConcern(ibaPa, '')).toBe('');
  });

  it('still uses typed text for "Iba pa"', () => {
    const ibaPa = BODY_PARTS.find((p) => p.id === 'iba-pa')!;
    expect(resolveConcern(ibaPa, 'namamaga ang gilagid')).toBe('namamaga ang gilagid');
  });

  it('returns empty when nothing is selected and nothing is typed', () => {
    expect(resolveConcern(null, '')).toBe('');
  });

  it('returns typed text when nothing is selected', () => {
    expect(resolveConcern(null, 'cough')).toBe('cough');
  });
});

describe('isReady', () => {
  const ulo = BODY_PARTS.find((p) => p.id === 'ulo')!;
  const ibaPa = BODY_PARTS.find((p) => p.id === 'iba-pa')!;

  it('is false with no selection and no typing', () => {
    expect(isReady(null, '')).toBe(false);
  });

  it('is true with a selection alone', () => {
    expect(isReady(ulo, '')).toBe(true);
  });

  it('is true with typing alone', () => {
    expect(isReady(null, 'cough')).toBe(true);
  });

  it('is false for whitespace-only typing with no selection', () => {
    expect(isReady(null, '   ')).toBe(false);
  });

  it('is false for "Iba pa" with no typing — that part must be described', () => {
    expect(isReady(ibaPa, '')).toBe(false);
  });

  it('is true for "Iba pa" once described', () => {
    expect(isReady(ibaPa, 'namamaga ang gilagid')).toBe(true);
  });

  it('agrees with resolveConcern for every part', () => {
    for (const part of BODY_PARTS) {
      expect(isReady(part, '')).toBe(resolveConcern(part, '').length > 0);
    }
  });
});
