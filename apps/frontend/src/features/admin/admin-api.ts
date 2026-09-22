// API calls backing the admin console (Layer 8).
//
// All of these endpoints already exist from Layer 4 sub-item 9
// (apps/backend/src/admin/admin.controller.ts, whole controller ADMIN-only).
// Nothing is added here but the typed client-side wrapper.
//
// Scoping is entirely server-side and is NOT re-implemented here. The controller
// is guarded by JwtAuthGuard + RolesGuard with @Roles(ADMIN); a non-admin gets
// 403 and the UI's job is to explain that, not to duplicate the check.
//
// Only the endpoints a delivered screen actually calls are wrapped. The rest of
// the controller (doctors, appointments, dashboard, audit-logs) is added as its
// sub-item lands, so this file never carries dead exports.

import { api } from '@/lib/api-client';
import { buildUsersQuery, type AdminUser, type UpdateUserStateInput, type UserFilters } from './admin-user-types';
import {
  buildDoctorsQuery,
  type AdminDoctor,
  type DoctorFilters,
  type ReviewDoctorInput,
} from './admin-doctor-types';
import type {
  AdminAppointment,
  CancelAppointmentInput,
  CancelledAppointmentRow,
} from './admin-appointment-types';
import type { AdminDashboard } from './admin-dashboard-types';
import type { AuditLogRow } from './admin-audit-types';

/**
 * List/search patient and doctor accounts.
 * ADMIN accounts are excluded by the server (see listUsers), so they never
 * appear here and the screen must not assume it can manage them.
 */
export function fetchUsers(filters: UserFilters, signal?: AbortSignal): Promise<AdminUser[]> {
  return api.get<AdminUser[]>(`/admin/users${buildUsersQuery(filters)}`, { signal });
}

/**
 * Activate / suspend / deactivate an account.
 *
 * Idempotent-safe server-side: re-applying the current state is accepted and
 * still audited. The UI nevertheless omits the current state's own action (see
 * availableActions) so an admin does not generate a pointless audit entry.
 *
 * Rejects ADMIN targets with 400 — surface that message verbatim.
 */
export function updateUserState(
  userId: string,
  input: UpdateUserStateInput,
): Promise<AdminUser> {
  return api.patch<AdminUser>(`/admin/users/${userId}/state`, input);
}

/**
 * List/search doctor profiles for review (Layer 8 sub-item 2).
 *
 * `q` is matched SERVER-SIDE against name and specialization (case-insensitive
 * ILIKE), so the screen sends the query rather than filtering the loaded array.
 *
 * Unlike GET /admin/users this does NOT exclude any account: it lists every
 * DoctorProfile regardless of the owning account's state. That is deliberate on
 * the server side — a suspended doctor's profile still needs reviewing — so the
 * screen surfaces the account state alongside rather than hiding the row.
 */
export function fetchDoctors(filters: DoctorFilters, signal?: AbortSignal): Promise<AdminDoctor[]> {
  return api.get<AdminDoctor[]>(`/admin/doctors${buildDoctorsQuery(filters)}`, { signal });
}

/**
 * Approve / reject / update a doctor profile in one endpoint (S5.4).
 *
 * `doctorProfileId` is the DoctorProfile id — NOT the user id. They are
 * different UUIDs and the handler 404s on the wrong one.
 *
 * The body is a partial update: buildReviewPatch omits unchanged fields, and
 * the caller must never send an empty object (the server answers 400 "No review
 * fields provided"). Validation mirrors the doctor's own PATCH /doctors/me, so
 * there is no admin bypass — a blank name/specialization is a 400 here too.
 *
 * Every success writes an AuditLog row with the optional reason.
 */
export function reviewDoctor(
  doctorProfileId: string,
  input: ReviewDoctorInput,
): Promise<AdminDoctor> {
  return api.patch<AdminDoctor>(`/admin/doctors/${doctorProfileId}/review`, input);
}

/**
 * List ALL appointments across every patient and doctor (Layer 8 sub-item 3).
 *
 * The endpoint takes NO parameters — no search, no status filter, no pagination
 * (see AdminController.listAppointments). It returns the whole set ordered by
 * scheduledAt desc. The screen's filter box therefore narrows the loaded array
 * LOCALLY and says so; it must not be presented as a server query.
 *
 * Each row carries BOTH profile names plus the consultation session, so a single
 * fetch feeds the whole table without follow-up requests.
 */
