/**
 * Consultation workspace (Layer 6 sub-item 5) — types and pure helpers.
 *
 * Contracts mirror the backend recommendations controller/service:
 *   - `GET  /consultations/:id`         -> ConsultationSession (participant-scoped)
 *   - `POST /consultations/:id/join`    -> ConsultationSession
 *   - `GET  /consultations/:id/records` -> records (patient: COMPLETED only)
 *
 * IMPORTANT — this workspace is PATIENT-SIDE ONLY. Two consequences are encoded
 * here deliberately rather than left for the component to remember:
 *
 * 1. The patient can NEVER advance the session to COMPLETED. `complete` is
 *    DOCTOR-only on the server, and IN_PROGRESS requires BOTH participants
 *    present. A patient sitting alone in a session is legitimately stuck at
 *    JOINED, and that is the normal case, not an error. The UI must present
 *    that as "waiting for your doctor", never as a failure or a broken button.
 *
 * 2. The patient may not read records until COMPLETED (READ_PATIENT gate). So
 *    the records request must be gated on state HERE, before the fetch, because
 *    asking for them earlier is a 409 by design. Fetching and then rendering the
 *    409 as an error would surface the system working correctly as a fault.
 */

export type ConsultationState = 'SCHEDULED' | 'JOINED' | 'IN_PROGRESS' | 'COMPLETED';

/** The subset of Appointment the session carries. */
export interface ConsultationAppointment {
  id: string;
  patientProfileId: string;
  doctorProfileId: string;
  availabilityId: string | null;
  status: 'BOOKED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED';
  scheduledAt: string;
}

/** `GET /consultations/:id`. Note: the doctor is NOT joined onto this payload —
 *  only the appointment is. */
export interface ConsultationSession {
  id: string;
  appointmentId: string;
  state: ConsultationState;
  joinedAt: string | null;
  patientJoinedAt: string | null;
  doctorJoinedAt: string | null;
  completedAt: string | null;
  /**
   * Optional because every session response SHOULD carry it, but a render path
   * that dereferences it unconditionally turns a server-shape drift into a
   * blank crash page. The backend now returns it on every branch of `join` and
   * `complete`; keeping it optional here means a future omission degrades the
   * header text instead of taking the whole screen down.
   */
  appointment?: ConsultationAppointment;
}

export interface ConsultationNote {
  id: string;
  sessionId: string;
  findings: string | null;
  recommendations: string | null;
  recordedAt: string;
}

export interface Prescription {
  id: string;
  sessionId: string;
  details: string;
  issuedAt: string;
}

/** `GET /consultations/:id/records` */
export interface ConsultationRecords {
  sessionId: string;
  notes: ConsultationNote[];
  prescriptions: Prescription[];
}

export interface Presence {
  patientPresent: boolean;
  doctorPresent: boolean;
}

/** Derived presence, mirroring how the backend derives it from the join columns. */
export function presenceOf(session: ConsultationSession): Presence {
  return {
    patientPresent: session.patientJoinedAt !== null,
    doctorPresent: session.doctorJoinedAt !== null,
  };
}

export const isTerminal = (state: ConsultationState): boolean => state === 'COMPLETED';

/** A session can be joined unless it is finished (server returns 409 TERMINAL). */
export function canJoin(state: ConsultationState): boolean {
  return !isTerminal(state);
}

/**
 * The patient may read records ONLY when COMPLETED. Mirrors the backend's
 * READ_PATIENT gate — keep the two in step if that gate ever changes.
 */
export function canPatientReadRecords(state: ConsultationState): boolean {
  return state === 'COMPLETED';
}

/**
 * True while the patient is IN the session but the doctor has not arrived.
 *
 * This is the state that needs the most care in the UI: nothing is wrong, but
 * nothing can happen either. Both participants must be present for IN_PROGRESS,
 * so the patient is correctly waiting, not stuck.
 *
 * Requires `patientPresent` as well as `!doctorPresent`. In SCHEDULED nobody is
 * present yet, which is "not started" rather than "waiting" — without that
 * condition the pre-join screen would tell the patient they were waiting for a
 * doctor they had not yet tried to meet.
 */
export function isWaitingForDoctor(session: ConsultationSession): boolean {
  const { patientPresent, doctorPresent } = presenceOf(session);
  return !isTerminal(session.state) && patientPresent && !doctorPresent;
}

const STATE_LABEL: Record<ConsultationState, string> = {
  SCHEDULED: 'Not started',
  JOINED: 'Waiting for your doctor',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

export function stateLabel(state: ConsultationState): string {
  return STATE_LABEL[state];
}

/**
 * Badge variant per state, matching how status is coloured elsewhere in the app
 * (success = happening/happened, muted = pending, danger = did not happen).
 * There is no error state for a consultation, so nothing here is `danger`.
 */
export function stateVariant(state: ConsultationState): 'success' | 'muted' | 'secondary' {
  if (state === 'COMPLETED' || state === 'IN_PROGRESS') return 'success';
  if (state === 'JOINED') return 'secondary';
  return 'muted';
}

/**
 * One-line explanation of what the patient should expect next. Being explicit
 * beats an ambiguous live state — especially for the waiting case, where
 * silence would read as a bug.
 */
export function stateHint(session: ConsultationSession): string {
  switch (session.state) {
    case 'SCHEDULED':
      return 'Your consultation room is ready. Join when you are ready to begin.';
    case 'JOINED':
      return 'You have joined. Your doctor has not arrived yet — you can stay on this page.';
    case 'IN_PROGRESS':
      return 'You are both in the consultation. Your doctor will complete the session and record the notes.';
    case 'COMPLETED':
      return 'This consultation is complete. Your notes and prescriptions are available below.';
  }
}

/** True when there are no clinical records to show for a completed session. */
export function hasNoRecords(records: ConsultationRecords | null): boolean {
  if (!records) return true;
  return records.notes.length === 0 && records.prescriptions.length === 0;
}
