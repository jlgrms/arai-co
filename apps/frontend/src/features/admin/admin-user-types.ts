// Types and pure helpers for the admin user-management screen (Layer 8
// sub-item 1).
//
// Mirrors GET /admin/users and PATCH /admin/users/:id/state exactly
// (apps/backend/src/admin/admin.service.ts, USER_ADMIN_SELECT). Kept as a
// separate pure module so the filtering/labelling rules are unit-testable
// without a DOM — the same split used by booking-types / doctor-types.
//
// SCOPE NOTE — the server excludes ADMIN accounts from listUsers(), so this
// screen never sees them. That is a deliberate server-side rule, and there is
// NO client-side re-implementation of it here: if the server ever starts
// returning admins, the UI should show them rather than silently filter.

import type { AccountState, Role } from '@/features/auth/types';

export type { AccountState, Role };

/**
 * One row of GET /admin/users. Either `patientProfile` or `doctorProfile` is
 * populated (never both) depending on `role`; both are nullable in the contract.
 */
export interface AdminUser {
  id: string;
  email: string;
  role: Role;
  accountState: AccountState;
  stateReason: string | null;
  createdAt: string;
  patientProfile: { id: string; name: string } | null;
  doctorProfile: { id: string; name: string; specialization: string } | null;
}

/** Body of PATCH /admin/users/:id/state. */
export interface UpdateUserStateInput {
  accountState: AccountState;
  reason?: string;
}

/** The three account states, in lifecycle order (active → suspended → deactivated). */
export const ACCOUNT_STATES: ReadonlyArray<AccountState> = [
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
];

/** Roles selectable in the filter. ADMIN is absent for the reason above. */
export const FILTERABLE_ROLES: ReadonlyArray<Role> = ['PATIENT', 'DOCTOR'];

/**
 * Human label for an account state. Sentence case, matching the rest of the app
 * (the raw enum is never shown to a user).
 */
export function accountStateLabel(state: AccountState): string {
  switch (state) {
    case 'ACTIVE':
      return 'Active';
    case 'SUSPENDED':
      return 'Suspended';
    case 'DEACTIVATED':
      return 'Deactivated';
  }
}

export function roleLabel(role: Role): string {
  switch (role) {
    case 'PATIENT':
      return 'Patient';
    case 'DOCTOR':
      return 'Doctor';
    case 'ADMIN':
      return 'Admin';
  }
}

/**
 * Badge variant per state.
 *
 * ACTIVE is 'success' and SUSPENDED 'danger' because those are the two an admin
 * scans for. DEACTIVATED is 'muted' rather than 'danger' deliberately: it is a
 * terminal, expected end-state (an account that has left), not an alarm, so it
 * must not compete visually with a suspension that needs attention.
 */
export function accountStateVariant(
  state: AccountState,
): 'success' | 'danger' | 'muted' | 'secondary' {
  switch (state) {
    case 'ACTIVE':
      return 'success';
    case 'SUSPENDED':
      return 'danger';
    case 'DEACTIVATED':
      return 'muted';
  }
}

/**
 * Display name for a row, from whichever profile is attached.
 *
 * Falls back to the email rather than a placeholder: an account with no profile
 * still has to be identifiable, and the email is the only remaining identifier.
 * Returns null only if both are absent, which should not happen.
 */
export function displayName(user: AdminUser): string {
  return user.patientProfile?.name ?? user.doctorProfile?.name ?? user.email;
}

/** Secondary line: the email, unless the email IS the display name. */
export function secondaryLabel(user: AdminUser): string | null {
  return displayName(user) === user.email ? null : user.email;
}

/** Doctors show their specialization alongside the name; nobody else does. */
export function roleDetail(user: AdminUser): string | null {
  const spec = user.doctorProfile?.specialization;
  return user.role === 'DOCTOR' && spec ? spec : null;
}

/**
 * The state a given action button should move the account TO.
 *
 * Only the transitions that make sense are offered (see availableActions
 * below), so this is never called with a no-op pair by the UI.
 */
export function nextStateFor(
  current: AccountState,
  action: 'activate' | 'suspend' | 'deactivate',
): AccountState {
  switch (action) {
    case 'activate':
      return 'ACTIVE';
    case 'suspend':
      return 'SUSPENDED';
    case 'deactivate':
      return 'DEACTIVATED';
  }
}

export type UserAction = 'activate' | 'suspend' | 'deactivate';

