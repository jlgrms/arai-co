/**
 * Doctor-side consultation workspace (Layer 7 sub-item 4) — types and pure
 * helpers.
 *
 * Contracts mirror the backend:
 *   - `GET  /consultations/:id`               -> ConsultationSession
 *   - `POST /consultations/:id/join`          -> ConsultationSession
 *   - `POST /consultations/:id/complete`      -> ConsultationSession
 *   - `GET  /consultations/:id/records`       -> records (doctor: IN_PROGRESS+)
 *   - `POST /consultations/:id/notes`         -> ConsultationNote
 *   - `POST /consultations/:id/prescriptions` -> Prescription
 *
 * The session/appointment/note/prescription shapes are REUSED from the patient
 * module rather than re-declared. They describe the same server resources, and a
 * second copy would be a second thing to keep in step — the two sides differ in
 * which ACTIONS they may take, not in what a session looks like.
 *
 * THE ASYMMETRY THIS MODULE ENCODES
 * The patient side (Layer 6 sub-item 5) could join and read, and that was all:
 * completion is doctor-only, so a patient alone in a room was correctly stuck.
 * The doctor is the one who can actually move a consultation to COMPLETED, and
 * is therefore the only role for which notes and prescriptions are reachable at
 * all. Everything below exists to keep the doctor's affordances in step with the
 * gates the server enforces, because offering an action the server will refuse
 * (409) is worse than not offering it.
 */

import type { ConsultationState } from '@/features/patient/consultation-types';

export type { ConsultationState };

/**
 * Doctor WRITE gate: { IN_PROGRESS, COMPLETED }.
 *
 * A consultation note written before the encounter would have no clinical
 * meaning — it would precede the thing it describes. The server refuses
 * SCHEDULED and JOINED with a 409, so the composer is not rendered in those
 * states at all.
 */
export function canDoctorWrite(state: ConsultationState): boolean {
  return state === 'IN_PROGRESS' || state === 'COMPLETED';
}

/**
 * Doctor READ gate: { IN_PROGRESS, COMPLETED }.
 *
 * Broader than the patient's gate on purpose: a treating doctor must be able to
 * read back what they wrote during the encounter, not only after it closes.
 */
export function canDoctorReadRecords(state: ConsultationState): boolean {
  return state === 'IN_PROGRESS' || state === 'COMPLETED';
}

/**
 * Whether the doctor may complete this session.
 *
 * Mirrors `applyComplete` exactly:
 *   - COMPLETED  -> no (TERMINAL, 409)
 *   - SCHEDULED  -> NO. No skipping states: a session nobody has joined cannot
 *                   be completed (409 NOT_JOINED). This is the case most easily
 *                   got wrong, because "the patient no-showed, let me close it"
 *                   is a real clinical workflow that this API does not support.
 *                   Offering the button would produce a 409 the doctor cannot
 *                   resolve, so the UI must not offer it and must explain why.
 *   - JOINED / IN_PROGRESS -> yes. JOINED is allowed so a short consultation
 *                   that never reached the both-present promotion can still be
 *                   closed.
 */
export function canComplete(state: ConsultationState): boolean {
  return state === 'JOINED' || state === 'IN_PROGRESS';
}

/**
 * Why completion is unavailable, in the doctor's terms. Null when it IS
 * available.
 *
 * The SCHEDULED case needs care: the doctor is looking at a session that is not
 * happening, and the honest answer is that at least one participant must join
 * first. Saying only "cannot complete" invites the doctor to retry forever.
 */
export function completionBlockedReason(state: ConsultationState): string | null {
  switch (state) {
    case 'COMPLETED':
      return 'This consultation is already complete.';
    case 'SCHEDULED':
      return 'Nobody has joined this consultation yet. At least one participant must join before it can be completed — a session that never starts stays scheduled.';
    case 'JOINED':
    case 'IN_PROGRESS':
      return null;
  }
}

/**
 * Human label for a state, from the DOCTOR's point of view.
 *
 * JOINED needs `patientPresent` to be honest. JOINED means "exactly one side is
 * in the room", and from the doctor's screen that one side is usually the
 * doctor — a doctor who joins a session the patient never attends is in JOINED,
 * not waiting for themselves. Labelling that "Patient is waiting" would
 * contradict the presence row printed directly beneath it ("Patient: Has not
 * arrived yet"). So the label names whichever side is actually missing.
 */
export function doctorStateLabel(
  state: ConsultationState,
  patientPresent = false,
): string {
  switch (state) {
    case 'SCHEDULED':
      return 'Not started';
    case 'JOINED':
      return patientPresent ? 'Waiting for you' : 'Waiting for the patient';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'COMPLETED':
      return 'Completed';
  }
}

