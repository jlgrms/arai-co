// API calls backing the doctor's consultation workspace (Layer 7 sub-item 4).
//
// All six of these endpoints already existed from Layer 4/5 — the patient side
// (Layer 6 sub-item 5) uses the first three and the read. What is new is that
// the doctor can now reach `complete` and the two write endpoints, which are
// DOCTOR-only on the server and were therefore unreachable from any UI before
// this sub-item.
//
// Scoping is entirely server-side and is NOT re-implemented here. Every call is
// participant-scoped by `loadParticipantSession`, and the writes additionally
// call `assertDoctorOwnsSession`. A non-participant gets 403 and a wrong-state
// write gets 409; the UI's job is to not offer actions that would produce those
// (see consultation-workspace-types.ts), not to duplicate the checks.

import { api } from '@/lib/api-client';
import type {
  ConsultationRecords,
  ConsultationSession,
} from '@/features/patient/consultation-types';
import type { CreateNoteInput, CreatePrescriptionInput } from './consultation-workspace-types';

/** One session, participant-scoped. */
export function fetchSession(sessionId: string, signal?: AbortSignal): Promise<ConsultationSession> {
  return api.get<ConsultationSession>(`/consultations/${sessionId}`, { signal });
}

/** Join the room. Idempotent server-side; a re-join in a non-terminal state is a no-op. */
export function joinSession(sessionId: string): Promise<ConsultationSession> {
  return api.post<ConsultationSession>(`/consultations/${sessionId}/join`);
}

/**
 * Complete the session. DOCTOR-only, and only from JOINED or IN_PROGRESS —
 * SCHEDULED is refused with 409 NOT_JOINED and COMPLETED with 409 TERMINAL.
 * The caller must gate this on `canComplete` so the button is not offered when
 * the server would refuse.
 */
export function completeSession(sessionId: string): Promise<ConsultationSession> {
  return api.post<ConsultationSession>(`/consultations/${sessionId}/complete`);
}

/**
 * This session's records. DOCTOR READ gate is { IN_PROGRESS, COMPLETED }, so
 * this must not be called below IN_PROGRESS — it would be a 409 by design.
 * Gate with `shouldLoadRecords` before calling.
 */
export function fetchSessionRecords(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ConsultationRecords> {
  return api.get<ConsultationRecords>(`/consultations/${sessionId}/records`, { signal });
}

/**
 * Append a note. Not an upsert: each POST adds ANOTHER note, and there is no
 * edit or delete endpoint. The UI must render existing notes alongside the
 * composer so the doctor does not POST a duplicate expecting to replace one.
 */
export function addNote(sessionId: string, input: CreateNoteInput): Promise<unknown> {
  return api.post<unknown>(`/consultations/${sessionId}/notes`, input);
}

/** Issue a prescription. Append-only, same as notes. */
export function addPrescription(
  sessionId: string,
  input: CreatePrescriptionInput,
): Promise<unknown> {
  return api.post<unknown>(`/consultations/${sessionId}/prescriptions`, input);
}
