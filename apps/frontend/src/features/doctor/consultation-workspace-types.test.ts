import { describe, expect, it } from 'vitest';

import {
  CLINICAL_TEXT_MAX_LENGTH,
  canComplete,
  canDoctorOfferJoin,
  canDoctorReadRecords,
  canDoctorWrite,
  completionBlockedReason,
  countClinicalEntries,
  doctorStateHint,
  doctorStateLabel,
  doctorStateVariant,
  isNoteSubmittable,
  isOverLimit,
  isPrescriptionSubmittable,
  remainingChars,
  sessionSummary,
  shouldLoadRecords,
  toNotePayload,
  toPrescriptionPayload,
  type ConsultationState,
} from './consultation-workspace-types';

const ALL_STATES: ConsultationState[] = ['SCHEDULED', 'JOINED', 'IN_PROGRESS', 'COMPLETED'];

/** Minimal session fixture for the join-affordance rule. */
function sessionView(
  over: {
    state?: ConsultationState;
    doctorJoinedAt?: string | null;
    status?: 'BOOKED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED';
  } = {},
) {
  return {
    state: over.state ?? ('SCHEDULED' as ConsultationState),
    doctorJoinedAt: over.doctorJoinedAt ?? null,
    appointment: {
      id: 'appt-1',
      patientProfileId: 'pat-1',
      doctorProfileId: 'doc-1',
      availabilityId: 'slot-1' as string | null,
      status: over.status ?? ('BOOKED' as const),
      scheduledAt: '2026-09-24T14:00:00.000Z',
    },
  };
}

// ---------------------------------------------------------------------------
// The doctor must not be offered Join on a CANCELLED appointment.
//
// Same defect as the patient room, and reachable from the doctor's side too:
// the screen decided joinability from `!doctorPresent && state !== 'COMPLETED'`,
// and a cancellation leaves the session at SCHEDULED with nobody present — so it
// offered Join, and the server accepted it. The refusal is now bilateral.
// ---------------------------------------------------------------------------
describe('canDoctorOfferJoin', () => {
  it('offers Join for a live BOOKED appointment the doctor has not entered', () => {
    expect(canDoctorOfferJoin(sessionView())).toBe(true);
  });

  it('withholds Join when the appointment was CANCELLED', () => {
    expect(canDoctorOfferJoin(sessionView({ status: 'CANCELLED' }))).toBe(false);
  });

  it('withholds Join for a cancelled appointment in any session state', () => {
    for (const state of ALL_STATES) {
      expect(canDoctorOfferJoin(sessionView({ state, status: 'CANCELLED' }))).toBe(false);
    }
  });

  it('withholds Join once the doctor is already in the room', () => {
    // Re-join is idempotent server-side, but there is nothing to offer.
    expect(canDoctorOfferJoin(sessionView({ doctorJoinedAt: '2026-09-24T14:00:00.000Z' }))).toBe(
      false,
    );
  });

  it('withholds Join on a COMPLETED session', () => {
    expect(canDoctorOfferJoin(sessionView({ state: 'COMPLETED' }))).toBe(false);
  });

  it('still offers Join for RESCHEDULED, which is a live appointment', () => {
    expect(canDoctorOfferJoin(sessionView({ status: 'RESCHEDULED' }))).toBe(true);
  });

  it('leaves records readable after a cancellation', () => {
    // Cancelling withdraws joining, not the doctor's READ_DOCTOR access to a
    // consultation that already happened.
    const s = sessionView({ state: 'COMPLETED', status: 'CANCELLED' });
    expect(canDoctorOfferJoin(s)).toBe(false);
    expect(canDoctorReadRecords(s.state)).toBe(true);
  });
});

describe('doctor write gate (WRITE = IN_PROGRESS, COMPLETED)', () => {
  it('mirrors the backend records-visibility WRITE set exactly', () => {
    const allowed = ALL_STATES.filter(canDoctorWrite);
    expect(allowed).toEqual(['IN_PROGRESS', 'COMPLETED']);
  });

  it('refuses to let a note be written before the encounter', () => {
    // A finding written before the consultation would precede the thing it
    // describes, which is why the server gates these two out.
    expect(canDoctorWrite('SCHEDULED')).toBe(false);
    expect(canDoctorWrite('JOINED')).toBe(false);
  });
});

