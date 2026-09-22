// Types and pure helpers for the admin appointment oversight screen (Layer 8
// sub-item 3).
//
// Mirrors GET /admin/appointments and POST /admin/appointments/:id/cancel
// exactly (apps/backend/src/admin/admin.service.ts — listAppointments's inline
// select and cancelAppointment; apps/backend/src/admin/dto/cancel-appointment.dto.ts).
//
// Kept as a separate pure module so the status/session labelling and the
// coherence rules are unit-testable without a DOM — the same split used by
// admin-user-types / admin-doctor-types / booking-types.

import { isActionable } from '@/features/patient/booking-types';

/**
 * Mirrors the Prisma AppointmentStatus enum. Declared here rather than imported
 * from @prisma/client (the frontend never depends on it). This is deliberately
 * the SAME union as booking-types' AppointmentStatus — the admin view and the
 * patient view are two renderings of one column, so they must not drift.
 */
export type AppointmentStatus = 'BOOKED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED';

/** Mirrors the Prisma ConsultationState enum (the session state machine). */
export type ConsultationState = 'SCHEDULED' | 'JOINED' | 'IN_PROGRESS' | 'COMPLETED';

/**
 * One row of GET /admin/appointments.
 *
 * The server's select deliberately carries BOTH profile names — unlike the
 * patient route, where the doctor is the only counterparty shown. An admin is
 * looking at the pair, so both must be nameable. `name` is nullable in the
 * schema for both profiles (a profile created but never filled in), so the
 * display helpers fall back rather than assuming a string.
 *
 * `availabilityId` is present and meaningful here: the admin cancel path nulls
 * it to release the slot, so the column is how an operator confirms a
 * cancellation actually freed the booking.
 *
 * `consultationSession` is a SEPARATE row keyed by a different UUID — it is
 * `{ id, state }` or null (an appointment that never got a session). The pair
 * (appointment.status, session.state) can therefore disagree; see coherence.
 */
export interface AdminAppointment {
  id: string;
  status: AppointmentStatus;
  scheduledAt: string;
  availabilityId: string | null;
  patientProfile: { id: string; name: string | null };
  doctorProfile: { id: string; name: string | null; specialization: string };
  consultationSession: { id: string; state: ConsultationState } | null;
}

/** Body of POST /admin/appointments/:id/cancel. */
export interface CancelAppointmentInput {
  reason?: string;
}

/**
 * The shape POST /admin/appointments/:id/cancel ACTUALLY returns.
 *
 * This is NOT AdminAppointment, and conflating the two is a bug that this
 * type exists to prevent. The service's cancel path returns
 * `prisma.appointment.update(...)` with NO `select`, i.e. the raw Appointment
 * columns — it does NOT include the `patientProfile` / `doctorProfile` /
 * `consultationSession` relations that listAppointments joins in.
 *
 * (Contrast listAppointments, which selects the relations explicitly. The two
 * endpoints on the same entity genuinely have different payload shapes, so the
 * client must merge rather than replace — see mergeCancelledAppointment.)
 */
export interface CancelledAppointmentRow {
  id: string;
  patientProfileId: string;
  doctorProfileId: string;
  availabilityId: string | null;
  status: AppointmentStatus;
  scheduledAt: string;
}

/**
 * Fold a cancel response onto the row already on screen.
 *
 * The cancel response omits every relation, so replacing the row with it would
 * destroy the patient/doctor names and the session — and any code that then
 * reads `consultationSession.state` would throw. That was a real crash: the
 * screen whitescreened to the error boundary on a successful cancel.
 *
 * Only the SCALAR fields the endpoint can actually change are taken from the
 * response (status, availabilityId); everything else is preserved from the row
 * we already hold. `scheduledAt` is copied too since it is authoritative and
 * harmless. The relations are intentionally NOT overwritten.
 */
export function mergeCancelledAppointment(
  existing: AdminAppointment,
  updated: CancelledAppointmentRow,
): AdminAppointment {
  return {
    ...existing,
    status: updated.status,
    availabilityId: updated.availabilityId,
    scheduledAt: updated.scheduledAt,
  };
}

/** The four appointment states, in lifecycle order. */
export const APPOINTMENT_STATUSES: ReadonlyArray<AppointmentStatus> = [
  'BOOKED',
  'RESCHEDULED',
  'CANCELLED',
  'COMPLETED',
];

/**
 * Human label for an appointment status.
 *
 * Identical wording to the patient-side StatusBadge so the same status never
 * reads two ways across the product ("Scheduled" rather than the raw "BOOKED").
 * The distinction from the patient screen is that the admin screen ALSO shows
 * the raw status on hover/in the filter — an operator debugging a stuck booking
 * needs the enum, but the row itself stays in plain language.
 */