/** Badge variant per state, consistent with how the patient side colours it. */
export function doctorStateVariant(
  state: ConsultationState,
): 'success' | 'muted' | 'secondary' {
  if (state === 'COMPLETED' || state === 'IN_PROGRESS') return 'success';
  if (state === 'JOINED') return 'secondary';
  return 'muted';
}

/** What the doctor should expect next, given the session. */
export function doctorStateHint(
  state: ConsultationState,
  patientPresent: boolean,
): string {
  switch (state) {
    case 'SCHEDULED':
      return 'This consultation has not started. Join when you are ready, and the patient will be able to see that you have arrived.';
    case 'JOINED':
      return patientPresent
        ? 'You are both in the room. Record your findings below; the session moves to in progress once both of you have joined.'
        : 'You have joined. The patient has not arrived yet — you can record notes once the consultation is in progress.';
    case 'IN_PROGRESS':
      return 'The consultation is in progress. Record findings, recommendations, and any prescriptions, then complete the session.';
    case 'COMPLETED':
      return 'This consultation is complete. The records below are final and append-only.';
  }
}

/** `POST /consultations/:id/notes` body. */
export interface CreateNoteInput {
  findings?: string;
  recommendations?: string;
}

/** `POST /consultations/:id/prescriptions` body. */
export interface CreatePrescriptionInput {
  details: string;
}

/**
 * The server rejects a note with neither field ("A note must include findings,
 * recommendations, or both"). Mirrored here so the button is disabled rather
 * than letting the doctor submit a request that is guaranteed to 400.
 *
 * Whitespace-only values count as empty: a note containing "   " is not a note,
 * and the server's `@IsString()` would accept it, so the check is done here.
 */
export function isNoteSubmittable(input: CreateNoteInput): boolean {
  return Boolean(input.findings?.trim() || input.recommendations?.trim());
}

/** Trimmed payload for POST, dropping empty fields so the server stores nulls
 *  rather than empty strings (the DTO marks both optional). */
export function toNotePayload(input: CreateNoteInput): CreateNoteInput {
  const payload: CreateNoteInput = {};
  if (input.findings?.trim()) payload.findings = input.findings.trim();
  if (input.recommendations?.trim()) payload.recommendations = input.recommendations.trim();
  return payload;
}

/** Prescriptions have `@MinLength(1)`; whitespace-only would pass on the server
 *  and store an unusable prescription, so require real content. */
export function isPrescriptionSubmittable(input: CreatePrescriptionInput): boolean {
  return input.details.trim().length > 0;
}

export function toPrescriptionPayload(input: CreatePrescriptionInput): CreatePrescriptionInput {
  return { details: input.details.trim() };
}

/** Server MaxLength for both note fields and prescription details. */
export const CLINICAL_TEXT_MAX_LENGTH = 8000;

/**
 * Remaining characters, or null when well under the limit.
 *
 * Returns null rather than a large number so the counter is not rendered for a
 * normal-length note — a "7843 characters remaining" badge on every field is
 * noise. Only surfaces as the limit approaches.
 */
export function remainingChars(value: string): number | null {
  const left = CLINICAL_TEXT_MAX_LENGTH - value.length;
  return left <= 500 ? left : null;
}

/** True when a field has exceeded the server's limit (client-side guard only —
 *  the server is still the authority and would answer 400). */
export function isOverLimit(value: string): boolean {
  return value.length > CLINICAL_TEXT_MAX_LENGTH;
}

/**
 * A consultation can carry any number of notes and prescriptions (append-only,
 * no edit or delete). Older entries are still rendered, so the doctor can see
 * what was already written before adding more — a second POST adds another note
 * rather than replacing one, and the UI must make that visible or the doctor
 * will write duplicates expecting an edit.
 */
export interface ClinicalEntryCounts {
  notes: number;
  prescriptions: number;
}

export function countClinicalEntries(records: {
  notes: unknown[];
  prescriptions: unknown[];
} | null): ClinicalEntryCounts {
  return {
    notes: records?.notes.length ?? 0,
    prescriptions: records?.prescriptions.length ?? 0,
  };
}

/**
 * Whether the doctor should be offered the records block at all.
 *
 * Distinct from `canDoctorReadRecords`: this also covers "what do we show when
 * the gate is closed". Below IN_PROGRESS there is nothing readable, and asking
 * anyway returns a 409 by design — so the request is gated BEFORE it is made,
 * exactly as the patient side gates its own read.
 */
export function shouldLoadRecords(state: ConsultationState): boolean {
  return canDoctorReadRecords(state);
}

/** A short summary line for the session header. */
export function sessionSummary(state: ConsultationState, patientPresent: boolean): string {
  if (state === 'SCHEDULED') return 'Not started';
  if (state === 'COMPLETED') return 'Completed';
  return patientPresent ? 'Patient in the room' : 'Patient not in the room';
}
