import { describe, expect, it } from 'vitest';

import {
  canJoin,
  canOfferJoin,
  canPatientReadRecords,
  hasNoRecords,
  isTerminal,
  isWaitingForDoctor,
  presenceOf,
  stateHint,
  stateLabel,
  stateVariant,
  type ConsultationRecords,
  type ConsultationSession,
} from './consultation-types';

function session(over: Partial<ConsultationSession> = {}): ConsultationSession {
  return {
    id: 'sess-1',
    appointmentId: 'appt-1',
    state: 'SCHEDULED',
    joinedAt: null,
    patientJoinedAt: null,
    doctorJoinedAt: null,
    completedAt: null,
    appointment: {
      id: 'appt-1',
      patientProfileId: 'pat-1',
      doctorProfileId: 'doc-1',
      availabilityId: 'slot-1',
      status: 'BOOKED',
      scheduledAt: '2026-09-24T14:00:00.000Z',
    },
    ...over,
  };
}

describe('consultation helpers (sub-item 5)', () => {
  describe('presenceOf', () => {
    it('derives presence from the per-role join columns', () => {
      expect(presenceOf(session())).toEqual({ patientPresent: false, doctorPresent: false });
      expect(
        presenceOf(session({ patientJoinedAt: '2026-09-24T14:00:00.000Z' })),
      ).toEqual({ patientPresent: true, doctorPresent: false });
      expect(
        presenceOf(
          session({
            patientJoinedAt: '2026-09-24T14:00:00.000Z',
            doctorJoinedAt: '2026-09-24T14:01:00.000Z',
          }),
        ),
      ).toEqual({ patientPresent: true, doctorPresent: true });
    });
  });

  describe('isWaitingForDoctor', () => {
    it('is false before the patient has joined', () => {
      expect(isWaitingForDoctor(session({ state: 'SCHEDULED' }))).toBe(false);
    });

    it('is true once the patient joined but the doctor has not', () => {
      const s = session({ state: 'JOINED', patientJoinedAt: '2026-09-24T14:00:00.000Z' });
      expect(isWaitingForDoctor(s)).toBe(true);
    });

    it('is false once the doctor is present', () => {
      const s = session({
        state: 'IN_PROGRESS',
        patientJoinedAt: '2026-09-24T14:00:00.000Z',
        doctorJoinedAt: '2026-09-24T14:01:00.000Z',
      });
      expect(isWaitingForDoctor(s)).toBe(false);
    });

    it('is false for a completed session even if a column is missing', () => {
      // A completed session is never "waiting", regardless of join columns.
      expect(isWaitingForDoctor(session({ state: 'COMPLETED' }))).toBe(false);
    });
  });

  describe('canJoin', () => {
    it('allows joining every non-terminal state', () => {
      expect(canJoin('SCHEDULED')).toBe(true);
      expect(canJoin('JOINED')).toBe(true);
      expect(canJoin('IN_PROGRESS')).toBe(true);
    });

    it('refuses a completed session (server would 409 TERMINAL)', () => {
      expect(canJoin('COMPLETED')).toBe(false);
      expect(isTerminal('COMPLETED')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // The join affordance must account for the APPOINTMENT, not only the session.
  //
  // Cancelling an appointment does not touch its consultation session, which
  // therefore stays SCHEDULED — and `canJoin('SCHEDULED')` is true. The room
  // offered Join for a cancelled appointment and the server accepted it,
  // creating a live consultation for an appointment that no longer existed.
  // `canOfferJoin` is the single place that decision is made.
  // -------------------------------------------------------------------------
  describe('canOfferJoin', () => {
    it('offers Join for a live BOOKED appointment', () => {
      expect(canOfferJoin(session({ state: 'SCHEDULED' }))).toBe(true);
    });

    it('withholds Join when the appointment was CANCELLED', () => {
      // The reported defect, at its narrowest: SCHEDULED session (canJoin true)
      // on a cancelled appointment.
      const s = session({
        state: 'SCHEDULED',
        appointment: { ...session().appointment!, status: 'CANCELLED' },
      });
      expect(canJoin(s.state)).toBe(true); // the state alone still says yes
      expect(canOfferJoin(s)).toBe(false); // the appointment overrides it
    });

    it('withholds Join for a cancelled appointment in any session state', () => {
      for (const state of ['SCHEDULED', 'JOINED', 'IN_PROGRESS'] as const) {
        const s = session({
          state,
          appointment: { ...session().appointment!, status: 'CANCELLED' },
        });
        expect(canOfferJoin(s)).toBe(false);
      }
    });

    it('still refuses a COMPLETED session', () => {
      // The pre-existing rule must survive the new one.
      expect(canOfferJoin(session({ state: 'COMPLETED' }))).toBe(false);
    });

    it('offers Join for RESCHEDULED, which is a live appointment', () => {
      const s = session({
        state: 'SCHEDULED',
        appointment: { ...session().appointment!, status: 'RESCHEDULED' },
      });
      expect(canOfferJoin(s)).toBe(true);
    });

    it('does not withdraw records when only the appointment was cancelled', () => {
      // Cancelling withdraws joining, NOT the right to read a completed
      // consultation's notes. These two must not be coupled.
      const s = session({
        state: 'COMPLETED',
        appointment: { ...session().appointment!, status: 'CANCELLED' },
      });
      expect(canOfferJoin(s)).toBe(false);
      expect(canPatientReadRecords(s.state)).toBe(true);
    });

    it('degrades to the state-only rule when the appointment is absent', () => {
      // `appointment` is optional to keep a shape omission from crashing the
      // screen; a missing appointment must not withhold Join.
      expect(canOfferJoin(session({ appointment: undefined }))).toBe(true);
    });
  });

  describe('canPatientReadRecords', () => {
    it('is true ONLY when COMPLETED, matching the server READ_PATIENT gate', () => {
      expect(canPatientReadRecords('COMPLETED')).toBe(true);
      expect(canPatientReadRecords('SCHEDULED')).toBe(false);
      expect(canPatientReadRecords('JOINED')).toBe(false);
      expect(canPatientReadRecords('IN_PROGRESS')).toBe(false);
    });
  });

  describe('labels, variants and hints', () => {
    it('labels the waiting case in plain language, not as a state name', () => {
      expect(stateLabel('JOINED')).toBe('Waiting for your doctor');
      expect(stateLabel('SCHEDULED')).toBe('Not started');
      expect(stateLabel('IN_PROGRESS')).toBe('In progress');
      expect(stateLabel('COMPLETED')).toBe('Completed');
    });

    it('never colours a consultation state as an error', () => {
      const variants = (['SCHEDULED', 'JOINED', 'IN_PROGRESS', 'COMPLETED'] as const).map(
        stateVariant,
      );
      expect(variants).not.toContain('danger');
    });

    it('has a hint for every state', () => {
      for (const state of ['SCHEDULED', 'JOINED', 'IN_PROGRESS', 'COMPLETED'] as const) {
        const hint = stateHint(session({ state }));
        expect(hint.length).toBeGreaterThan(10);
      }
    });

    it('tells the waiting patient they can stay put', () => {
      expect(stateHint(session({ state: 'JOINED' }))).toContain('stay on this page');
    });
  });

  describe('hasNoRecords', () => {
    it('treats a null payload as empty', () => {
      expect(hasNoRecords(null)).toBe(true);
    });

    it('is true when both notes and prescriptions are empty', () => {
      const empty: ConsultationRecords = { sessionId: 'sess-1', notes: [], prescriptions: [] };
      expect(hasNoRecords(empty)).toBe(true);
    });

    it('is false when a prescription exists with no notes', () => {
      const rxOnly: ConsultationRecords = {
        sessionId: 'sess-1',
        notes: [],
        prescriptions: [{ id: 'rx-1', sessionId: 'sess-1', details: 'A', issuedAt: 'x' }],
      };
      expect(hasNoRecords(rxOnly)).toBe(false);
    });
  });
});