export interface UserActionOption {
  action: UserAction;
  label: string;
  /** Variant for the button, so the destructive option reads as such. */
  variant: 'default' | 'outline' | 'destructive';
  /** Whether this action warrants a confirmation dialog. */
  confirm: boolean;
}

/**
 * Actions offered for an account in `state`.
 *
 * The CURRENT state's own action is omitted — offering "Suspend" on an already
 * suspended account invites a pointless round-trip, and re-applying the same
 * state is a no-op for the user even though the server accepts and audits it.
 *
 * DEACTIVATE and SUSPEND need confirmation (they remove access); ACTIVATE does
 * not, because it only ever restores access and a misclick is trivially undone
 * by suspending again. Deactivation is confirmed most strongly in the dialog
 * copy, since it is the terminal one.
 */
export function availableActions(state: AccountState): UserActionOption[] {
  const options: UserActionOption[] = [];

  if (state !== 'ACTIVE') {
    options.push({ action: 'activate', label: 'Activate', variant: 'default', confirm: false });
  }
  if (state !== 'SUSPENDED') {
    options.push({ action: 'suspend', label: 'Suspend', variant: 'outline', confirm: true });
  }
  if (state !== 'DEACTIVATED') {
    options.push({
      action: 'deactivate',
      label: 'Deactivate',
      variant: 'destructive',
      confirm: true,
    });
  }

  return options;
}

/**
 * Confirmation copy for an action. Deactivation is stated as terminal because it
 * reads that way in the UI (there is no "reactivate a deactivated account"
 * affordance distinct from Activate) and an admin should not discover that
 * afterwards.
 */
export function confirmCopy(
  action: UserAction,
  name: string,
): { title: string; description: string; confirmLabel: string } {
  switch (action) {
    case 'activate':
      return {
        title: `Activate ${name}?`,
        description: 'This restores their access to the platform.',
        confirmLabel: 'Activate',
      };
    case 'suspend':
      return {
        title: `Suspend ${name}?`,
        description:
          'They will be unable to sign in until an administrator reactivates the account.',
        confirmLabel: 'Suspend',
      };
    case 'deactivate':
      return {
        title: `Deactivate ${name}?`,
        description:
          'This blocks the account from signing in. Reactivate it from this screen if needed.',
        confirmLabel: 'Deactivate',
      };
  }
}

export interface UserFilters {
  q: string;
  role: Role | 'ALL';
  accountState: AccountState | 'ALL';
}

export const EMPTY_FILTERS: UserFilters = { q: '', role: 'ALL', accountState: 'ALL' };

/**
 * Build the query string for GET /admin/users.
 *
 * Empty/ALL filters are OMITTED rather than sent as blank values: the backend
 * treats a present-but-empty `q` as a search for '' and runs three ILIKE
 * clauses for nothing, and an unvalidated '' for `role` would be a 400 against
 * the Role enum.
 */
export function buildUsersQuery(filters: UserFilters): string {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  if (q !== '') params.set('q', q);
  if (filters.role !== 'ALL') params.set('role', filters.role);
  if (filters.accountState !== 'ALL') params.set('accountState', filters.accountState);
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

/** True when any filter is narrowing the list — drives the "clear" affordance. */
export function hasActiveFilters(filters: UserFilters): boolean {
  return filters.q.trim() !== '' || filters.role !== 'ALL' || filters.accountState !== 'ALL';
}

/**
 * Count the accounts in each state, for the summary line.
 *
 * Counted CLIENT-side from the currently loaded rows, which means it describes
 * the current filter, not the whole table. The label says so ("shown") rather
 * than implying a global total the client cannot actually know.
 */
export function summarizeStates(users: ReadonlyArray<AdminUser>): Record<AccountState, number> {
  const summary: Record<AccountState, number> = { ACTIVE: 0, SUSPENDED: 0, DEACTIVATED: 0 };
  for (const user of users) summary[user.accountState] += 1;
  return summary;
}

/**
 * A stable, readable summary of the current result set, or null when empty.
 */
export function resultSummary(count: number, filters: UserFilters): string | null {
  if (count === 0) return null;
  const noun = count === 1 ? 'account' : 'accounts';
  return hasActiveFilters(filters) ? `${count} matching ${noun} shown` : `${count} ${noun} shown`;
}

/**
 * Whether the admin can change this account's state at all.
 *
 * Always true in practice — even DEACTIVATED offers Activate — but expressed as
 * a function so the screen has one place to consult and a future "locked"
 * account type has somewhere to land.
 */
export function canChangeState(user: AdminUser): boolean {
  return availableActions(user.accountState).length > 0;
}
