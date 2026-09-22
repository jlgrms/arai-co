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
