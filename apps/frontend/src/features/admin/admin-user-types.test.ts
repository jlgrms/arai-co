import { describe, expect, it } from 'vitest';

import {
  accountStateLabel,
  accountStateVariant,
  availableActions,
  buildUsersQuery,
  canChangeState,
  confirmCopy,
  displayName,
  EMPTY_FILTERS,
  hasActiveFilters,
  nextStateFor,
  resultSummary,
  roleDetail,
  roleLabel,
  secondaryLabel,
  summarizeStates,
  type AdminUser,
} from './admin-user-types';

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u1',
    email: 'jordan.lee@example.com',
    role: 'PATIENT',
    accountState: 'ACTIVE',
    stateReason: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    patientProfile: { id: 'p1', name: 'Jordan Lee' },
    doctorProfile: null,
    ...overrides,
  };
}

function doctorUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return user({
    id: 'd1',
    email: 'dr.patel@example.com',
    role: 'DOCTOR',
    patientProfile: null,
    doctorProfile: { id: 'dp1', name: 'Dr. Rohan Patel', specialization: 'General Medicine' },
    ...overrides,
  });
}

describe('labels', () => {
  it('renders account states in sentence case, never the raw enum', () => {
    expect(accountStateLabel('ACTIVE')).toBe('Active');
    expect(accountStateLabel('SUSPENDED')).toBe('Suspended');
    expect(accountStateLabel('DEACTIVATED')).toBe('Deactivated');
  });

  it('labels roles readably', () => {
    expect(roleLabel('PATIENT')).toBe('Patient');
    expect(roleLabel('DOCTOR')).toBe('Doctor');
    expect(roleLabel('ADMIN')).toBe('Admin');
  });

  it('marks suspended as danger but deactivated as muted', () => {
    // Suspension needs attention; deactivation is a settled end-state and must
    // not compete with it visually.
    expect(accountStateVariant('ACTIVE')).toBe('success');
    expect(accountStateVariant('SUSPENDED')).toBe('danger');
    expect(accountStateVariant('DEACTIVATED')).toBe('muted');
  });
});

describe('displayName / secondaryLabel / roleDetail', () => {
  it('uses the patient profile name', () => {
    expect(displayName(user())).toBe('Jordan Lee');
  });

  it('uses the doctor profile name', () => {
    expect(displayName(doctorUser())).toBe('Dr. Rohan Patel');
  });

  it('falls back to the email when no profile is attached', () => {
    const orphan = user({ patientProfile: null, doctorProfile: null });
    expect(displayName(orphan)).toBe('jordan.lee@example.com');
  });

  it('hides the secondary email line when the email IS the display name', () => {
    const orphan = user({ patientProfile: null, doctorProfile: null });
    expect(secondaryLabel(orphan)).toBeNull();
  });

  it('shows the email as secondary when a name is present', () => {
    expect(secondaryLabel(user())).toBe('jordan.lee@example.com');
  });

  it('shows specialization only for doctors', () => {
    expect(roleDetail(doctorUser())).toBe('General Medicine');
    expect(roleDetail(user())).toBeNull();
  });

  it('omits specialization for a doctor who has none', () => {
    expect(roleDetail(doctorUser({ doctorProfile: { id: 'dp1', name: 'X', specialization: '' } }))).toBeNull();
  });
});

describe('nextStateFor', () => {
  it('maps each action to its target state', () => {
    expect(nextStateFor('SUSPENDED', 'activate')).toBe('ACTIVE');
    expect(nextStateFor('ACTIVE', 'suspend')).toBe('SUSPENDED');
    expect(nextStateFor('ACTIVE', 'deactivate')).toBe('DEACTIVATED');
  });
});

describe('availableActions', () => {
  it('offers suspend and deactivate for an active account, but not activate', () => {
    const actions = availableActions('ACTIVE').map((a) => a.action);
    expect(actions).toEqual(['suspend', 'deactivate']);
  });

  it('offers activate and deactivate for a suspended account, but not suspend', () => {
    const actions = availableActions('SUSPENDED').map((a) => a.action);
    expect(actions).toEqual(['activate', 'deactivate']);
  });

  it('offers activate and suspend for a deactivated account, but not deactivate', () => {
    const actions = availableActions('DEACTIVATED').map((a) => a.action);
    expect(actions).toEqual(['activate', 'suspend']);
  });

  it('never offers an action that matches the current state', () => {
    // Offering "Suspend" on a suspended account is a pointless round-trip.
    for (const state of ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const) {
      expect(availableActions(state).some((a) => nextStateFor(state, a.action) === state)).toBe(
        false,
      );
    }
  });

  it('always offers at least one action', () => {
    for (const state of ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const) {
      expect(availableActions(state).length).toBeGreaterThan(0);
    }
  });

  it('requires confirmation for the access-removing actions only', () => {
    const byAction = Object.fromEntries(availableActions('SUSPENDED').map((a) => [a.action, a]));
    expect(byAction.activate?.confirm).toBe(false);
    expect(byAction.deactivate?.confirm).toBe(true);

    const active = Object.fromEntries(availableActions('ACTIVE').map((a) => [a.action, a]));
    expect(active.suspend?.confirm).toBe(true);
  });

  it('marks deactivate as destructive so it reads as such', () => {
    const deactivate = availableActions('ACTIVE').find((a) => a.action === 'deactivate');
    expect(deactivate?.variant).toBe('destructive');
  });
});

