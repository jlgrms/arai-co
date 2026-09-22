import { canAccessRecords, recordGateMessage } from './records-visibility';
import { ConsultationState } from './consultation-state-machine';

const ALL_STATES: ConsultationState[] = ['SCHEDULED', 'JOINED', 'IN_PROGRESS', 'COMPLETED'];

describe('records visibility gate (pure)', () => {
  describe('WRITE (doctor records findings / issues prescription)', () => {
    it('permits IN_PROGRESS', () => {
      expect(canAccessRecords('IN_PROGRESS', 'WRITE')).toBe(true);
    });
    it('permits COMPLETED (post-appointment summary)', () => {
      expect(canAccessRecords('COMPLETED', 'WRITE')).toBe(true);
    });
    it('rejects SCHEDULED (no encounter yet)', () => {
      expect(canAccessRecords('SCHEDULED', 'WRITE')).toBe(false);
    });
    it('rejects JOINED (no encounter yet)', () => {
      expect(canAccessRecords('JOINED', 'WRITE')).toBe(false);
    });
  });

  describe('READ_PATIENT (patient medical records view)', () => {
    it('permits COMPLETED only', () => {
      expect(canAccessRecords('COMPLETED', 'READ_PATIENT')).toBe(true);
      expect(canAccessRecords('IN_PROGRESS', 'READ_PATIENT')).toBe(false);
      expect(canAccessRecords('JOINED', 'READ_PATIENT')).toBe(false);
      expect(canAccessRecords('SCHEDULED', 'READ_PATIENT')).toBe(false);
    });
  });

  describe('READ_DOCTOR (treating doctor, own records)', () => {
    it('permits IN_PROGRESS and COMPLETED', () => {
      expect(canAccessRecords('IN_PROGRESS', 'READ_DOCTOR')).toBe(true);
      expect(canAccessRecords('COMPLETED', 'READ_DOCTOR')).toBe(true);
    });
    it('rejects SCHEDULED and JOINED', () => {
      expect(canAccessRecords('SCHEDULED', 'READ_DOCTOR')).toBe(false);
      expect(canAccessRecords('JOINED', 'READ_DOCTOR')).toBe(false);
    });
  });

  it('every state has a definite answer for every action (no undefined)', () => {
    for (const s of ALL_STATES) {
      for (const a of ['WRITE', 'READ_PATIENT', 'READ_DOCTOR'] as const) {
        expect(typeof canAccessRecords(s, a)).toBe('boolean');
      }
    }
  });

  // The gate message is user-visible (it is the 409 body the UI renders), and
  // was previously role-blind: every non-WRITE rejection returned the PATIENT
  // wording, so a doctor refused a read mid-consultation was told the records
  // were "not available to the patient until COMPLETED" — about the wrong person
  // and, for READ_DOCTOR, factually wrong, since a doctor's read gate opens at
  // IN_PROGRESS. These tests pin the role-awareness.
  describe('recordGateMessage (user-visible 409 body)', () => {
    it('is non-empty for every rejected state/action pair', () => {
      for (const s of ALL_STATES) {
        for (const a of ['WRITE', 'READ_PATIENT', 'READ_DOCTOR'] as const) {
          if (canAccessRecords(s, a)) continue;
          expect(recordGateMessage(s, a).length).toBeGreaterThan(0);
        }
      }
    });

    it('tells the DOCTOR about the doctor, never about the patient', () => {
      // The specific defect: READ_DOCTOR at SCHEDULED/JOINED must not mention
      // the patient, because the reader is the clinician.
      for (const s of ['SCHEDULED', 'JOINED'] as const) {
        const msg = recordGateMessage(s, 'READ_DOCTOR');
        expect(msg).not.toMatch(/to the patient/i);
        // And it must name the actual blocker so the message is actionable.
        expect(msg).toMatch(/not started|in progress/i);
      }
    });

    it('does NOT tell a doctor to wait for COMPLETED (their gate opens earlier)', () => {
      // A doctor's read gate is {IN_PROGRESS, COMPLETED}, so instructing them to
      // wait for COMPLETED would be wrong about the system's own rules.
      for (const s of ['SCHEDULED', 'JOINED'] as const) {
        expect(recordGateMessage(s, 'READ_DOCTOR')).not.toMatch(/COMPLETED/);
      }
    });

    it('keeps the PATIENT message about the patient and the COMPLETED gate', () => {
      for (const s of ['SCHEDULED', 'JOINED', 'IN_PROGRESS'] as const) {
        const msg = recordGateMessage(s, 'READ_PATIENT');
        expect(msg).toMatch(/patient/i);
        expect(msg).toMatch(/COMPLETED/);
      }
    });

    it('distinguishes the two read gates in wording (they are not the same rule)', () => {
      expect(recordGateMessage('SCHEDULED', 'READ_DOCTOR')).not.toBe(
        recordGateMessage('SCHEDULED', 'READ_PATIENT'),
      );
    });

    it('names the state for a WRITE rejection so the doctor knows where they are', () => {
      for (const s of ['SCHEDULED', 'JOINED'] as const) {
        expect(recordGateMessage(s, 'WRITE')).toContain(s);
      }
    });

    it('every action has distinct wording (no accidental copy-paste)', () => {
      const messages = (['WRITE', 'READ_PATIENT', 'READ_DOCTOR'] as const).map((a) =>
        recordGateMessage('SCHEDULED', a),
      );
      expect(new Set(messages).size).toBe(3);
    });
  });
});
