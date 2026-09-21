// Pure, deterministic booking-conflict detection. No Prisma/Nest/HTTP.
// This is the single source of truth for overlap/conflict rules; booking and
// reschedule both call it rather than duplicating the math.

export type ConflictReason =
  | 'INVALID_WINDOW'
  | 'SLOT_BLOCKED'
  | 'SLOT_ALREADY_CONSUMED'
  | 'OVERLAP';

export type ApptStatus = 'BOOKED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED';

export interface BookingWindow {
  startTime: Date;
  endTime: Date;
}

export interface ExistingBooking {
  availabilityId: string | null;
  startTime: Date;
  endTime: Date;
  status: ApptStatus;
}

export interface TargetSlot {
  id: string;
  isBlocked: boolean;
}

export interface ConflictInput {
  proposed: BookingWindow;
  existingBookings: ExistingBooking[];
  targetSlot: TargetSlot | null;
}

export interface ConflictResult {
  conflict: boolean;
  reason?: ConflictReason;
}

// Only CANCELLED frees a slot; every other status is "active" for conflict purposes.
const NON_BLOCKING_STATUSES: ReadonlySet<ApptStatus> = new Set<ApptStatus>(['CANCELLED']);

// Half-open interval overlap: [aStart, aEnd) overlaps [bStart, bEnd) iff aStart < bEnd && bStart < aEnd.
// Adjacent slots (10:00-11:00 and 11:00-12:00) do NOT overlap.
export function windowsOverlap(a: BookingWindow, b: BookingWindow): boolean {
  return (
    a.startTime.getTime() < b.endTime.getTime() &&
    b.startTime.getTime() < a.endTime.getTime()
  );
}

export function detectBookingConflict(input: ConflictInput): ConflictResult {
  const { proposed, existingBookings, targetSlot } = input;

  // 1) Invalid window: end must be strictly after start.
  if (proposed.endTime.getTime() <= proposed.startTime.getTime()) {
    return { conflict: true, reason: 'INVALID_WINDOW' };
  }

  // 2) Blocked slot: the doctor has withdrawn this slot from booking.
  if (targetSlot && targetSlot.isBlocked) {
    return { conflict: true, reason: 'SLOT_BLOCKED' };
  }

  // 3) Same availability slot already consumed by an active booking.
  if (targetSlot) {
    const consumed = existingBookings.some(
      (b) => b.availabilityId === targetSlot.id && !NON_BLOCKING_STATUSES.has(b.status),
    );
    if (consumed) {
      return { conflict: true, reason: 'SLOT_ALREADY_CONSUMED' };
    }
  }

  // 4) Overlap with any active booking for the same doctor.
  const overlaps = existingBookings.some(
    (b) => !NON_BLOCKING_STATUSES.has(b.status) && windowsOverlap(proposed, b),
  );
  if (overlaps) {
    return { conflict: true, reason: 'OVERLAP' };
  }

  return { conflict: false };
}