export function fetchAdminAppointments(signal?: AbortSignal): Promise<AdminAppointment[]> {
  return api.get<AdminAppointment[]>('/admin/appointments', { signal });
}

/**
 * Admin-scoped cancellation (S5.4) — the override path, NOT the patient route.
 *
 * Posts to `/admin/appointments/:id/cancel` (the patient screen uses
 * `PATCH /appointments/:id/cancel`; different verb AND path, do not conflate).
 * This has no ownership gate, so it works on any appointment. The server answers
 * 200 (@HttpCode(200)) and is idempotent: re-cancelling an already-CANCELLED
 * appointment returns the row unchanged with no second notification and no
 * second audit entry — which is why the UI only offers the action on live rows.
 *
 * On success the server cancels for BOTH parties, nulls `availabilityId` to
 * release the slot, and notifies doctor and patient. `reason` is optional; omit
 * it rather than sending "" (see buildCancelBody).
 *
 * IMPORTANT — the RESPONSE SHAPE DIFFERS FROM THE LIST. This handler returns the
 * raw Appointment columns (the service calls `update()` with no `select`), so it
 * carries NO patientProfile / doctorProfile / consultationSession relations,
 * unlike GET /admin/appointments. The response type is therefore
 * CancelledAppointmentRow, NOT AdminAppointment, and the caller must MERGE it
 * onto the row it already holds rather than replacing it (see
 * mergeCancelledAppointment). Replacing threw on the very next render.
 *
 * `appointmentId` is the Appointment id — the session id is a different UUID.
 */
export function cancelAdminAppointment(
  appointmentId: string,
  input: CancelAppointmentInput = {},
): Promise<CancelledAppointmentRow> {
  return api.post<CancelledAppointmentRow>(
    `/admin/appointments/${appointmentId}/cancel`,
    input,
  );
}

/**
 * Aggregate counts for the operational dashboard (Layer 8 sub-item 4).
 *
 * `GET /admin/dashboard` takes NO parameters and is not paginated — it is four
 * counts plus four groupBys over the whole database. It is therefore cheap and
 * is refetched on demand rather than cached across navigations; each admin
 * session lands on this screen (HOME_BY_ROLE.ADMIN = '/admin'), so a stale
 * cached payload would be the first thing every admin sees.
 *
 * The payload's `by*` maps OMIT zero-count keys — Prisma's groupBy never emits a
 * zero. Do not read these maps directly; pass them through countOf() in
 * admin-dashboard-types, which coalesces the missing key to 0. See that module
 * for why an `undefined` bucket is a rendering bug, not a cosmetic one.
 *
 * The shape is returned untouched: no bucket normalisation happens here, because
 * the raw payload is what the zero-fixture equality harness compares against the
 * live endpoint. Any coalescing done in this wrapper would make that comparison
 * tautological.
 */
export function fetchDashboard(signal?: AbortSignal): Promise<AdminDashboard> {
  return api.get<AdminDashboard>('/admin/dashboard', { signal });
}

/**
 * Read the append-only audit log (Layer 8 sub-item 5).
 *
 * `GET /admin/audit-logs` takes NO parameters, is NOT paginated, and has NO
 * server-side filtering — it is `findMany({ orderBy: { timestamp: 'desc' },
 * include: { adminUser: { select: { id, email } } } })` over the whole log. Every
 * screen load therefore transfers every row ever written (44 at the time of
 * writing). The screen's filters narrow the loaded array LOCALLY and say "shown",
 * not "found", so the wording does not describe a query that never happened.
 *
 * NEWEST FIRST is the server's ordering and is NOT re-sorted client-side —
 * re-sorting would conceal a server ordering regression behind a client fix.
 * isNewestFirst() in admin-audit-types verifies the payload arrived as promised.
 *
 * `affectedRecordId` points at a record that may since have been DELETED. There
 * is no lookup here and there must be none on the screen: a UUID that no longer
 * resolves would render as a dead link presented as navigation.
 */
export function fetchAuditLogs(signal?: AbortSignal): Promise<AuditLogRow[]> {
  return api.get<AuditLogRow[]>('/admin/audit-logs', { signal });
}
