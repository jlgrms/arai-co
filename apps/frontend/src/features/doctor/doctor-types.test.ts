import { describe, expect, it } from 'vitest';

import {
  buildSchedule,
  formatTimeRange,
  isKnownSpecialization,
  isPastSlot,
  slotStateLabel,
  SPECIALIZATIONS,
  summarizeSchedule,
  toAvailabilityPayload,
  toLocalInputValue,
} from './doctor-types';

describe('isKnownSpecialization', () => {
  it('accepts every offered specialization', () => {
    for (const s of SPECIALIZATIONS) {
      expect(isKnownSpecialization(s)).toBe(true);
    }
  });

  it('rejects a near-miss typo so the doctor cannot become undiscoverable', () => {
    // Discovery filters by exact match; a typo here would silently hide them.
    expect(isKnownSpecialization('Cardiologoy')).toBe(false);
    expect(isKnownSpecialization('cardiology')).toBe(false);
    expect(isKnownSpecialization('')).toBe(false);
  });
});

describe('toAvailabilityPayload', () => {
  it('converts local wall-clock input to a correct UTC instant', () => {
    const result = toAvailabilityPayload('2026-09-23T09:00', '2026-09-23T09:30', false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const start = new Date(result.value.startTime);
    // Whatever the runner's zone, the round-trip must preserve the instant.
    expect(start.getTime()).toBe(new Date('2026-09-23T09:00').getTime());
    expect(result.value.isBlocked).toBe(false);
  });

  it('rejects an end that is not after the start', () => {
    const same = toAvailabilityPayload('2026-09-23T09:00', '2026-09-23T09:00', false);
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error).toMatch(/after start/i);

    const backwards = toAvailabilityPayload('2026-09-23T10:00', '2026-09-23T09:00', false);
    expect(backwards.ok).toBe(false);
  });

  it('requires both endpoints', () => {
    expect(toAvailabilityPayload('', '2026-09-23T09:30', false).ok).toBe(false);
    expect(toAvailabilityPayload('2026-09-23T09:00', '', false).ok).toBe(false);
  });

  it('passes the blocked flag through', () => {
    const result = toAvailabilityPayload('2026-09-23T09:00', '2026-09-23T09:30', true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.isBlocked).toBe(true);
  });
});

describe('toLocalInputValue', () => {
  it('round-trips through toAvailabilityPayload without drifting', () => {
    const iso = new Date('2026-09-23T09:00').toISOString();
    const local = toLocalInputValue(iso);
    const back = toAvailabilityPayload(local, toLocalInputValue(new Date('2026-09-23T09:30').toISOString()), false);

    expect(back.ok).toBe(true);
    if (back.ok) expect(new Date(back.value.startTime).getTime()).toBe(new Date(iso).getTime());
  });

  it('does not shift the displayed time (no UTC conversion)', () => {
    // A 09:00 local instant must render as 09:00 in the input, not 09:00Z.
    const d = new Date(2026, 8, 23, 9, 0);
    expect(toLocalInputValue(d.toISOString())).toBe('2026-09-23T09:00');
  });
});

describe('formatTimeRange', () => {
  it('renders both ends', () => {
    const start = new Date(2026, 8, 23, 9, 0).toISOString();
    const end = new Date(2026, 8, 23, 9, 30).toISOString();
    const label = formatTimeRange(start, end);
    expect(label).toContain('09:00');
    expect(label).toContain('09:30');
    expect(label).toContain('–');
  });
});

