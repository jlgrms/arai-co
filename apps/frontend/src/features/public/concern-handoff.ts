/**
 * Layer 9 — the public landing page's "concern handoff".
 *
 * WHY THIS EXISTS
 * ---------------
 * The landing page is PUBLIC. `GET /doctors/match` and `GET /doctors/match/options`
 * are both guarded by JwtAuthGuard and answer 401 to an anonymous caller, so the
 * landing widget CANNOT produce a real match itself. Layer 4's guards are not to
 * be changed for a marketing page.
 *
 * The agreed flow (option (a)) is therefore a two-stage handoff:
 *
 *   1. Landing captures the concern ONLY. It does not match, and it does not
 *      pretend to. The step indicator shows "1 · Concern" as the single
 *      completed step, which is the truth.
 *   2. The concern is carried across the auth boundary. After the user signs in
 *      or registers as a PATIENT, the app fires the real match call and lands the
 *      user in the EXISTING Layer 6 guided-matching screen — it does not
 *      reimplement any of that flow.
 *
 * WHY SESSIONSTORAGE AND NOT THE URL
 * ----------------------------------
 * The concern can be free text ("masakit tiyan ko kagabi pa") and is therefore
 * potentially identifying health information. Putting it in a query string would
 * write it into browser history, the address bar, and any `Referer` header sent
 * to third parties — none of which is acceptable for health data, prototype or
 * not. sessionStorage keeps it on the device, scoped to the tab, and it is
 * cleared the moment it is consumed.
 *
 * sessionStorage (not localStorage) is deliberate: this is a single-trip
 * handoff, not a saved preference. If the user opens a second tab to register,
 * it starts clean rather than inheriting a stale half-finished concern.
 */

/** Storage key for the pending concern text. Namespaced to avoid collisions. */
export const PENDING_CONCERN_KEY = 'arai.pendingConcern';

/**
 * Marker placed in `location.state` when navigating to auth from the landing
 * widget. The auth screens already honour `state.from` for post-login redirect;
 * this is a separate, explicit flag so the intent survives even though the
 * concern itself lives in sessionStorage.
 */
export interface ConcernHandoffState {
  /** Where to send the patient once authenticated — the guided-matching flow. */
  from: string;
  /** True when the user arrived here from the landing quick-book widget. */
  fromQuickBook: true;
}

/** The existing Layer 6 guided-matching screen — the real matching flow. */
export const GUIDED_MATCHING_PATH = '/patient/book';

/**
 * Record the concern the user expressed on the landing page.
 *
 * Trims the input and stores nothing when it is blank: an empty concern is not a
 * handoff, it is an abandoned widget, and storing "" would later look like a real
 * (empty) query and send the user to the matching screen to see nothing.
 *
 * Failures are swallowed. sessionStorage throws in some privacy modes and when
 * the quota is exhausted; a lost handoff must degrade to "user just signs in
 * normally", never to a broken landing page.
 */
export function setPendingConcern(concern: string): void {
  const trimmed = concern.trim();
  if (!trimmed) return;
  try {
    window.sessionStorage.setItem(PENDING_CONCERN_KEY, trimmed);
  } catch {
    // Storage unavailable — the user still reaches the matching screen, they
    // just have to retype. Never surfaces as an error on the landing page.
  }
}

/**
 * Read and CLEAR the pending concern.
 *
 * Clearing on read is what makes the handoff single-use: a user who matches,
 * navigates away, and returns to /patient/book should not have the old concern
 * silently re-fired from a stale key. `removeItem` runs on every read path,
 * including the empty ones, so a blank value cannot persist either.
 */
export function consumePendingConcern(): string | null {
  try {
    const value = window.sessionStorage.getItem(PENDING_CONCERN_KEY);
    window.sessionStorage.removeItem(PENDING_CONCERN_KEY);
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

/** Read without clearing. Only for tests/diagnostics — not a production path. */
export function peekPendingConcern(): string | null {
  try {
    const value = window.sessionStorage.getItem(PENDING_CONCERN_KEY);
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

/** Drop any pending concern. Used when the handoff is explicitly abandoned. */
export function clearPendingConcern(): void {
  try {
    window.sessionStorage.removeItem(PENDING_CONCERN_KEY);
  } catch {
    // Nothing to do — see setPendingConcern.
  }
}

/**
 * Build the router state that carries quick-book intent into the auth screens.
 *
 * Serialisable by design: `location.state` is stored in history and must survive
 * a structured-clone. The concern itself is deliberately NOT included here — it
 * lives in sessionStorage precisely so it stays out of history.
 */
export function buildConcernHandoffState(): ConcernHandoffState {
  return { from: GUIDED_MATCHING_PATH, fromQuickBook: true };
}

/**
 * Narrow an arbitrary `location.state` to the quick-book handoff shape.
 *
 * Returns false for anything that is not exactly our marker, so a hand-crafted
 * or stale history entry cannot cause the matching screen to auto-fire a query
 * the user never asked for.
 */
export function isConcernHandoff(state: unknown): state is ConcernHandoffState {
  if (typeof state !== 'object' || state === null) return false;
  const candidate = state as Record<string, unknown>;
  return candidate.fromQuickBook === true && typeof candidate.from === 'string';
}