describe('doctor read gate (READ_DOCTOR = IN_PROGRESS, COMPLETED)', () => {
  it('mirrors the backend READ_DOCTOR set exactly', () => {
    const allowed = ALL_STATES.filter(canDoctorReadRecords);
    expect(allowed).toEqual(['IN_PROGRESS', 'COMPLETED']);
  });

  it('is broader than the patient gate, which is COMPLETED only', () => {
    // The doctor must read back what they wrote DURING the encounter.
    expect(canDoctorReadRecords('IN_PROGRESS')).toBe(true);
  });

  it('shouldLoadRecords agrees with the read gate', () => {
    for (const state of ALL_STATES) {
      expect(shouldLoadRecords(state)).toBe(canDoctorReadRecords(state));
    }
  });
});

describe('canComplete mirrors applyComplete', () => {
  it('permits JOINED and IN_PROGRESS', () => {
    expect(canComplete('JOINED')).toBe(true);
    expect(canComplete('IN_PROGRESS')).toBe(true);
  });

  it('permits JOINED so a short consult that never reached both-present can close', () => {
    // applyComplete allows JOINED explicitly; if this regressed, a consultation
    // where the patient left before the doctor joined could never be closed.
    expect(canComplete('JOINED')).toBe(true);
  });

  it('refuses SCHEDULED — no skipping states', () => {
    // The case most easily got wrong: "the patient no-showed, close it" is a
    // real workflow the API does not support, so the button must not appear.
    expect(canComplete('SCHEDULED')).toBe(false);
  });

  it('refuses COMPLETED — terminal', () => {
    expect(canComplete('COMPLETED')).toBe(false);
  });
});

describe('completionBlockedReason', () => {
  it('is null exactly when completion is available', () => {
    for (const state of ALL_STATES) {
      const reason = completionBlockedReason(state);
      expect(reason === null).toBe(canComplete(state));
    }
  });

  it('explains the SCHEDULED case actionably rather than just refusing', () => {
    const reason = completionBlockedReason('SCHEDULED');
    expect(reason).toBeTruthy();
    // Must tell the doctor what WOULD unblock it, or they retry forever.
    expect(reason).toMatch(/join/i);
    expect(reason).toMatch(/scheduled/i);
  });

  it('explains the COMPLETED case as already done, not as an error', () => {
    expect(completionBlockedReason('COMPLETED')).toMatch(/already complete/i);
  });
});

describe('doctorStateLabel / variant / hint', () => {
  it('labels every state and never returns undefined', () => {
    for (const state of ALL_STATES) {
      expect(doctorStateLabel(state)).toBeTruthy();
      expect(doctorStateVariant(state)).toBeTruthy();
      expect(doctorStateHint(state, true)).toBeTruthy();
      expect(doctorStateHint(state, false)).toBeTruthy();
    }
  });

  it('labels JOINED by naming whichever side is actually missing', () => {
    // JOINED means exactly one side is in the room. Defaulting to "Patient is
    // waiting" told a doctor who had just joined a no-show session that the
    // PATIENT was waiting — contradicting the presence row printed directly
    // beneath the label ("Patient: Has not arrived yet").
    expect(doctorStateLabel('JOINED', false)).toBe('Waiting for the patient');
    expect(doctorStateLabel('JOINED', true)).toBe('Waiting for you');
  });

  it('never labels JOINED as the patient waiting while showing the patient absent', () => {
    // The regression this guards: the label and the presence row disagreeing.
    expect(doctorStateLabel('JOINED', false)).not.toMatch(/patient is waiting/i);
  });

  it('hint distinguishes whether the patient is present', () => {
    const withPatient = doctorStateHint('JOINED', true);
    const withoutPatient = doctorStateHint('JOINED', false);
    expect(withPatient).not.toBe(withoutPatient);
    expect(withoutPatient).toMatch(/has not arrived/i);
  });

  it('uses only success/muted/secondary so no consultation state reads as an error', () => {
    for (const state of ALL_STATES) {
      expect(['success', 'muted', 'secondary']).toContain(doctorStateVariant(state));
    }
  });
});

