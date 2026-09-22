/**
 * Doctor flows (Layer 7) — shared types and pure helpers.
 *
 * Contracts mirror the backend:
 *   - GET/PATCH /doctors/me                    -> DoctorPublic (own profile)
 *   - GET/POST /doctors/me/availability        -> AvailabilitySlot (own schedule)
 *   - PATCH/DELETE /doctors/me/availability/:id
 *   - GET /appointments/me                     -> Appointment (doctor-scoped)
 *   - GET /consultations/records/patient/:id   -> DoctorPatientRecord
 *
 * Shapes are taken from the backend projections
 * (DOCTOR_PUBLIC_SELECT, listOwnAvailability's select) — no passwordHash, no
 * user internals. `DoctorPublic` is imported rather than redeclared so the
 * doctor's own profile and the public discovery card can never drift.
 */

import type { DoctorPublic } from '../patient/discover-types';

export type { DoctorPublic };

/**
 * A slot in the doctor's OWN schedule.
 *
 * Note this differs from the patient-facing `AvailabilitySlot`: that one is
 * filtered server-side to bookable slots only. A doctor must see the whole
 * schedule — including blocked slots and ones already consumed by a booking —
 * otherwise a slot would silently vanish from their view with no explanation.
 * `isBlocked` is therefore rendered, not filtered on, here.
 */
export interface AvailabilitySlot {
  id: string;
  startTime: string;
  endTime: string;
  isBlocked: boolean;
}

/**
 * A slot paired with the appointment occupying it, if any.
 *
 * The backend does not return this join, so it is derived client-side by
 * matching `Appointment.availabilityId`. Derived rather than fetched: the doctor
 * already loads their appointments for the consultations list, so a second
 * round-trip would duplicate data the client holds.
 */
export interface ScheduleSlot extends AvailabilitySlot {
  /** The appointment occupying this slot, or null when the slot is free. */
  bookedBy: {
    id: string;
    patientName: string;
    status: string;
  } | null;
  /** True when this slot cannot be booked — blocked by the doctor, or already taken. */
  unavailable: boolean;
}

/**
 * Whether a slot's times/flags may be edited or the slot deleted.
 *
 * The backend SEALS a slot consumed by a live (non-cancelled) appointment:
 * updateAvailability and deleteAvailability both run assertSlotNotConsumed and
 * throw 409. Editing such a slot would invalidate an already-booked appointment
 * out from under the patient, which S5.3 says the app must prevent.
 *
 * This is NOT the same as `unavailable`. A doctor-blocked slot is unavailable
 * (nobody can book it) but still fully editable — the doctor owns that decision
 * and may unblock it. A booked slot is unavailable AND sealed. The UI must
 * separate the two or it would offer an action the server always rejects.
 */
export function isSlotSealed(slot: ScheduleSlot): boolean {
  // Sealed iff a live appointment holds it. `isBlocked` is irrelevant here.
  return slot.bookedBy !== null;
}

/**
 * Why a slot cannot be edited/deleted, in the doctor's terms — or null when it
 * can. Used to disable the controls and explain the reason, rather than letting
 * the doctor discover the 409.
 */
export function slotSealedReason(slot: ScheduleSlot): string | null {
  if (!slot.bookedBy) return null;
  return `Booked by ${slot.bookedBy.patientName} — cancel or reschedule that appointment first.`;
}

/** A patient record row as returned by the doctor-scoped records endpoint. */
export interface DoctorPatientRecord {
  sessionId: string;
  /** SCHEDULED | JOINED | IN_PROGRESS | COMPLETED. */
  state: 'SCHEDULED' | 'JOINED' | 'IN_PROGRESS' | 'COMPLETED';
  /** The appointment time. Always present, including for upcoming sessions. */
  scheduledAt: string;
  /** When the session was completed; null while it is still upcoming/active. */
  completedAt: string | null;
  doctorName: string | null;
  specialization: string | null;
  /** The counterparty for a doctor — whose records these are. */
  patientName: string | null;
  notes: Array<{ id: string; content?: string; createdAt?: string }>;
  prescriptions: Array<{ id: string; medication?: string; dosage?: string; createdAt?: string }>;
}

/** PATCH /doctors/me — partial; only changed fields are sent. */
export interface UpdateDoctorProfileInput {
  name?: string;
  biography?: string;
  specialization?: string;
}

/** POST /doctors/me/availability */
export interface CreateAvailabilityInput {
  startTime: string;
  endTime: string;
  isBlocked?: boolean;
}

/** PATCH /doctors/me/availability/:id */
export interface UpdateAvailabilityInput {
  startTime?: string;
  endTime?: string;
  isBlocked?: boolean;
}

/**
 * The specializations the product actually offers.
 *
 * A free-text specialization field lets a doctor type "Cardiologoy" and then
 * become unfindable by the discovery filter, which matches exactly. The set is
 * fixed to the seeded specialties so the value always round-trips through
 * discovery and matching.
 */
