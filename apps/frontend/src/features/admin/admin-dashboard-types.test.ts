import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_STATES,
  APPOINTMENT_STATUSES,
  APPROVAL_STATUSES,
  CONSULTATION_STATES,
  ROLES,
  accountStateLabel,
  appointmentStatusLabel,
  approvalStatusLabel,
  buildSections,
  consultationStateLabel,
  countOf,
  findInconsistencies,
  manageableUserCount,
  roleLabel,
  sectionTitle,
  sumBuckets,
  type AdminDashboard,
} from './admin-dashboard-types';

/**
 * The LIVE payload shape, with the keys Prisma actually omits.
 *
 * This is the important fixture: `byStatus` has NO `RESCHEDULED` key and
 * `byApprovalStatus` has only APPROVED. A test that supplied every key would not
 * exercise the whole point of countOf.
 */
function dashboard(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    users: {
      total: 11,
      byRole: { ADMIN: 1, PATIENT: 4, DOCTOR: 6 },
      byAccountState: { ACTIVE: 11 },
    },
    doctors: {
      total: 6,
      byApprovalStatus: { APPROVED: 6 },
    },
    appointments: {
      total: 7,
      byStatus: { CANCELLED: 1, COMPLETED: 3, BOOKED: 3 },
    },
    consultationSessions: {
      total: 7,
      byState: { SCHEDULED: 2, COMPLETED: 3, JOINED: 1, IN_PROGRESS: 1 },
    },
    ...overrides,
  };
}

describe('countOf — the groupBy zero-coalescing', () => {
  it('returns 0 for a key the groupBy omitted', () => {
    // Prisma never emits a zero bucket. Reading it raw gives undefined.
    expect(countOf({ BOOKED: 3 }, 'RESCHEDULED')).toBe(0);
    expect(countOf({ APPROVED: 6 }, 'REJECTED')).toBe(0);
    expect(countOf({ ACTIVE: 11 }, 'SUSPENDED')).toBe(0);
  });

  it('returns the real count when the key IS present', () => {
    expect(countOf({ BOOKED: 3 }, 'BOOKED')).toBe(3);
  });

  it('never returns undefined — the blank-tile failure mode', () => {
    expect(countOf({}, 'ANYTHING')).toBe(0);
    expect(countOf({}, 'ANYTHING')).not.toBeUndefined();
  });

  it('coerces a non-numeric value rather than rendering NaN', () => {
    // Defensive: a typed endpoint can still surprise at runtime.
    expect(countOf({ WEIRD: 'four' as unknown as number }, 'WEIRD')).toBe(0);
    expect(countOf({ WEIRD: null as unknown as number }, 'WEIRD')).toBe(0);
    expect(countOf({ WEIRD: NaN }, 'WEIRD')).toBe(0);
    expect(countOf({ WEIRD: Infinity }, 'WEIRD')).toBe(0);
  });

  it('keeps a legitimate zero distinct from a missing key (both 0)', () => {
    expect(countOf({ REJECTED: 0 }, 'REJECTED')).toBe(0);
  });
});

describe('labels', () => {
  it('renders every role in sentence case, never the raw enum', () => {
    expect(roleLabel('ADMIN')).toBe('Admins');
    expect(roleLabel('PATIENT')).toBe('Patients');
    expect(roleLabel('DOCTOR')).toBe('Doctors');
  });

  it('labels every account state', () => {
    expect(accountStateLabel('ACTIVE')).toBe('Active');
    expect(accountStateLabel('SUSPENDED')).toBe('Suspended');
    expect(accountStateLabel('DEACTIVATED')).toBe('Deactivated');
  });

  it('labels every approval state', () => {
    expect(approvalStatusLabel('PENDING')).toBe('Pending review');
    expect(approvalStatusLabel('APPROVED')).toBe('Approved');
    expect(approvalStatusLabel('REJECTED')).toBe('Rejected');
  });

  it('labels every appointment state, matching the other admin screens', () => {
    expect(appointmentStatusLabel('BOOKED')).toBe('Scheduled');
    expect(appointmentStatusLabel('RESCHEDULED')).toBe('Rescheduled');
    expect(appointmentStatusLabel('CANCELLED')).toBe('Cancelled');
    expect(appointmentStatusLabel('COMPLETED')).toBe('Completed');
  });

  it('labels every consultation state', () => {
    expect(consultationStateLabel('SCHEDULED')).toBe('Not started');
    expect(consultationStateLabel('JOINED')).toBe('Waiting');
    expect(consultationStateLabel('IN_PROGRESS')).toBe('In progress');
    expect(consultationStateLabel('COMPLETED')).toBe('Completed');
  });
});