describe('confirmCopy', () => {
  it('names the account in the title', () => {
    expect(confirmCopy('suspend', 'Jordan Lee').title).toBe('Suspend Jordan Lee?');
    expect(confirmCopy('activate', 'Jordan Lee').title).toBe('Activate Jordan Lee?');
    expect(confirmCopy('deactivate', 'Jordan Lee').title).toBe('Deactivate Jordan Lee?');
  });

  it('states that suspension blocks sign-in', () => {
    expect(confirmCopy('suspend', 'X').description).toMatch(/unable to sign in/i);
  });

  it('offers a route back from deactivation rather than implying permanence', () => {
    expect(confirmCopy('deactivate', 'X').description).toMatch(/reactivate/i);
  });

  it('provides a confirm label matching the action', () => {
    expect(confirmCopy('activate', 'X').confirmLabel).toBe('Activate');
    expect(confirmCopy('suspend', 'X').confirmLabel).toBe('Suspend');
    expect(confirmCopy('deactivate', 'X').confirmLabel).toBe('Deactivate');
  });
});

describe('buildUsersQuery', () => {
  it('omits everything when no filter is set', () => {
    expect(buildUsersQuery(EMPTY_FILTERS)).toBe('');
  });

  it('sends q alone', () => {
    expect(buildUsersQuery({ ...EMPTY_FILTERS, q: 'jordan' })).toBe('?q=jordan');
  });

  it('omits a blank or whitespace-only q', () => {
    // The backend would run three ILIKE clauses for nothing.
    expect(buildUsersQuery({ ...EMPTY_FILTERS, q: '' })).toBe('');
    expect(buildUsersQuery({ ...EMPTY_FILTERS, q: '   ' })).toBe('');
  });

  it('trims q before sending', () => {
    expect(buildUsersQuery({ ...EMPTY_FILTERS, q: '  jordan  ' })).toBe('?q=jordan');
  });

  it('sends role and accountState', () => {
    const qs = buildUsersQuery({ ...EMPTY_FILTERS, role: 'DOCTOR', accountState: 'SUSPENDED' });
    expect(qs).toContain('role=DOCTOR');
    expect(qs).toContain('accountState=SUSPENDED');
  });

  it('never sends ALL as a filter value', () => {
    const qs = buildUsersQuery({ q: '', role: 'ALL', accountState: 'ALL' });
    expect(qs).not.toContain('ALL');
  });

  it('encodes a q containing spaces and symbols', () => {
    const qs = buildUsersQuery({ ...EMPTY_FILTERS, q: 'Jordan Lee' });
    expect(qs).toBe('?q=Jordan+Lee');
  });
});

describe('hasActiveFilters', () => {
  it('is false for the empty filter set and for whitespace-only q', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: '  ' })).toBe(false);
  });

  it('is true when any filter narrows the list', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: 'x' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, role: 'DOCTOR' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, accountState: 'ACTIVE' })).toBe(true);
  });
});

describe('summarizeStates', () => {
  it('counts each state', () => {
    const summary = summarizeStates([
      user(),
      user({ accountState: 'SUSPENDED' }),
      user({ accountState: 'SUSPENDED' }),
      user({ accountState: 'DEACTIVATED' }),
    ]);
    expect(summary).toEqual({ ACTIVE: 1, SUSPENDED: 2, DEACTIVATED: 1 });
  });

  it('returns zeroes for an empty list rather than nulls', () => {
    expect(summarizeStates([])).toEqual({ ACTIVE: 0, SUSPENDED: 0, DEACTIVATED: 0 });
  });
});

describe('resultSummary', () => {
  it('is null when there is nothing to report', () => {
    expect(resultSummary(0, EMPTY_FILTERS)).toBeNull();
  });

  it('distinguishes a filtered result from the full list', () => {
    expect(resultSummary(7, EMPTY_FILTERS)).toBe('7 accounts shown');
    expect(resultSummary(7, { ...EMPTY_FILTERS, q: 'a' })).toBe('7 matching accounts shown');
  });

  it('uses the singular for one row', () => {
    expect(resultSummary(1, EMPTY_FILTERS)).toBe('1 account shown');
  });

  it('says "shown" rather than implying a global total', () => {
    // The client only knows what it loaded, so it must not claim a table total.
    expect(resultSummary(3, EMPTY_FILTERS)).toContain('shown');
  });
});

describe('canChangeState', () => {
  it('is true for every state, since Activate is always reachable', () => {
    expect(canChangeState(user({ accountState: 'ACTIVE' }))).toBe(true);
    expect(canChangeState(user({ accountState: 'SUSPENDED' }))).toBe(true);
    expect(canChangeState(user({ accountState: 'DEACTIVATED' }))).toBe(true);
  });
});
