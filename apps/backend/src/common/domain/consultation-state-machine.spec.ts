import {
  applyComplete,
  applyJoin,
  InvalidTransitionError,
  Presence,
} from './consultation-state-machine';

const nobody: Presence = { patientPresent: false, doctorPresent: false };
const patientOnly: Presence = { patientPresent: true, doctorPresent: false };
const doctorOnly: Presence = { patientPresent: false, doctorPresent: true };
const both: Presence = { patientPresent: true, doctorPresent: true };

describe('consultation state machine (pure)', () => {
  describe('applyJoin', () => {
    it('SCHEDULED + first participant (patient) -> JOINED', () => {
      const r = applyJoin('SCHEDULED', nobody, 'PATIENT');
      expect(r.state).toBe('JOINED');
      expect(r.presence).toEqual(patientOnly);
      expect(r.changed).toBe(true);
    });

    it('SCHEDULED + first participant (doctor) -> JOINED', () => {
      const r = applyJoin('SCHEDULED', nobody, 'DOCTOR');
      expect(r.state).toBe('JOINED');
      expect(r.presence).toEqual(doctorOnly);
      expect(r.changed).toBe(true);
    });

    it('JOINED + second participant (both present) -> IN_PROGRESS', () => {
      const r = applyJoin('JOINED', patientOnly, 'DOCTOR');
      expect(r.state).toBe('IN_PROGRESS');
      expect(r.presence).toEqual(both);
      expect(r.changed).toBe(true);
    });

    it('JOINED + same participant re-joining -> no-op (idempotent)', () => {
      const r = applyJoin('JOINED', patientOnly, 'PATIENT');
      expect(r.state).toBe('JOINED');
      expect(r.presence).toEqual(patientOnly);
      expect(r.changed).toBe(false);
    });

    it('IN_PROGRESS + re-join -> stays IN_PROGRESS, no error', () => {
      const r = applyJoin('IN_PROGRESS', both, 'PATIENT');
      expect(r.state).toBe('IN_PROGRESS');
      expect(r.changed).toBe(false);
    });

    it('COMPLETED + join -> throws (terminal) -> caller maps to 409', () => {
      expect(() => applyJoin('COMPLETED', both, 'PATIENT')).toThrow(InvalidTransitionError);
    });
  });

  describe('applyComplete', () => {
    it('doctor completes an IN_PROGRESS session -> COMPLETED', () => {
      expect(applyComplete('IN_PROGRESS', 'DOCTOR')).toEqual({ ok: true, state: 'COMPLETED' });
    });

    it('doctor completes a JOINED session (short consult) -> COMPLETED', () => {
      expect(applyComplete('JOINED', 'DOCTOR')).toEqual({ ok: true, state: 'COMPLETED' });
    });

    it('patient cannot complete -> INVALID_TRANSITION (doctor-only)', () => {
      expect(applyComplete('IN_PROGRESS', 'PATIENT')).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
    });

    it('cannot complete a SCHEDULED session (no skipping states)', () => {
      expect(applyComplete('SCHEDULED', 'DOCTOR')).toEqual({ ok: false, reason: 'NOT_JOINED' });
    });

    it('cannot complete an already-COMPLETED session (terminal, no re-entry)', () => {
      expect(applyComplete('COMPLETED', 'DOCTOR')).toEqual({ ok: false, reason: 'TERMINAL' });
    });
  });
});