describe('buildSections', () => {
  it('builds all four sections', () => {
    const sections = buildSections(dashboard());
    expect(sections.map((s) => s.id)).toEqual([
      'users',
      'doctors',
      'appointments',
      'consultationSessions',
    ]);
  });

  it('carries the server totals through unchanged', () => {
    const sections = buildSections(dashboard());
    const users = sections.find((s) => s.id === 'users')!;
    const appointments = sections.find((s) => s.id === 'appointments')!;
    // The raw total, including the admin — Flag 2(a).
    expect(users.total).toBe(11);
    expect(appointments.total).toBe(7);
  });

  it('renders the FULL enum for every dimension, including absent keys', () => {
    const sections = buildSections(dashboard());
    const appointments = sections.find((s) => s.id === 'appointments')!;
    // RESCHEDULED is absent from the payload but must still render, as 0.
    expect(appointments.buckets.map((b) => b.key)).toEqual([
      'BOOKED',
      'RESCHEDULED',
      'CANCELLED',
      'COMPLETED',
    ]);
    expect(appointments.buckets.find((b) => b.key === 'RESCHEDULED')!.count).toBe(0);
  });

  it('renders PENDING and REJECTED tiles even though only APPROVED exists', () => {
    const sections = buildSections(dashboard());
    const doctors = sections.find((s) => s.id === 'doctors')!;
    expect(doctors.buckets.map((b) => b.key)).toEqual(['PENDING', 'APPROVED', 'REJECTED']);
    expect(doctors.buckets.find((b) => b.key === 'PENDING')!.count).toBe(0);
    expect(doctors.buckets.find((b) => b.key === 'APPROVED')!.count).toBe(6);
  });

  it('gives every bucket a human label — no raw enum reaches the DOM', () => {
    const sections = buildSections(dashboard());
    for (const section of sections) {
      for (const bucket of section.buckets) {
        expect(bucket.label).not.toBe(bucket.key);
        expect(bucket.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('links each section to a section ROOT, never a filtered view', () => {
    // None of the target screens read a URL query param, so a filtered-looking
    // link would land on an unfiltered list.
    const sections = buildSections(dashboard());
    for (const section of sections) {
      expect(section.href).toMatch(/^\/admin\//);
      expect(section.href).not.toContain('?');
    }
    expect(sections.find((s) => s.id === 'users')!.href).toBe('/admin/users');
    expect(sections.find((s) => s.id === 'doctors')!.href).toBe('/admin/doctors');
  });

  it('is stable when the database is empty (every bucket zero, no crash)', () => {
    const empty = dashboard({
      users: { total: 0, byRole: {}, byAccountState: {} },
      doctors: { total: 0, byApprovalStatus: {} },
      appointments: { total: 0, byStatus: {} },
      consultationSessions: { total: 0, byState: {} },
    });
    const sections = buildSections(empty);
    expect(sections).toHaveLength(4);
    for (const section of sections) {
      expect(section.total).toBe(0);
      for (const bucket of section.buckets) expect(bucket.count).toBe(0);
    }
    // Total bucket count: roles 3 + states 3 + approvals 3 + appts 4 + sessions 4.
    const totalTiles = sections.reduce((n, s) => n + s.buckets.length, 0);
    expect(totalTiles).toBe(3 + 3 + 3 + 4 + 4);
  });

  it('covers every enum member in the corresponding section', () => {
    const sections = buildSections(dashboard());
    const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
    for (const s of ACCOUNT_STATES) {
      expect(byId.users.buckets.some((b) => b.key === s)).toBe(true);
    }
    for (const r of ROLES) {
      expect(byId.users.buckets.some((b) => b.key === r)).toBe(true);
    }
    for (const s of APPROVAL_STATUSES) {
      expect(byId.doctors.buckets.some((b) => b.key === s)).toBe(true);
    }
    for (const s of APPOINTMENT_STATUSES) {
      expect(byId.appointments.buckets.some((b) => b.key === s)).toBe(true);
    }
    for (const s of CONSULTATION_STATES) {
      expect(byId.consultationSessions.buckets.some((b) => b.key === s)).toBe(true);
    }
  });
});

describe('manageableUserCount', () => {
  it('excludes administrators — the count GET /admin/users actually shows', () => {
    // 4 patients + 6 doctors = 10, while users.total is 11.
    expect(manageableUserCount(dashboard())).toBe(10);
  });

  it('is strictly less than the raw total when an admin exists', () => {
    const data = dashboard();
    expect(manageableUserCount(data)).toBeLessThan(data.users.total);
  });

  it('coalesces missing role keys to 0 rather than NaN', () => {
    const data = dashboard({
      users: { total: 0, byRole: {}, byAccountState: {} },
    });
    expect(manageableUserCount(data)).toBe(0);
    expect(Number.isNaN(manageableUserCount(data))).toBe(false);
  });
});

describe('sumBuckets / findInconsistencies', () => {
  it('sums a bucket list', () => {
    expect(
      sumBuckets([
        { key: 'a', label: 'A', count: 1 },
        { key: 'b', label: 'B', count: 2 },
      ]),
    ).toBe(3);
  });

  it('reports nothing when every total matches its buckets', () => {
    expect(findInconsistencies(buildSections(dashboard()))).toEqual([]);
  });

  it('flags a section whose buckets do not sum to its total', () => {
    // A write landing between the count() and the groupBy() can do this.
    const data = dashboard({
      appointments: { total: 9, byStatus: { BOOKED: 3, COMPLETED: 3, CANCELLED: 1 } },
    });
    const found = findInconsistencies(buildSections(data));
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({ sectionId: 'appointments', total: 9, summed: 7 });
  });

  it('never flags the users section, whose buckets span two dimensions', () => {
    // roles sum (11) + accountStates sum (11) is not meant to equal total (11),
    // so checking it here would report a permanent false positive.
    const found = findInconsistencies(buildSections(dashboard()));
    expect(found.some((f) => f.sectionId === 'users')).toBe(false);
  });

  it('flags each single-dimension section independently', () => {
    const data = dashboard({
      doctors: { total: 6, byApprovalStatus: { APPROVED: 5 } },
      consultationSessions: { total: 7, byState: { SCHEDULED: 1 } },
    });
    const found = findInconsistencies(buildSections(data));
    expect(found.map((f) => f.sectionId).sort()).toEqual(['consultationSessions', 'doctors']);
  });
});

describe('sectionTitle', () => {
  it('names a section from its id', () => {
    const sections = buildSections(dashboard());
    expect(sectionTitle(sections, 'appointments')).toBe('Appointments');
  });

  it('falls back to the raw id rather than showing nothing', () => {
    expect(sectionTitle(buildSections(dashboard()), 'nope')).toBe('nope');
  });
});
