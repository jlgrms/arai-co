import { describe, expect, it } from 'vitest';

import {
  buildPatientList,
  countEntries,
  distinctPatients,
  filterPatients,
  formatRecordDate,
  groupRecordsByYear,
  hasClinicalContent,
  isCompleted,
  isUpcoming,
  patientLabel,
  stateBadgeVariant,
  stateLabel,
  type DoctorPatientRecord,
} from './patient-records-types';

const local = (y: number, m: number, d: number, h = 9) =>
  new Date(y, m - 1, d, h, 0, 0, 0).toISOString();

const record = (over: Partial<DoctorPatientRecord>): DoctorPatientRecord => ({
  sessionId: 'sess-1',
  state: 'COMPLETED',
  scheduledAt: local(2026, 9, 1),
  completedAt: local(2026, 9, 1, 10),
  doctorName: 'Dr. Rohan Patel',
  specialization: 'General Medicine',
  patientName: 'Jordan Lee',
  notes: [],
  prescriptions: [],
  ...over,
});

describe('buildPatientList', () => {
  it('deduplicates a patient seen more than once', () => {
    const list = buildPatientList([
      { patientProfile: { id: 'p1', name: 'Jordan Lee' }, scheduledAt: local(2026, 9, 1), status: 'COMPLETED' },
      { patientProfile: { id: 'p1', name: 'Jordan Lee' }, scheduledAt: local(2026, 9, 10), status: 'BOOKED' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.appointmentCount).toBe(2);
  });

  it('tracks the soonest upcoming and most recent past appointment', () => {
    const now = new Date(2026, 8, 15, 12, 0);
    const list = buildPatientList(
      [
        { patientProfile: { id: 'p1', name: 'A' }, scheduledAt: local(2026, 9, 1), status: 'COMPLETED' },
        { patientProfile: { id: 'p1', name: 'A' }, scheduledAt: local(2026, 9, 20), status: 'BOOKED' },
        { patientProfile: { id: 'p1', name: 'A' }, scheduledAt: local(2026, 9, 25), status: 'BOOKED' },
      ],
      now,
    );
    // Soonest upcoming is the 20th, not the 25th.
    expect(list[0]!.nextAppointmentAt).toBe(local(2026, 9, 20));
    expect(list[0]!.lastAppointmentAt).toBe(local(2026, 9, 1));
  });

  it('does not treat a cancelled future appointment as upcoming', () => {
    const now = new Date(2026, 8, 15, 12, 0);
    const list = buildPatientList(
      [{ patientProfile: { id: 'p1', name: 'A' }, scheduledAt: local(2026, 9, 20), status: 'CANCELLED' }],
      now,
    );
    expect(list[0]!.nextAppointmentAt).toBeNull();
    expect(list[0]!.lastAppointmentAt).toBe(local(2026, 9, 20));
  });

  it('skips appointments with no joined patient profile', () => {
    const list = buildPatientList([
      { patientProfile: null, scheduledAt: local(2026, 9, 1), status: 'BOOKED' },
    ]);
    expect(list).toHaveLength(0);
  });

  it('orders patients with upcoming appointments first', () => {
    const now = new Date(2026, 8, 15, 12, 0);
    const list = buildPatientList(
      [
        { patientProfile: { id: 'past', name: 'Past Patient' }, scheduledAt: local(2026, 8, 1), status: 'COMPLETED' },
        { patientProfile: { id: 'soon', name: 'Soon Patient' }, scheduledAt: local(2026, 9, 16), status: 'BOOKED' },
        { patientProfile: { id: 'later', name: 'Later Patient' }, scheduledAt: local(2026, 9, 30), status: 'BOOKED' },
      ],
      now,
    );
    expect(list.map((p) => p.name)).toEqual(['Soon Patient', 'Later Patient', 'Past Patient']);
  });

  it('orders the remainder by most recent contact', () => {
    const now = new Date(2026, 8, 15, 12, 0);
    const list = buildPatientList(
      [
        { patientProfile: { id: 'old', name: 'Old' }, scheduledAt: local(2026, 5, 1), status: 'COMPLETED' },
        { patientProfile: { id: 'new', name: 'New' }, scheduledAt: local(2026, 8, 20), status: 'COMPLETED' },
      ],
      now,
    );
    expect(list.map((p) => p.name)).toEqual(['New', 'Old']);
  });
});

describe('filterPatients', () => {
  const patients = buildPatientList([
    { patientProfile: { id: 'p1', name: 'Jordan Lee' }, scheduledAt: local(2026, 9, 1), status: 'BOOKED' },
    { patientProfile: { id: 'p2', name: 'Alex Kim' }, scheduledAt: local(2026, 9, 2), status: 'BOOKED' },
  ]);

  it('matches case-insensitively on a substring', () => {
    expect(filterPatients(patients, 'jord')).toHaveLength(1);
    expect(filterPatients(patients, 'JORD')).toHaveLength(1);
    expect(filterPatients(patients, 'lee')).toHaveLength(1);
  });

  it('returns everyone for a blank query', () => {
    expect(filterPatients(patients, '')).toHaveLength(2);
    expect(filterPatients(patients, '   ')).toHaveLength(2);
  });

  it('returns nothing when there is no match', () => {
    expect(filterPatients(patients, 'zzz')).toHaveLength(0);
  });
});

describe('hasClinicalContent / isCompleted / isUpcoming', () => {
  it('reports content only when notes or prescriptions exist', () => {
    expect(hasClinicalContent(record({ notes: [], prescriptions: [] }))).toBe(false);
    expect(
      hasClinicalContent(
        record({ notes: [{ id: 'n', sessionId: 's', findings: 'x', recommendations: null, recordedAt: '' }] }),
      ),
    ).toBe(true);
    expect(
      hasClinicalContent(
        record({ prescriptions: [{ id: 'r', sessionId: 's', details: 'y', issuedAt: '' }] }),
      ),
    ).toBe(true);
  });

  it('distinguishes a completed consult from an upcoming one', () => {
    expect(isCompleted(record({ state: 'COMPLETED' }))).toBe(true);
    expect(isUpcoming(record({ state: 'COMPLETED' }))).toBe(false);

    // A JOINED session with empty content is NOT "no records written" — it has
    // not happened yet. These must not be confused.
    const joined = record({ state: 'JOINED', completedAt: null, notes: [], prescriptions: [] });
    expect(isCompleted(joined)).toBe(false);
    expect(isUpcoming(joined)).toBe(true);
    expect(hasClinicalContent(joined)).toBe(false);
  });
});

describe('countEntries', () => {
  it('sums notes and prescriptions across records', () => {
    expect(
      countEntries([
        record({ notes: [{ id: 'n1', sessionId: 's', findings: null, recommendations: null, recordedAt: '' }] }),
        record({ prescriptions: [{ id: 'r1', sessionId: 's', details: '', issuedAt: '' }] }),
      ]),
    ).toBe(2);
  });

  it('is zero for no records', () => {
    expect(countEntries([])).toBe(0);
  });
});

describe('patientLabel / distinctPatients', () => {
  it('falls back when the patient name is null', () => {
    expect(patientLabel(record({ patientName: null }))).toBe('Patient unavailable');
    expect(patientLabel(record({ patientName: 'Jordan Lee' }))).toBe('Jordan Lee');
  });

  it('lists distinct patients alphabetically, ignoring nulls', () => {
    expect(
      distinctPatients([
        record({ patientName: 'Zoe' }),
        record({ patientName: 'Alex' }),
        record({ patientName: 'Zoe' }),
        record({ patientName: null }),
      ]),
    ).toEqual(['Alex', 'Zoe']);
  });
});

describe('stateLabel / stateBadgeVariant', () => {
  it('labels every state', () => {
    expect(stateLabel('SCHEDULED')).toBe('Scheduled');
    expect(stateLabel('JOINED')).toBe('Waiting');
    expect(stateLabel('IN_PROGRESS')).toBe('In progress');
    expect(stateLabel('COMPLETED')).toBe('Completed');
  });

  it('maps states onto semantic badge variants', () => {
    expect(stateBadgeVariant('COMPLETED')).toBe('success');
    expect(stateBadgeVariant('IN_PROGRESS')).toBe('default');
    expect(stateBadgeVariant('JOINED')).toBe('muted');
    expect(stateBadgeVariant('SCHEDULED')).toBe('muted');
  });
});

describe('groupRecordsByYear', () => {
  it('groups by completion year, newest year first', () => {
    const groups = groupRecordsByYear([
      record({ sessionId: 'a', completedAt: local(2025, 3, 1) }),
      record({ sessionId: 'b', completedAt: local(2026, 9, 1) }),
    ]);
    expect(groups.map((g) => g.year)).toEqual(['2026', '2025']);
  });

  it('groups an upcoming session by its scheduled year (no completedAt)', () => {
    const groups = groupRecordsByYear([
      record({ sessionId: 'a', state: 'JOINED', completedAt: null, scheduledAt: local(2026, 12, 20) }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.year).toBe('2026');
  });

  it('sorts newest first within a year', () => {
    const groups = groupRecordsByYear([
      record({ sessionId: 'older', completedAt: local(2026, 1, 5) }),
      record({ sessionId: 'newer', completedAt: local(2026, 9, 5) }),
    ]);
    expect(groups[0]!.records.map((r) => r.sessionId)).toEqual(['newer', 'older']);
  });

  it('returns nothing for no records', () => {
    expect(groupRecordsByYear([])).toEqual([]);
  });
});

describe('formatRecordDate', () => {
  it('renders an em dash for a null date rather than "Invalid Date"', () => {
    expect(formatRecordDate(null)).toBe('—');
  });

  it('renders a real date', () => {
    const label = formatRecordDate(local(2026, 9, 1));
    expect(label).toContain('2026');
    expect(label).toContain('Sep');
  });
});
