// Pure, deterministic symptom→specialty matching. No Prisma, no Nest, no HTTP.
// The service fetches rows and passes them in; this file only does string logic.

export interface SymptomSpecialtyRow {
  symptomOrConcern: string;
  specialty: string;
}

// Normalize for deterministic comparison: trim + collapse internal whitespace + lowercase.
export function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Returns the matched specialties for a free-text symptom/concern description.
 * Deterministic normalized contains-match in BOTH directions:
 *   - stored phrase contained in the input ("chest pain and dizziness" matches "chest pain")
 *   - input contained in the stored phrase ("chest" matches "chest pain")
 * Returns a deduplicated, stable-ordered list of specialties (original casing preserved).
 */
export function matchSymptomToSpecialties(
  input: string,
  map: SymptomSpecialtyRow[],
): string[] {
  const needle = normalize(input);
  if (needle.length === 0) return [];

  const specialties: string[] = [];
  const seen = new Set<string>();
  for (const row of map) {
    const phrase = normalize(row.symptomOrConcern);
    if (phrase.length === 0) continue;
    if (needle.includes(phrase) || phrase.includes(needle)) {
      const key = normalize(row.specialty);
      if (!seen.has(key)) {
        seen.add(key);
        specialties.push(row.specialty);
      }
    }
  }
  return specialties;
}
