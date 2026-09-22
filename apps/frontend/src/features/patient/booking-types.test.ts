import { describe, expect, it } from 'vitest';

import {
  formatDayLabel,
  groupSlotsByDay,
  isActionable,
  partitionAppointments,
  type Appointment,
  type AvailabilitySlot,
} from './booking-types';

const slot = (id: string, startIso: string, endIso = startIso): AvailabilitySlot => ({
  id,
  startTime: startIso,
  endTime: endIso,
  isBlocked: false,
});

// Local-time ISO helper so tests don't depend on the machine's timezone offset.
// Using local components keeps day-grouping assertions stable anywhere.
const local = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).toISOString();

const appt = (over: Partial<Appointment>): Appointment => ({
  id: 'appt-1',
  patientProfileId: 'pat-1',
  doctorProfileId: 'doc-1',
  availabilityId: 'slot-1',
  status: 'BOOKED',
  scheduledAt: local(2026, 9, 23, 9),
  doctorProfile: {
    id: 'doc-1',
    name: 'Dr. Camila Reyes',
    specialization: 'General Medicine',
    approvalStatus: 'APPROVED',
  },
  // The backend joins the consultation session onto every appointment read so
  // the row can link into the consultation workspace (sub-item 5).
  consultationSession: { id: 'sess-1', state: 'SCHEDULED' },
  ...over,
});

describe('groupSlotsByDay', () => {
  const now = new Date(2026, 8, 22, 12, 0, 0); // 22 Sep 2026, local noon

  it('groups slots into one entry per local calendar day', () => {
    const groups = groupSlotsByDay(
      [
        slot('a', local(2026, 9, 23, 9)),
        slot('b', local(2026, 9, 23, 10)),
        slot('c', local(2026, 9, 24, 9)),
      ],
      now,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]?.slots.map((s) => s.id)).toEqual(['a', 'b']);
    expect(groups[1]?.slots.map((s) => s.id)).toEqual(['c']);
  });

  it('orders days chronologically and slots by time within a day', () => {
    const groups = groupSlotsByDay(
      [
        slot('late', local(2026, 9, 25, 15)),
        slot('early', local(2026, 9, 23, 9)),
        slot('mid', local(2026, 9, 23, 14)),
        slot('soonest', local(2026, 9, 23, 8)),
      ],
      now,
    );

    expect(groups.map((g) => g.key)).toEqual(['2026-09-23', '2026-09-25']);
    expect(groups[0]?.slots.map((s) => s.id)).toEqual(['soonest', 'early', 'mid']);
  });

  it('labels today and tomorrow relatively, and further days by date', () => {
    const groups = groupSlotsByDay(
      [
        slot('t', local(2026, 9, 22, 15)),
        slot('tm', local(2026, 9, 23, 9)),
        slot('later', local(2026, 9, 28, 9)),
      ],
      now,
    );

    expect(groups[0]?.label).toBe('Today');
    expect(groups[1]?.label).toBe('Tomorrow');
    // Further out, the exact date matters more than "in 6 days".
    expect(groups[2]?.label).not.toBe('Today');
    expect(groups[2]?.label).not.toBe('Tomorrow');
    expect(groups[2]?.label.length).toBeGreaterThan(0);
  });

  it('handles a month boundary when computing "Tomorrow"', () => {
    const endOfMonth = new Date(2026, 8, 30, 12, 0, 0); // 30 Sep
    const groups = groupSlotsByDay([slot('x', local(2026, 10, 1, 9))], endOfMonth);
    expect(groups[0]?.label).toBe('Tomorrow');
  });

  it('returns an empty array for no slots', () => {
    expect(groupSlotsByDay([], now)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [slot('b', local(2026, 9, 23, 10)), slot('a', local(2026, 9, 23, 9))];
    const snapshot = input.map((s) => s.id);
    groupSlotsByDay(input, now);
    expect(input.map((s) => s.id)).toEqual(snapshot);
  });
});

describe('formatDayLabel', () => {
  const now = new Date(2026, 8, 22, 12, 0, 0);
  it('is Today for the same local day at a different hour', () => {
    expect(formatDayLabel(local(2026, 9, 22, 23), now)).toBe('Today');
  });
  it('is Tomorrow for the next local day', () => {
    expect(formatDayLabel(local(2026, 9, 23, 1), now)).toBe('Tomorrow');
  });
});

describe('isActionable', () => {
  it('allows BOOKED and RESCHEDULED', () => {
    expect(isActionable('BOOKED')).toBe(true);
    expect(isActionable('RESCHEDULED')).toBe(true);
  });
  it('blocks CANCELLED and COMPLETED', () => {
    expect(isActionable('CANCELLED')).toBe(false);
    expect(isActionable('COMPLETED')).toBe(false);
  });
});

describe('partitionAppointments', () => {
  const now = new Date(2026, 8, 22, 12, 0, 0);

  it('puts future actionable appointments in upcoming, soonest first', () => {
    const { upcoming, past } = partitionAppointments(
      [
        appt({ id: 'far', scheduledAt: local(2026, 9, 30, 9) }),
        appt({ id: 'near', scheduledAt: local(2026, 9, 23, 9) }),
      ],
      now,
    );
    expect(upcoming.map((a) => a.id)).toEqual(['near', 'far']);
    expect(past).toEqual([]);
  });

  it('puts a CANCELLED future appointment in past, not upcoming', () => {
    // The appointment will not take place, so it does not belong in "upcoming"
    // even though its scheduledAt is in the future.
    const { upcoming, past } = partitionAppointments(
      [appt({ id: 'cancelled', status: 'CANCELLED', scheduledAt: local(2026, 9, 30, 9) })],
      now,
    );
    expect(upcoming).toEqual([]);
    expect(past.map((a) => a.id)).toEqual(['cancelled']);
  });

  it('puts a COMPLETED future appointment in past', () => {
    const { upcoming, past } = partitionAppointments(
      [appt({ id: 'done', status: 'COMPLETED', scheduledAt: local(2026, 9, 30, 9) })],
      now,
    );
    expect(upcoming).toEqual([]);
    expect(past.map((a) => a.id)).toEqual(['done']);
  });

  it('sorts past most-recent first', () => {
    const { past } = partitionAppointments(
      [
        appt({ id: 'older', scheduledAt: local(2026, 9, 1, 9) }),
        appt({ id: 'newer', scheduledAt: local(2026, 9, 20, 9) }),
      ],
      now,
    );
    expect(past.map((a) => a.id)).toEqual(['newer', 'older']);
  });

  it('treats an appointment exactly now as upcoming', () => {
    const { upcoming } = partitionAppointments(
      [appt({ id: 'now', scheduledAt: now.toISOString() })],
      now,
    );
    expect(upcoming.map((a) => a.id)).toEqual(['now']);
  });
});
