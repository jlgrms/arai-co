/**
 * Guided matching (Layer 6 sub-item 3) — request/response contracts.
 *
 * Mirrors `DoctorsService.matchSymptom()` in
 * apps/backend/src/doctors/doctors.service.ts. Both endpoints are patient-only
 * (JwtAuthGuard) and read-only.
 *
 * Important: a successful match with ZERO results is still HTTP 200 —
 * `{ symptom: '...', matchedSpecialties: [], doctors: [] }`. "We couldn't match
 * that" is a normal outcome, not an error. The screen must not render it as a
 * failure; see `match-api-errors.ts` for the error path, which is separate.
 */

import type { DoctorPublic } from './discover-types';

/** GET /doctors/match?symptom=... */
export interface MatchResult {
  /** The symptom text echoed back exactly as it was sent. */
  symptom: string;
  /** Deduplicated specialties the input mapped to. Empty when nothing matched. */
  matchedSpecialties: string[];
  /** APPROVED doctors belonging to any of `matchedSpecialties`. */
  doctors: DoctorPublic[];
  /**
   * Which matcher produced this result. Absent on the deterministic
   * GET /doctors/match response (it predates the field and is left untouched);
   * 'ai' on POST /doctors/match-ai so the screen can label the answer honestly.
   */
  engine?: 'ai';
}

/** One row of GET /doctors/match/options. */
export interface MatchOption {
  /** The stored symptom/concern phrase, in its original casing. */
  symptom: string;
  /** Specialties this phrase maps to (usually one, sometimes several). */
  specialties: string[];
}

/** GET /doctors/match/options */
export interface MatchOptionsResponse {
  options: MatchOption[];
}

/**
 * Doctors grouped under the specialty that matched them, in the order the
 * backend reported the specialties.
 *
 * The backend returns a flat `doctors` array sorted by name. Presenting it flat
 * loses the reason each doctor is there — with several specialties in play the
 * patient can't see which of their concerns pulled in which doctor. Grouping
 * restores that link.
 *
 * Doctors whose specialization is somehow not in `matchedSpecialties` are
 * dropped rather than shown under a misleading heading: the backend guarantees
 * every returned doctor belongs to a matched specialty, so an orphan means the
 * payload is inconsistent and inventing a group for it would be worse than
 * omitting it.
 */
export interface SpecialtyGroup {
  specialization: string;
  doctors: DoctorPublic[];
}

export function groupDoctorsBySpecialty(result: MatchResult): SpecialtyGroup[] {
  return result.matchedSpecialties
    .map((specialization) => ({
      specialization,
      doctors: result.doctors.filter((d) => d.specialization === specialization),
    }))
    .filter((group) => group.doctors.length > 0);
}

/** True when the request succeeded but nothing matched. */
export function isEmptyMatch(result: MatchResult): boolean {
  return result.doctors.length === 0;
}

/**
 * Build the request path for GET /doctors/match.
 *
 * The symptom is trimmed (a lone-whitespace query is the same as no query) but
 * NOT case-folded — the backend normalizes for comparison while echoing the
 * original text back, and lowercasing here would discard the patient's wording
 * for no benefit. `URLSearchParams` handles escaping, so punctuation and
 * non-ASCII input are safe.
 */
export function buildMatchPath(symptom: string): string {
  const params = new URLSearchParams();
  params.set('symptom', symptom.trim());
  return `/doctors/match?${params.toString()}`;
}

/** POST /doctors/match-ai — POC AI-assisted matching. Body is `{ symptom }`. */
export const MATCH_AI_PATH = '/doctors/match-ai';
