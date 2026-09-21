import { detectBookingConflict } from './booking-conflict';

// day-relative helpers (UTC) — full ISO strings, no timezone surprises
const at = (hour: number) => new Date(`2026-01-05T${String(hour).padStart(2, '0')}:00:00.000Z`);

describe('booking-conflict engine (pure)', () => {
  const slot = { id: 'slot-1', isBlocked: false };

  it('accepts an open slot with no bookings', () => {
    const r = detectBookingConflict({
      proposed: { startTime: at(9), endTime: at(10) },
      existingBookings: [],
      targetSlot: slot,
    });
    expect(r.conflict).toBe(false);
  });

  it('rejects an overlapping slot with an active booking', () => {
    const r = detectBookingConflict({
      proposed: { startTime: at(9), endTime: at(10) },
      existingBookings: [
        { availabilityId: 'other', startTime: at(9), endTime: at(10), status: 'BOOKED' },
      ],
      targetSlot: slot,
    });
    expect(r).toEqual({ conflict: true, reason: 'OVERLAP' });
  });

  it('accepts ADJACENT non-overlapping slots (10-11 after 9-10)', () => {
    const r = detectBookingConflict({
      proposed: { startTime: at(10), endTime: at(11) },
      existingBookings: [
        { availabilityId: 'other', startTime: at(9), endTime: at(10), status: 'BOOKED' },
      ],
      targetSlot: { id: 'slot-2', isBlocked: false },
    });
    expect(r.conflict).toBe(false);
  });

  it('rejects double-booking the SAME availability slot', () => {
    const r = detectBookingConflict({
      proposed: { startTime: at(9), endTime: at(10) },
      existingBookings: [
        { availabilityId: 'slot-1', startTime: at(9), endTime: at(10), status: 'BOOKED' },
      ],
      targetSlot: slot,
    });
    expect(r).toEqual({ conflict: true, reason: 'SLOT_ALREADY_CONSUMED' });
  });

  it('rejects a BLOCKED slot', () => {
    const r = detectBookingConflict({
      proposed: { startTime: at(9), endTime: at(10) },
      existingBookings: [],
      targetSlot: { id: 'slot-1', isBlocked: true },
    });
    expect(r).toEqual({ conflict: true, reason: 'SLOT_BLOCKED' });
  });

  it('ignores CANCELLED bookings (cancelled frees the slot)', () => {
    const r = detectBookingConflict({
      proposed: { startTime: at(9), endTime: at(10) },
      existingBookings: [
        { availabilityId: 'slot-1', startTime: at(9), endTime: at(10), status: 'CANCELLED' },
      ],
      targetSlot: slot,
    });
    expect(r.conflict).toBe(false);
  });

  it('rejects an invalid window (end <= start)', () => {
    const r = detectBookingConflict({
      proposed: { startTime: at(10), endTime: at(10) },
      existingBookings: [],
      targetSlot: slot,
    });
    expect(r).toEqual({ conflict: true, reason: 'INVALID_WINDOW' });
  });
});
