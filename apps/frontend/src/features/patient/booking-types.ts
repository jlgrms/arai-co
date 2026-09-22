/**
 * Booking (Layer 6 sub-item 4) — types and pure helpers.
 *
 * Contracts mirror the backend:
 *   - `GET /doctors/:id`          -> DoctorWithSlots (bookable slots only)
 *   - `POST /appointments`        -> Appointment
 *   - `PATCH /appointments/:id/reschedule`
 *   - `PATCH /appointments/:id/cancel`
 *   - `GET /appointments/me`
 *
 * "Bookable" is decided SERVER-side: the nested `availabilities` are already
 * filtered to unblocked, future, unconsumed slots. The frontend must not
 * re-derive that — it would drift from the conflict rules that the backend
 * enforces atomically at write time.
 */

import type { DoctorPublic } from './discover-types';

/** A bookable availability slot. `id` is what `availabilityId` refers to. */
export interface AvailabilitySlot {
  id: string;
  startTime: string;
  endTime: string;
  isBlocked: boolean;
}

/** `GET /doctors/:id` — public doctor plus their bookable slots. */
export interface DoctorWithSlots extends DoctorPublic {
  availabilities: AvailabilitySlot[];
}

export type AppointmentStatus = 'BOOKED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED';

/**
 * An appointment row. `doctorProfile` is joined server-side so the row is
 * self-describing: the UI can always name the doctor, even if that doctor is
 * later un-approved and therefore absent from the discoverable list.
 *
 * `consultationSession` is joined too, so a row can link into the consultation
 * workspace (sub-item 5). The workspace is keyed by SESSION id, which is a
 * different UUID from the appointment id and cannot be derived from it.
 */
export interface Appointment {
  id: string;
  patientProfileId: string;
  doctorProfileId: string;
  availabilityId: string | null;
  status: AppointmentStatus;
  scheduledAt: string;
  doctorProfile: {
    id: string;
    name: string;
    specialization: string;
    approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  };
  consultationSession: {
    id: string;
    state: 'SCHEDULED' | 'JOINED' | 'IN_PROGRESS' | 'COMPLETED';
  } | null;
}

/** Local calendar day key, e.g. "2026-09-23". Groups slots by the day the
 *  PATIENT sees, so a slot is never listed under the wrong date. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export interface SlotDayGroup {
  /** Local calendar day, "YYYY-MM-DD". */
  key: string;
  /** Human label for the day heading, e.g. "Tomorrow, 24 Sep" or "Wed, 23 Sep". */
  label: string;
  slots: AvailabilitySlot[];
}

/**
 * Group slots by local calendar day, preserving chronological order.
 *
 * The backend returns slots ascending by startTime; grouping keeps that order so
 * the soonest day is first, and within a day the soonest time is first. This is
 * what makes the picker scannable — a flat list of N slots gives the patient no
 * sense of which day they are choosing.
 */
export function groupSlotsByDay(
  slots: AvailabilitySlot[],
  now: Date = new Date(),
): SlotDayGroup[] {
  const sorted = [...slots].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  const groups = new Map<string, AvailabilitySlot[]>();
  for (const slot of sorted) {
    const key = dayKey(slot.startTime);
    const bucket = groups.get(key);
    if (bucket) bucket.push(slot);
    else groups.set(key, [slot]);
  }

  return [...groups.entries()].map(([key, daySlots]) => ({
    key,
    label: formatDayLabel(daySlots[0]!.startTime, now),
    slots: daySlots,
  }));
}

/** "Today" / "Tomorrow" / "Wed, 24 Sep" — relative where it helps, dated where it must be exact. */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const target = dayKey(iso);
  const today = dayKey(now.toISOString());

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowKey = dayKey(tomorrow.toISOString());

  if (target === today) return 'Today';
  if (target === tomorrowKey) return 'Tomorrow';

  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Clock time for a slot, e.g. "09:00". */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Full date+time for an appointment row, e.g. "Wed, 24 Sep 2026, 09:00". */
export function formatAppointmentWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Statuses that can still be cancelled or moved.
 *
 * COMPLETED is terminal (the consultation happened), and CANCELLED is already
 * done — the backend rejects reschedule for both with a 400. Exposing the action
 * and letting the server reject it would be a worse experience than not offering
 * it, so the UI asks the same question here.
 */
export function isActionable(status: AppointmentStatus): boolean {
  return status !== 'CANCELLED' && status !== 'COMPLETED';
}

/** Split appointments into upcoming vs past for the two list sections. */
export function partitionAppointments(
  appointments: Appointment[],
  now: Date = new Date(),
): { upcoming: Appointment[]; past: Appointment[] } {
  const upcoming: Appointment[] = [];
  const past: Appointment[] = [];
  for (const appt of appointments) {
    const isFuture = new Date(appt.scheduledAt).getTime() >= now.getTime();
    // A cancelled appointment is historical regardless of its scheduled time —
    // it will not take place, so it does not belong in "upcoming".
    if (isFuture && isActionable(appt.status)) upcoming.push(appt);
    else past.push(appt);
  }
  upcoming.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  past.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
  return { upcoming, past };
}
