import { describe, expect, it } from 'vitest';

import {
  countEntries,
  distinctSpecializations,
  doctorLabel,
  groupRecordsByYear,
  hasNoRecords,
  isEmptyRecord,
  specializationLabel,
  type MedicalRecord,
} from './medical-records-types';

function record(over: Partial<MedicalRecord> = {}): MedicalRecord {
  return {
    sessionId: 'sess-1',
    completedAt: '2026-09-17T11:00:00.000Z',
    doctorName: 'Dr. Amara Okafor',
    specialization: 'Dermatology',
    notes: [
      {
        id: 'note-1',
        sessionId: 'sess-1',
        findings: 'F',
        recommendations: 'R',
        recordedAt: '2026-09-17T11:00:00.000Z',
      },
    ],
    prescriptions: [
      { id: 'rx-1', sessionId: 'sess-1', details: 'D', issuedAt: '2026-09-17T11:00:00.000Z' },
    ],
    ...over,
  };
}

describe('medical record helpers (sub-item 6)', () => {
  describe('countEntries', () => {
    it('sums notes and prescriptions across all records', () => {
      expect(
        countEntries([
          record(),
          record({ sessionId: 'sess-2', notes: [], prescriptions: [] }),
        ]),
      ).toBe(2);
    });

    it('is zero for no records', () => {
      expect(countEntries([])).toBe(0);
    });
  });

  describe('distinctSpecializations', () => {
    it('dedupes and sorts alphabetically', () => {
      const result = distinctSpecializations([
        record({ specialization: 'Psychiatry' }),
        record({ specialization: 'Dermatology' }),
        record({ specialization: 'Psychiatry' }),
      ]);
      expect(result).toEqual(['Dermatology', 'Psychiatry']);
    });

    it('ignores null specializations rather than rendering an empty entry', () => {
      expect(distinctSpecializations([record({ specialization: null })])).toEqual([]);
    });
  });

  describe('null-safe labels', () => {
    it('does not leak "null" into the UI when the doctor is missing', () => {
      expect(doctorLabel(record({ doctorName: null }))).toBe('Doctor unavailable');
    });

    it('returns null (not the string "null") for a missing specialization', () => {
      expect(specializationLabel(record({ specialization: null }))).toBeNull();
    });

    it('passes through present values unchanged', () => {
      expect(doctorLabel(record())).toBe('Dr. Amara Okafor');
      expect(specializationLabel(record())).toBe('Dermatology');
    });
  });

  describe('groupRecordsByYear', () => {
    it('groups by year, newest year first, preserving server order within a year', () => {
      const groups = groupRecordsByYear([
        record({ sessionId: 'a', completedAt: '2026-09-17T11:00:00.000Z' }),
        record({ sessionId: 'b', completedAt: '2026-09-10T15:00:00.000Z' }),
        record({ sessionId: 'c', completedAt: '2025-01-05T09:00:00.000Z' }),
      ]);

      expect(groups.map((g) => g.year)).toEqual(['2026', '2025']);
      expect(groups[0]?.records.map((r) => r.sessionId)).toEqual(['a', 'b']);
      expect(groups[1]?.records.map((r) => r.sessionId)).toEqual(['c']);
    });

    it('does not re-sort within a year (the server owns that ordering)', () => {
      const groups = groupRecordsByYear([
        record({ sessionId: 'newer', completedAt: '2026-12-01T00:00:00.000Z' }),
        record({ sessionId: 'older', completedAt: '2026-01-01T00:00:00.000Z' }),
      ]);
      expect(groups[0]?.records.map((r) => r.sessionId)).toEqual(['newer', 'older']);
    });

    it('is empty for no records', () => {
      expect(groupRecordsByYear([])).toEqual([]);
    });
  });

  describe('isEmptyRecord / hasNoRecords', () => {
    it('treats a consultation with no note and no prescription as an empty record', () => {
      expect(isEmptyRecord(record({ notes: [], prescriptions: [] }))).toBe(true);
    });

    it('is not empty when only a prescription exists', () => {
      expect(isEmptyRecord(record({ notes: [] }))).toBe(false);
    });

    it('hasNoRecords is about the patient having no history at all', () => {
      expect(hasNoRecords([])).toBe(true);
      expect(hasNoRecords([record({ notes: [], prescriptions: [] })])).toBe(false);
    });
  });
});