describe('isNoteSubmittable', () => {
  it('accepts findings alone, recommendations alone, or both', () => {
    expect(isNoteSubmittable({ findings: 'x' })).toBe(true);
    expect(isNoteSubmittable({ recommendations: 'y' })).toBe(true);
    expect(isNoteSubmittable({ findings: 'x', recommendations: 'y' })).toBe(true);
  });

  it('rejects an empty note, which the server would 400', () => {
    // The service throws "A note must include findings, recommendations, or
    // both", so the button must be disabled rather than allow a doomed request.
    expect(isNoteSubmittable({})).toBe(false);
    expect(isNoteSubmittable({ findings: '', recommendations: '' })).toBe(false);
  });

  it('treats whitespace-only as empty — @IsString would have accepted it', () => {
    expect(isNoteSubmittable({ findings: '   ' })).toBe(false);
    expect(isNoteSubmittable({ recommendations: '\n\t ' })).toBe(false);
  });
});

describe('toNotePayload', () => {
  it('drops empty fields so the server stores null rather than ""', () => {
    expect(toNotePayload({ findings: 'x', recommendations: '   ' })).toEqual({ findings: 'x' });
    expect(toNotePayload({ recommendations: 'y' })).toEqual({ recommendations: 'y' });
  });

  it('trims values', () => {
    expect(toNotePayload({ findings: '  chest clear  ' })).toEqual({ findings: 'chest clear' });
  });

  it('produces {} for an empty note, which the guard already rejected', () => {
    expect(toNotePayload({})).toEqual({});
  });
});

describe('isPrescriptionSubmittable / toPrescriptionPayload', () => {
  it('requires real content, not just MinLength(1) of whitespace', () => {
    expect(isPrescriptionSubmittable({ details: 'Amoxicillin 500mg' })).toBe(true);
    // " " has length 1 and would pass @MinLength(1) on the server, storing an
    // unusable prescription. The client must be stricter than the server here.
    expect(isPrescriptionSubmittable({ details: ' ' })).toBe(false);
    expect(isPrescriptionSubmittable({ details: '' })).toBe(false);
  });

  it('trims before sending', () => {
    expect(toPrescriptionPayload({ details: '  Ibuprofen  ' })).toEqual({ details: 'Ibuprofen' });
  });
});

describe('length guards (server MaxLength 8000)', () => {
  it('uses the server limit', () => {
    expect(CLINICAL_TEXT_MAX_LENGTH).toBe(8000);
  });

  it('hides the counter for a normal-length note', () => {
    // "7800 characters remaining" on every field would be noise.
    expect(remainingChars('short note')).toBeNull();
  });

  it('surfaces the counter only as the limit approaches', () => {
    // Boundary is 8000 - 500 = 7500: at 7500 chars exactly 500 remain, which is
    // still shown; at 7499 there are 501 remaining, which is not.
    expect(remainingChars('x'.repeat(7500))).toBe(500);
    expect(remainingChars('x'.repeat(7499))).toBeNull();
    expect(remainingChars('x'.repeat(7600))).toBe(400);
    expect(remainingChars('x'.repeat(7900))).toBe(100);
    expect(remainingChars('x'.repeat(8000))).toBe(0);
  });

  it('flags going over the limit, and does not treat exactly-at-limit as over', () => {
    expect(isOverLimit('x'.repeat(8000))).toBe(false);
    expect(isOverLimit('x'.repeat(8001))).toBe(true);
  });
});

describe('countClinicalEntries', () => {
  it('counts both kinds', () => {
    expect(countClinicalEntries({ notes: [1, 2], prescriptions: [1] })).toEqual({
      notes: 2,
      prescriptions: 1,
    });
  });

  it('treats null (not yet loaded) as zero rather than throwing', () => {
    // The records block renders before its fetch resolves.
    expect(countClinicalEntries(null)).toEqual({ notes: 0, prescriptions: 0 });
  });
});

describe('sessionSummary', () => {
  it('describes the patient\'s presence once the consultation is live', () => {
    expect(sessionSummary('IN_PROGRESS', true)).toBe('Patient in the room');
    expect(sessionSummary('IN_PROGRESS', false)).toBe('Patient not in the room');
  });

  it('does not claim the patient is absent when nobody has joined yet', () => {
    // SCHEDULED has patientPresent=false, but "Patient not in the room" would
    // imply they were expected and missing. It is simply not started.
    expect(sessionSummary('SCHEDULED', false)).toBe('Not started');
  });
});