export const SPECIALIZATIONS = [
  'General Medicine',
  'Cardiology',
  'Dermatology',
  'Psychiatry',
  'Pediatrics',
] as const;

export type Specialization = (typeof SPECIALIZATIONS)[number];

/** True when the value is one of the offered specializations. */
export function isKnownSpecialization(value: string): value is Specialization {
  return (SPECIALIZATIONS as readonly string[]).includes(value);
}

/**
 * Group a doctor's slots by local calendar day for display.
 *
 * Mirrors the patient-side `groupSlotsByDay` but is declared separately because
 * the two operate on different inputs (schedule slots vs bookable slots) and
 * need different labels. Sorting is ascending so the soonest day is first.
 */
export interface ScheduleDayGroup {
  key: string;
  label: string;
  slots: ScheduleSlot[];
}

/** Local calendar day key, e.g. "2026-09-23". */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** "Today" / "Tomorrow" / "Wed, 24 Sep". */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const target = dayKey(iso);
  const today = dayKey(now.toISOString());
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (target === today) return 'Today';
  if (target === dayKey(tomorrow.toISOString())) return 'Tomorrow';
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Clock time, e.g. "09:00". */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "09:00 – 09:30" */
export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

/**
 * Join the doctor's slots to their appointments and group by day.
 *
 * A slot is unavailable when the doctor blocked it OR an active (non-cancelled)
 * appointment holds it. Cancelled appointments do not hold a slot — the backend
 * nulls `availabilityId` on cancel, so a cancelled row would not match anyway,
 * but the status check keeps this honest if that ever changes.
 */
export function buildSchedule(
  slots: AvailabilitySlot[],
  appointments: Array<{
    id: string;
    availabilityId: string | null;
    status: string;
    patientProfile: { name: string } | null;
  }>,
  now: Date = new Date(),
): ScheduleDayGroup[] {
  const bySlot = new Map<string, ScheduleSlot['bookedBy']>();
  for (const appt of appointments) {
    if (!appt.availabilityId) continue;
    if (appt.status === 'CANCELLED') continue;
    bySlot.set(appt.availabilityId, {
      id: appt.id,
      patientName: appt.patientProfile?.name ?? 'Patient',
      status: appt.status,
    });
  }

  const enriched: ScheduleSlot[] = slots
    .map((slot) => {
      const bookedBy = bySlot.get(slot.id) ?? null;
      return { ...slot, bookedBy, unavailable: slot.isBlocked || bookedBy !== null };
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const groups = new Map<string, ScheduleSlot[]>();
  for (const slot of enriched) {
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

/** Counts for the schedule summary, so the doctor sees the shape of their week. */
export function summarizeSchedule(groups: ScheduleDayGroup[]): {
  total: number;
  booked: number;
  blocked: number;
  free: number;
} {
  let total = 0;
  let booked = 0;
  let blocked = 0;
  let free = 0;
  for (const group of groups) {
    for (const slot of group.slots) {
      total += 1;
      if (slot.bookedBy) booked += 1;
      else if (slot.isBlocked) blocked += 1;
      else free += 1;
    }
  }
  return { total, booked, blocked, free };
}

/**
 * Convert two `datetime-local` input values into the ISO strings the API
 * expects, validating the window first.
 *
 * `datetime-local` yields a bare local wall-clock string ("2026-09-23T09:00")
 * with no timezone. `new Date(...)` interprets it in the browser's local zone,
 * which is what the doctor intended when they typed it; `.toISOString()` then
 * sends a correct UTC instant. Sending the raw string would be ambiguous.
 */
export function toAvailabilityPayload(
  startLocal: string,
  endLocal: string,
  isBlocked: boolean,
): { ok: true; value: CreateAvailabilityInput } | { ok: false; error: string } {
  if (!startLocal || !endLocal) {
    return { ok: false, error: 'Start and end times are required.' };
  }
  const start = new Date(startLocal);
  const end = new Date(endLocal);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, error: 'Enter a valid start and end time.' };
  }
  if (end.getTime() <= start.getTime()) {
    return { ok: false, error: 'End time must be after start time.' };
  }
  return {
    ok: true,
    value: {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      isBlocked,
    },
  };
}

/**
 * `datetime-local` needs a bare local string; an ISO instant would render in
 * UTC and shift the displayed time. Slice the local components rather than
 * converting through UTC.
 */
export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * A slot in the past cannot be edited or meaningfully offered — the booking
 * conflict rules reject past windows, so the UI should not offer the action.
 */
export function isPastSlot(slot: { startTime: string }, now: Date = new Date()): boolean {
  return new Date(slot.startTime).getTime() < now.getTime();
}

/** Human label for a slot's state, used on badges. */
export function slotStateLabel(slot: ScheduleSlot): string {
  if (slot.bookedBy) return 'Booked';
  if (slot.isBlocked) return 'Blocked';
  return 'Open';
}
