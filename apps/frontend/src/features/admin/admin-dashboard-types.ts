// Types and pure helpers for the admin operational dashboard (Layer 8 sub-item 4).
//
// Mirrors GET /admin/dashboard exactly (apps/backend/src/admin/admin.service.ts,
// dashboard()). Kept as a separate pure module so the zero-coalescing and the
// tile derivation are unit-testable without a DOM — the same split used by
// admin-user-types / admin-doctor-types / admin-appointment-types.

/**
 * The four enum sets the endpoint groups by.
 *
 * Declared here rather than imported from @prisma/client (the frontend never
 * depends on it). Each is the FULL set of possible values, which is exactly what
 * the server does NOT send — see countOf.
 */
export type Role = 'ADMIN' | 'PATIENT' | 'DOCTOR';
export type AccountState = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type AppointmentStatus = 'BOOKED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED';
export type ConsultationState = 'SCHEDULED' | 'JOINED' | 'IN_PROGRESS' | 'COMPLETED';

/**
 * One `groupBy` bucket map, e.g. `{ PATIENT: 4, DOCTOR: 6 }`.
 *
 * DELIBERATELY a partial record. Prisma's groupBy returns ONLY the keys that
 * exist in the data — it never emits a zero. A database with no rejected doctors
 * simply has no `REJECTED` key, so reading `byApprovalStatus.REJECTED` yields
 * `undefined`, not `0`. Typing this as a full Record<ApprovalStatus, number>
 * would be a lie the compiler could not catch, which is why countOf exists.
 */
export type CountMap = Partial<Record<string, number>>;

/**
 * Response of GET /admin/dashboard.
 *
 * The `total` fields are `prisma.count()` and DO count every row; the `by*` maps
 * are groupBys. The two are computed independently, so a mismatch between
 * `total` and the sum of its buckets would be a real server inconsistency rather
 * than a rendering artefact — the screen surfaces such a mismatch rather than
 * silently trusting either number (see totalsAreConsistent).
 */
export interface AdminDashboard {
  users: {
    total: number;
    byRole: CountMap;
    byAccountState: CountMap;
  };
  doctors: {
    total: number;
    byApprovalStatus: CountMap;
  };
  appointments: {
    total: number;
    byStatus: CountMap;
  };
  consultationSessions: {
    total: number;
    byState: CountMap;
  };
}

/** The full value sets, in display order. Used to render zero tiles too. */
export const ROLES: ReadonlyArray<Role> = ['ADMIN', 'PATIENT', 'DOCTOR'];
export const ACCOUNT_STATES: ReadonlyArray<AccountState> = [
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
];
export const APPROVAL_STATUSES: ReadonlyArray<ApprovalStatus> = [
  'PENDING',
  'APPROVED',
  'REJECTED',
];
export const APPOINTMENT_STATUSES: ReadonlyArray<AppointmentStatus> = [
  'BOOKED',
  'RESCHEDULED',
  'CANCELLED',
  'COMPLETED',
];
export const CONSULTATION_STATES: ReadonlyArray<ConsultationState> = [
  'SCHEDULED',
  'JOINED',
  'IN_PROGRESS',
  'COMPLETED',
];

/**
 * Read one bucket, converting the groupBy's ABSENT key into an explicit 0.
 *
 * This single function is the reason this module exists. Prisma omits keys with
 * no rows, so `map[value]` is `undefined` for e.g. REJECTED when no doctor has
 * ever been rejected. Rendered directly, `undefined` produces a blank tile —
 * which reads to an operator as "failed to load", not "none". Every count on the
 * dashboard goes through here.
 *
 * A non-numeric value is also coerced to 0: the endpoint is typed, but a count
 * that is somehow not a number must not reach the DOM as `NaN`.
 */