export function appointmentStatusLabel(status: AppointmentStatus): string {
  switch (status) {
    case 'BOOKED':
      return 'Scheduled';
    case 'RESCHEDULED':
      return 'Rescheduled';
    case 'CANCELLED':
      return 'Cancelled';
    case 'COMPLETED':
      return 'Completed';
  }
}

/**
 * Badge variant per status — the SAME colour language as the patient screen:
 * success = will happen, danger = did not/will not, muted = history.
 */
export function appointmentStatusVariant(
  status: AppointmentStatus,
): 'success' | 'danger' | 'muted' {
  switch (status) {
    case 'BOOKED':
    case 'RESCHEDULED':
      return 'success';
    case 'CANCELLED':
      return 'danger';
    case 'COMPLETED':
      return 'muted';
  }
}

/** Human label for a consultation session state. */
export function sessionStateLabel(state: ConsultationState): string {
  switch (state) {
    case 'SCHEDULED':
      return 'Not started';
    case 'JOINED':
      return 'Waiting';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'COMPLETED':
      return 'Completed';
  }
}

/**
 * Badge variant for a session state.
 *
 * JOINED/IN_PROGRESS are 'default' (a live consultation is "happening now",
 * which neither success nor a warning describes); COMPLETED is 'muted' (history,
 * matching the appointment status); SCHEDULED is 'outline' (a stub that has not
 * begun, so it should be the quietest thing on the row and not compete with the
 * appointment status badge beside it).
 */
export function sessionStateVariant(
  state: ConsultationState,
): 'default' | 'muted' | 'outline' {
  switch (state) {
    case 'SCHEDULED':
      return 'outline';
    case 'JOINED':
    case 'IN_PROGRESS':
      return 'default';
    case 'COMPLETED':
      return 'muted';
  }
}

/**
 * Whether a (status, session-state) pair is coherent.
 *
 * Flag 4. The two columns live in different tables and are written by different
 * flows, so they CAN contradict each other: a cancelled appointment whose
 * session is still JOINED means either a race or a failed cleanup — precisely
 * the corruption that db-clean-harness-users.sh section 2b exists to remove.
 *
 * The rules below are derived from the state machine, not invented:
 *
 *  - A LIVE session (JOINED/IN_PROGRESS) on a CLOSED appointment (CANCELLED or
 *    COMPLETED) is the classic cleanup failure — a consultation is still open
 *    against an appointment that is over. This is the case that matters.
 *  - A COMPLETED session on a CANCELLED appointment is contradictory: the
 *    consultation cannot have finished if the appointment was called off.
 *  - A COMPLETED session on a still-live appointment is impossible — the visit
 *    concluded before the appointment did.
 *  - COMPLETED + COMPLETED is the NORMAL healthy end state (the baseline has
 *    several) and must NOT be flagged. Likewise a session left SCHEDULED is
 *    merely stale bookkeeping (it need never have started), so it is not flagged
 *    — flagging it would light up ordinary rows for no reason.
 *  - Otherwise the pair is fine.
 *
 * The screen surfaces a warning for the impossible pairs only; it does NOT
 * rewrite or hide them, because an operator seeing a contradiction is the point.
 */
export function isIncoherent(
  status: AppointmentStatus,
  session: ConsultationState | null,
): boolean {
  if (session === null) return false;

  const closed = status === 'CANCELLED' || status === 'COMPLETED';

  // A live session on a closed appointment — the cleanup failure.
  if (closed && (session === 'JOINED' || session === 'IN_PROGRESS')) return true;

  // A finished consultation on an appointment that was cancelled.
  if (status === 'CANCELLED' && session === 'COMPLETED') return true;

  // A finished consultation on an appointment that is still live.
  if (!closed && session === 'COMPLETED') return true;

  // COMPLETED + COMPLETED falls through deliberately: it is the healthy terminal
  // pair, not a contradiction.
  return false;
}

/**
 * Whether the admin cancel action should be OFFERED for this row.
 *
 * Flag 1. The endpoint itself is deliberately permissive (no ownership gate, any
 * status) — it is the admin override. But the UI follows the same convention as
 * sub-items 1 and 2: an action the server would treat as a no-op or a refusal is
 * not offered, it is omitted. Re-cancelling a CANCELLED row returns 200 with the
 * row unchanged and, crucially, writes NO second audit entry — offering it would
 * therefore suggest an action that leaves no trace of having happened.
 *
 * This reuses isActionable() from booking-types rather than re-deriving the
 * rule, so the admin and patient screens can never disagree about which statuses
 * are live.
 */
export function canAdminCancel(status: AppointmentStatus): boolean {
  return isActionable(status);
}

/**
 * Display name for a profile row, falling back to a role label.
 *
 * The admin projection selects `name` but it is nullable, and on this screen a
 * blank name would leave an operator unable to tell WHICH patient was affected —
 * the same failure the backend's notification bug produced with "the patient".
 * So the fallback names the role rather than rendering an empty cell or an
 * em-dash that reads like missing data.
 */
