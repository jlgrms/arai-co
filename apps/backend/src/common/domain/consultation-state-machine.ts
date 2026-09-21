// Pure, deterministic consultation session state machine. No Prisma/Nest/HTTP.
// Single source of truth for the SCHEDULED -> JOINED -> IN_PROGRESS -> COMPLETED
// transition rules (S5.2/S5.3 "tracks scheduled -> joined -> in-progress ->
// completed states"). ConsultationsService is a thin orchestrator over this.
//
// Rules:
//   - No skipping states, no moving backward.
//   - SCHEDULED -> JOINED is the first participant to join (either role).
//   - JOINED -> IN_PROGRESS requires BOTH participants present (Flag B).
//   - COMPLETED is doctor-only and terminal (Flag C).
//   - Anything else is an invalid transition (surfaced as 409 by the caller).

export type ConsultationState =
  | 'SCHEDULED'
  | 'JOINED'
  | 'IN_PROGRESS'
  | 'COMPLETED';

export type ParticipantRole = 'PATIENT' | 'DOCTOR';

// Who is currently present in the session. Derived/updated by the service.
export interface Presence {
  patientPresent: boolean;
  doctorPresent: boolean;
}

// The join outcome: the session's new state plus the updated presence flags,
// so the service can persist both `state` and the per-role joinedAt columns
// atomically without re-deriving anything.
export interface JoinResult {
  state: ConsultationState;
  presence: Presence;
  // true when this call changed the state (false = idempotent no-op).
  changed: boolean;
}

export type TransitionReason =
  | 'TERMINAL'
  | 'ALREADY_IN_PROGRESS'
  | 'NOT_JOINED'
  | 'INVALID_TRANSITION';

export interface TransitionError {
  ok: false;
  reason: TransitionReason;
}

export interface CompletionResult {
  ok: true;
  state: 'COMPLETED';
}

export const isTerminal = (state: ConsultationState): boolean =>
  state === 'COMPLETED';

// ---- Join ---------------------------------------------------------------------
// Applies a participant joining. Handles idempotency (same participant re-joining
// in a non-terminal state is a no-op) and the both-present promotion to IN_PROGRESS.
// An already-IN_PROGRESS session stays IN_PROGRESS (a late second-join or re-join
// does not error; the consultation is simply ongoing).
export function applyJoin(
  state: ConsultationState,
  presence: Presence,
  role: ParticipantRole,
): JoinResult {
  if (isTerminal(state)) {
    // Caller maps this to 409.
    throw new InvalidTransitionError('TERMINAL');
  }

  const nextPresence: Presence = { ...presence };
  if (role === 'PATIENT') nextPresence.patientPresent = true;
  else nextPresence.doctorPresent = true;

  // Already past SCHEDULED: participant joins are absorbed. If both are now
  // present we ensure IN_PROGRESS; otherwise the state is unchanged.
  if (state === 'SCHEDULED') {
    return { state: 'JOINED', presence: nextPresence, changed: true };
  }

  // state === 'JOINED' or 'IN_PROGRESS'
  if (nextPresence.patientPresent && nextPresence.doctorPresent) {
    const changed = state !== 'IN_PROGRESS';
    return { state: 'IN_PROGRESS', presence: nextPresence, changed };
  }

  return { state, presence: nextPresence, changed: false };
}

// ---- Complete -----------------------------------------------------------------
// Doctor-only, from IN_PROGRESS (or JOINED, to allow a short consult that never
// reached the both-present promotion -- but never from SCHEDULED, and never a
// backward move). Terminal afterward.
export function applyComplete(
  state: ConsultationState,
  role: ParticipantRole,
): CompletionResult | TransitionError {
  if (role !== 'DOCTOR') {
    return { ok: false, reason: 'INVALID_TRANSITION' };
  }
  if (isTerminal(state)) {
    return { ok: false, reason: 'TERMINAL' };
  }
  if (state === 'SCHEDULED') {
    // No skipping states: cannot complete a session nobody has joined.
    return { ok: false, reason: 'NOT_JOINED' };
  }
  return { ok: true, state: 'COMPLETED' };
}

export class InvalidTransitionError extends Error {
  constructor(public readonly reason: TransitionReason) {
    super(`Invalid consultation transition: ${reason}`);
    this.name = 'InvalidTransitionError';
  }
}