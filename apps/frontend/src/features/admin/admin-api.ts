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