export function profileName(
  profile: { name: string | null } | null,
  fallback: string,
): string {
  const name = profile?.name?.trim();
  return name && name !== '' ? name : fallback;
}

/** True when the row's slot has been released (cancellation nulls the FK). */
export function slotReleased(appointment: AdminAppointment): boolean {
  return appointment.availabilityId === null;
}

export interface AppointmentFilters {
  status: AppointmentStatus | 'ALL';
  /** Free-text matched CLIENT-side against either profile name. */
  q: string;
}

export const EMPTY_FILTERS: AppointmentFilters = { status: 'ALL', q: '' };

/**
 * Filter the appointment list for display.
 *
 * NOTE THE DIVERGENCE FROM SUB-ITEMS 1 & 2. Those screens send `q` to the
 * server because the endpoint supports it. GET /admin/appointments takes NO
 * parameters — no search, no status filter, no pagination (see the controller).
 * Inventing a client filter that pretends to be a server query would be the
 * "appears to search, only searches what was fetched" trap the doctors screen
 * warns about — so this is explicitly a LOCAL narrowing of the full set, the
 * endpoint returns everything, and the screen says so in its summary line.
 *
 * Matches either party's name (case-insensitive) because an operator may be
 * looking up an appointment by whichever side they were told about. Specialization
 * is included too — "find the cardiology bookings" is a real operational query
 * and the field is already on the row.
 */
export function filterAppointments(
  appointments: ReadonlyArray<AdminAppointment>,
  filters: AppointmentFilters,
): AdminAppointment[] {
  const q = filters.q.trim().toLowerCase();
  return appointments.filter((a) => {
    if (filters.status !== 'ALL' && a.status !== filters.status) return false;
    if (q === '') return true;
    const haystack = [
      profileName(a.patientProfile, ''),
      profileName(a.doctorProfile, ''),
      a.doctorProfile.specialization,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

/** True when any filter is narrowing the list — drives the "clear" affordance. */
export function hasActiveFilters(filters: AppointmentFilters): boolean {
  return filters.status !== 'ALL' || filters.q.trim() !== '';
}

/** Count appointments in each state, for the summary line. */
export function summarizeStatus(
  appointments: ReadonlyArray<AdminAppointment>,
): Record<AppointmentStatus, number> {
  const summary: Record<AppointmentStatus, number> = {
    BOOKED: 0,
    RESCHEDULED: 0,
    CANCELLED: 0,
    COMPLETED: 0,
  };
  for (const a of appointments) summary[a.status] += 1;
  return summary;
}

/** How many rows are in an impossible status/session pair. Drives the banner. */
export function countIncoherent(appointments: ReadonlyArray<AdminAppointment>): number {
  return appointments.filter(
    (a) => a.consultationSession !== null && isIncoherent(a.status, a.consultationSession.state),
  ).length;
}

/** A stable, readable summary of the current result set, or null when empty. */
export function resultSummary(count: number, filters: AppointmentFilters): string | null {
  if (count === 0) return null;
  const noun = count === 1 ? 'appointment' : 'appointments';
  return hasActiveFilters(filters)
    ? `${count} matching ${noun} shown`
    : `${count} ${noun} shown`;
}

/**
 * Build the body for POST /admin/appointments/:id/cancel.
 *
 * `reason` is optional on the server (@IsOptional @IsString) and carries no
 * @IsNotEmpty, so an empty string is technically valid. It is nevertheless
 * OMITTED when blank rather than sent as "" — an empty audit reason and a
 * missing one should be the same thing, and storing "" would put a blank
 * `reason` on the AuditLog row that reads as a recorded explanation.
 *
 * Unlike the doctor-review PATCH there is no "empty body is a 400" hazard here:
 * cancelling with no reason is the normal case, so `{}` is the correct payload
 * and the server accepts it.
 */
export function buildCancelBody(reason: string): CancelAppointmentInput {
  const trimmed = reason.trim();
  return trimmed === '' ? {} : { reason: trimmed };
}

/**
 * Confirmation copy for an admin cancellation.
 *
 * Written to state the two consequences the admin cannot see from the row: the
 * appointment is cancelled FOR BOTH PARTIES, and both receive a notification.
 * The doctor is not the actor here and cannot tell from the wording who was —
 * so an admin should confirm knowing the message they are triggering.
 */
export function cancelConfirmCopy(appointment: AdminAppointment): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  const patient = profileName(appointment.patientProfile, 'the patient');
  const doctor = profileName(appointment.doctorProfile, 'the doctor');
  return {
    title: 'Cancel this appointment?',
    description: `The appointment between ${patient} and ${doctor} will be cancelled and the slot released for rebooking. Both parties are notified that an administrator cancelled it.`,
    confirmLabel: 'Cancel appointment',
  };
}
