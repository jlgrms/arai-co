// Pure, deterministic visibility gate for consultation notes and prescriptions
// (sub-item 7). No Prisma/Nest/HTTP -- single source of truth for "who may write
// and read clinical records, in which session state". ConsultationsService is a
// thin orchestrator over this, same pattern as consultation-state-machine.ts and
// booking-conflict.ts.
//
// Confirmed contract (Flag 1):
//   WRITE        = { IN_PROGRESS, COMPLETED }   (doctor-only; enforced upstream)
//   PATIENT READ = { COMPLETED }                 (no half-written notes mid-consult)
//   DOCTOR READ  = { IN_PROGRESS, COMPLETED }    (treating doctor, own records)
//
// SCHEDULED and JOINED are never writable or patient-readable: no consult has
// happened yet, so a "finding" would have no clinical meaning and would precede
// the encounter.

import { ConsultationState } from './consultation-state-machine';

export type RecordAction = 'WRITE' | 'READ_PATIENT' | 'READ_DOCTOR';

// States in which each action is permitted.
const ALLOWED: Record<RecordAction, ReadonlySet<ConsultationState>> = {
  WRITE: new Set<ConsultationState>(['IN_PROGRESS', 'COMPLETED']),
  READ_PATIENT: new Set<ConsultationState>(['COMPLETED']),
  READ_DOCTOR: new Set<ConsultationState>(['IN_PROGRESS', 'COMPLETED']),
};

/**
 * Returns true when the given action is permitted in the given session state.
 * Caller maps `false` to 409 (state-conflict), consistent with the state
 * machine's invalid-transition handling.
 */
export function canAccessRecords(
  state: ConsultationState,
  action: RecordAction,
): boolean {
  return ALLOWED[action].has(state);
}

/**
 * Human-readable reason for a rejected gate, for the 409 message.
 *
 * The message is ROLE-AWARE. A single "records are not available to the patient
 * until COMPLETED" string was previously returned for every non-write rejection,
 * which told a DOCTOR something about the patient, and was wrong on its own
 * terms: the doctor's read gate opens at IN_PROGRESS, not COMPLETED. A clinician
 * refused a record mid-consultation was told to wait for a state change that is
 * not actually required of them.
 *
 * The two read gates genuinely differ, so they get different sentences:
 *   READ_PATIENT -> opens at COMPLETED (no half-written notes mid-consult)
 *   READ_DOCTOR  -> opens at IN_PROGRESS (the treating doctor reads their own
 *                   notes back DURING the encounter)
 */
export function recordGateMessage(state: ConsultationState, action: RecordAction): string {
  switch (action) {
    case 'WRITE':
      return `Cannot record notes or prescriptions while the session is ${state}`;
    case 'READ_DOCTOR':
      // Not "wait for COMPLETED" — for a doctor, IN_PROGRESS is enough, and the
      // actionable next step is that the consultation has to start.
      return `Consultation records are not available yet: this consultation has not started (the session is ${state}). Records can be read once it is in progress.`;
    case 'READ_PATIENT':
      return `Consultation records are not available to the patient until the session is COMPLETED`;
  }
}
