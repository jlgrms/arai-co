import { canAccessRecords } from './records-visibility';
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
});