describe('buildSchedule', () => {
  const slot = (id: string, startHour: number, isBlocked = false) => ({
    id,
    startTime: new Date(2026, 8, 23, startHour, 0).toISOString(),
    endTime: new Date(2026, 8, 23, startHour, 30).toISOString(),
    isBlocked,
  });

  it('marks a slot unavailable when an active appointment holds it', () => {
    const groups = buildSchedule(
      [slot('s1', 9), slot('s2', 10)],
      [
        {
          id: 'a1',
          availabilityId: 's1',
          status: 'BOOKED',
          patientProfile: { name: 'Jordan Lee' },
        },
      ],
    );

    const flat = groups.flatMap((g) => g.slots);
    const booked = flat.find((s) => s.id === 's1')!;
    const free = flat.find((s) => s.id === 's2')!;

    expect(booked.unavailable).toBe(true);
    expect(booked.bookedBy?.patientName).toBe('Jordan Lee');
    expect(free.unavailable).toBe(false);
    expect(free.bookedBy).toBeNull();
  });

  it('treats a cancelled appointment as not holding its slot', () => {
    const groups = buildSchedule(
      [slot('s1', 9)],
      [{ id: 'a1', availabilityId: 's1', status: 'CANCELLED', patientProfile: { name: 'X' } }],
    );
    expect(groups.flatMap((g) => g.slots)[0]!.unavailable).toBe(false);
  });

  it('marks a blocked slot unavailable even with no booking', () => {
    const groups = buildSchedule([slot('s1', 9, true)], []);
    const s = groups.flatMap((g) => g.slots)[0]!;
    expect(s.unavailable).toBe(true);
    expect(s.bookedBy).toBeNull();
  });

  it('ignores appointments that hold no slot', () => {
    const groups = buildSchedule(
      [slot('s1', 9)],
      [{ id: 'a1', availabilityId: null, status: 'CANCELLED', patientProfile: null }],
    );
    expect(groups.flatMap((g) => g.slots)[0]!.unavailable).toBe(false);
  });

  it('sorts slots ascending and groups by day', () => {
    const first = {
      id: 'b',
      startTime: new Date(2026, 8, 23, 11, 0).toISOString(),
      endTime: new Date(2026, 8, 23, 11, 30).toISOString(),
      isBlocked: false,
    };
    const second = {
      id: 'a',
      startTime: new Date(2026, 8, 23, 9, 0).toISOString(),
      endTime: new Date(2026, 8, 23, 9, 30).toISOString(),
      isBlocked: false,
    };
    const nextDay = {
      id: 'c',
      startTime: new Date(2026, 8, 24, 9, 0).toISOString(),
      endTime: new Date(2026, 8, 24, 9, 30).toISOString(),
      isBlocked: false,
    };

    const groups = buildSchedule([first, second, nextDay], []);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.slots.map((s) => s.id)).toEqual(['a', 'b']);
    expect(groups[1]!.slots.map((s) => s.id)).toEqual(['c']);
  });

  it('falls back to a generic name when the patient profile is missing', () => {
    const groups = buildSchedule(
      [slot('s1', 9)],
      [{ id: 'a1', availabilityId: 's1', status: 'BOOKED', patientProfile: null }],
    );
    expect(groups.flatMap((g) => g.slots)[0]!.bookedBy?.patientName).toBe('Patient');
  });
});

describe('summarizeSchedule', () => {
  it('counts booked, blocked and free slots', () => {
    const now = new Date();
    const mk = (id: string, isBlocked: boolean, booked: boolean) => ({
      id,
      startTime: now.toISOString(),
      endTime: now.toISOString(),
      isBlocked,
      unavailable: isBlocked || booked,
      bookedBy: booked ? { id: 'a', patientName: 'P', status: 'BOOKED' } : null,
    });

    const groups = [{ key: 'k', label: 'Today', slots: [mk('1', false, true), mk('2', true, false), mk('3', false, false)] }];
    expect(summarizeSchedule(groups)).toEqual({ total: 3, booked: 1, blocked: 1, free: 1 });
  });

  it('returns zeros for an empty schedule', () => {
    expect(summarizeSchedule([])).toEqual({ total: 0, booked: 0, blocked: 0, free: 0 });
  });

  it('does not double-count a blocked slot that is also booked', () => {
    const now = new Date();
    const groups = [
      {
        key: 'k',
        label: 'Today',
        slots: [
          {
            id: '1',
            startTime: now.toISOString(),
            endTime: now.toISOString(),
            isBlocked: true,
            unavailable: true,
            bookedBy: { id: 'a', patientName: 'P', status: 'BOOKED' },
          },
        ],
      },
    ];
    expect(summarizeSchedule(groups)).toEqual({ total: 1, booked: 1, blocked: 0, free: 0 });
  });
});

describe('isPastSlot', () => {
  it('detects past and future slots', () => {
    const now = new Date(2026, 8, 23, 12, 0);
    expect(isPastSlot({ startTime: new Date(2026, 8, 23, 9, 0).toISOString() }, now)).toBe(true);
    expect(isPastSlot({ startTime: new Date(2026, 8, 23, 15, 0).toISOString() }, now)).toBe(false);
  });
});

describe('slotStateLabel', () => {
  it('prefers booked over blocked', () => {
    expect(
      slotStateLabel({
        id: '1',
        startTime: '',
        endTime: '',
        isBlocked: true,
        unavailable: true,
        bookedBy: { id: 'a', patientName: 'P', status: 'BOOKED' },
      }),
    ).toBe('Booked');
  });

  it('labels blocked and open slots', () => {
    const base = { id: '1', startTime: '', endTime: '', unavailable: false, bookedBy: null };
    expect(slotStateLabel({ ...base, isBlocked: true })).toBe('Blocked');
    expect(slotStateLabel({ ...base, isBlocked: false })).toBe('Open');
  });
});
