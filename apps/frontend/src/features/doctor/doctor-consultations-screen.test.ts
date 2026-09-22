import { describe, expect, it } from 'vitest';

import { buildConsultationList } from './doctor-consultations-screen';
import type { ConsultationState } from './consultation-workspace-types';

type Appt = Parameters<typeof buildConsultationList>[0][number];

function appt(over: Partial<Appt> & { state?: ConsultationState | null } = {}): Appt {
  const { state = 'SCHEDULED', ...rest } = over;
  return {
    status: 'BOOKED',
    scheduledAt: '2026-09-24T09:00:00.000Z',
    patientProfile: { id: 'p1', name: 'Jordan Lee' },
    consultationSession: state === null ? null : { id: 's1', state },
    ...rest,
  } as Appt;
}

describe('buildConsultationList', () => {
  it('includes only appointments that HAVE a session', () => {
    // An appointment with no session has no room to open; a link would go nowhere.
    const rows = buildConsultationList([
      appt({ state: 'JOINED' }),
      appt({ consultationSession: null }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionId).toBe('s1');
  });

  it('drops cancelled appointments even when a session exists', () => {
    const rows = buildConsultationList([appt({ status: 'CANCELLED', state: 'JOINED' })]);
    expect(rows).toHaveLength(0);
  });

  it('keeps completed appointments — the doctor still reads those records', () => {
    const rows = buildConsultationList([appt({ status: 'COMPLETED', state: 'COMPLETED' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('COMPLETED');
  });

  it('flags JOINED and IN_PROGRESS as needing attention, and nothing else', () => {
    const states: ConsultationState[] = ['SCHEDULED', 'JOINED', 'IN_PROGRESS', 'COMPLETED'];
    for (const state of states) {
      const rows = buildConsultationList([appt({ state })]);
      const expected = state === 'JOINED' || state === 'IN_PROGRESS';
      expect(rows[0]!.needsAttention, `state=${state}`).toBe(expected);
    }
  });

  it('sorts needing-attention rows first', () => {
    const rows = buildConsultationList([
      appt({ state: 'COMPLETED', scheduledAt: '2026-09-01T09:00:00.000Z' }),
      appt({ state: 'JOINED', scheduledAt: '2026-09-24T09:00:00.000Z' }),
      appt({ state: 'SCHEDULED', scheduledAt: '2026-09-30T09:00:00.000Z' }),
    ]);
    expect(rows.map((r) => r.state)).toEqual(['JOINED', 'SCHEDULED', 'COMPLETED']);
  });

  it('orders attention rows soonest-first, so the live one is on top', () => {
    const rows = buildConsultationList([
      appt({ state: 'JOINED', scheduledAt: '2026-09-25T09:00:00.000Z', consultationSession: { id: 'later', state: 'JOINED' } }),
      appt({ state: 'IN_PROGRESS', scheduledAt: '2026-09-24T09:00:00.000Z', consultationSession: { id: 'sooner', state: 'IN_PROGRESS' } }),
    ]);
    expect(rows.map((r) => r.sessionId)).toEqual(['sooner', 'later']);
  });

  it('orders non-attention rows most-recent-first', () => {
    const rows = buildConsultationList([
      appt({ state: 'COMPLETED', scheduledAt: '2026-08-01T09:00:00.000Z', consultationSession: { id: 'old', state: 'COMPLETED' } }),
      appt({ state: 'COMPLETED', scheduledAt: '2026-09-01T09:00:00.000Z', consultationSession: { id: 'new', state: 'COMPLETED' } }),
    ]);
    expect(rows.map((r) => r.sessionId)).toEqual(['new', 'old']);
  });

  it('resolves a missing patient profile to null rather than crashing', () => {
    const rows = buildConsultationList([appt({ patientProfile: null })]);
    expect(rows[0]!.patientName).toBeNull();
  });

  it('returns an empty list for no appointments', () => {
    expect(buildConsultationList([])).toEqual([]);
  });
});