export function countOf(map: CountMap, key: string): number {
  const value = map[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Human label per role. Sentence case, never the raw enum. */
export function roleLabel(role: Role): string {
  switch (role) {
    case 'ADMIN':
      return 'Admins';
    case 'PATIENT':
      return 'Patients';
    case 'DOCTOR':
      return 'Doctors';
  }
}

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

export function approvalStatusLabel(status: ApprovalStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Pending review';
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
      return 'Rejected';
  }
}

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

export function consultationStateLabel(state: ConsultationState): string {
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

/** A single labelled count inside a section, ready to render. */
export interface DashboardBucket {
  key: string;
  label: string;
  count: number;
}

/** A dashboard section: a headline total plus its breakdown. */
export interface DashboardSection {
  /** Anchor id, used for the section heading association. */
  id: string;
  title: string;
  description: string;
  total: number;
  /** Where the section's own screen lives. Section ROOT only — see below. */
  href: string;
  /** Link text for the section. */
  linkLabel: string;
  buckets: DashboardBucket[];
}

/**
 * Build the four sections for rendering.
 *
 * BUCKET ORDER IS THE FULL ENUM, not the map's key order. Iterating
 * `Object.keys(map)` would render tiles in whatever order Postgres happened to
 * return and would DROP every zero bucket entirely — so a clean database would
 * show no PENDING tile at all, and the operator could not tell "no pending
 * doctors" from "the pending count is missing". Every enum value always renders,
 * zero or not, in a stable order.
 *
 * The `href`s point at section ROOTS (`/admin/users`, etc.) and never carry a
 * state filter. None of those screens read a URL query param, so a link that
 * looked like it filtered would land on an unfiltered list — a lie. The tiles
 * are therefore navigational to the section, not to the subset.
 */
export function buildSections(data: AdminDashboard): DashboardSection[] {
  return [
    {
      id: 'users',
      title: 'Users',
      description: 'Every account on the platform, including administrators.',
      total: data.users.total,
      href: '/admin/users',
      linkLabel: 'Manage users',
      buckets: [
        ...ROLES.map((r) => ({
          key: r,
          label: roleLabel(r),
          count: countOf(data.users.byRole, r),
        })),
        ...ACCOUNT_STATES.map((s) => ({
          key: s,
          label: accountStateLabel(s),
          count: countOf(data.users.byAccountState, s),
        })),
      ],
    },
    {
      id: 'doctors',
      title: 'Doctor profiles',
      description: 'Review state of every doctor profile.',
      total: data.doctors.total,
      href: '/admin/doctors',
      linkLabel: 'Review doctors',
      buckets: APPROVAL_STATUSES.map((s) => ({
        key: s,
        label: approvalStatusLabel(s),
        count: countOf(data.doctors.byApprovalStatus, s),
      })),
    },
    {
      id: 'appointments',
      title: 'Appointments',
      description: 'Every appointment ever booked, by current state.',
      total: data.appointments.total,
      href: '/admin/appointments',
      linkLabel: 'Oversee appointments',
      buckets: APPOINTMENT_STATUSES.map((s) => ({
        key: s,
        label: appointmentStatusLabel(s),
        count: countOf(data.appointments.byStatus, s),
      })),
    },
    {
      id: 'consultationSessions',
      title: 'Consultation sessions',
      description: 'Live and completed consultations.',
      total: data.consultationSessions.total,
      href: '/admin/appointments',
      linkLabel: 'Oversee appointments',
      buckets: CONSULTATION_STATES.map((s) => ({
        key: s,
        label: consultationStateLabel(s),
        count: countOf(data.consultationSessions.byState, s),
      })),
    },
  ];
}

/**
 * Patient + doctor count, i.e. the accounts the Users screen actually lists.
 *
 * GET /admin/users filters to role in [PATIENT, DOCTOR], so it shows FEWER rows
 * than `users.total` — the dashboard total includes administrators. Both numbers
 * are correct and they disagree by design. The screen shows the raw total (so it
 * agrees with the API) AND names this difference next to the link, so an
 * operator clicking through to a 10-row list after reading "11" knows why.
 */
export function manageableUserCount(data: AdminDashboard): number {
  return countOf(data.users.byRole, 'PATIENT') + countOf(data.users.byRole, 'DOCTOR');
}

/**
 * Sum a section's buckets back up.
 *
 * Used to check the server's `total` against its own groupBy. They are computed
 * by two separate queries (count + groupBy) with no transaction, so a write
 * landing between them can legitimately make them disagree by a row. This is
 * surfaced rather than hidden: silently rendering either number alone would
 * conceal a real read inconsistency.
 *
 * NOTE the users section mixes TWO groupBys (role and accountState), so its
 * buckets deliberately do NOT sum to the total — every account has one role AND
 * one state. Callers must therefore check consistency per-dimension, not on the
 * concatenated bucket list; the screen calls it on the single-dimension sections
 * only.
 */
export function sumBuckets(buckets: ReadonlyArray<DashboardBucket>): number {
  return buckets.reduce((acc, b) => acc + b.count, 0);
}

/** A section whose bucket sum disagrees with its headline total. */
export interface Inconsistency {
  sectionId: string;
  total: number;
  summed: number;
}

/**
 * Find sections where the headline total and the bucket sum disagree.
 *
 * Only single-dimension sections are checkable (see sumBuckets); the users
 * section is skipped by construction because its buckets span two dimensions.
 * An empty array is the normal, healthy case.
 */
export function findInconsistencies(sections: ReadonlyArray<DashboardSection>): Inconsistency[] {
  const singles = ['doctors', 'appointments', 'consultationSessions'];
  return sections
    .filter((s) => singles.includes(s.id))
    .map((s) => ({ sectionId: s.id, total: s.total, summed: sumBuckets(s.buckets) }))
    .filter((s) => s.total !== s.summed);
}

/** Human-readable name for a section id, for the inconsistency notice. */
export function sectionTitle(sections: ReadonlyArray<DashboardSection>, id: string): string {
  return sections.find((s) => s.id === id)?.title ?? id;
}
