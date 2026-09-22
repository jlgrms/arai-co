// Types and pure helpers for the admin doctor-profile review screen (Layer 8
// sub-item 2).
//
// Mirrors GET /admin/doctors and PATCH /admin/doctors/:id/review exactly
// (apps/backend/src/admin/admin.service.ts, DOCTOR_ADMIN_SELECT and
// apps/backend/src/admin/dto/review-doctor.dto.ts).
//
// Kept as a separate pure module so the diffing/labelling rules are unit-testable
// without a DOM — the same split used by admin-user-types / booking-types.
//
// ID NOTE — the `id` on each row is the DoctorProfile id, NOT the User id, and
// that is exactly what PATCH /admin/doctors/:id/review expects. The projection
// returns both (`id` = profile, `user.id` = account), so unlike the
// appointment/session UUID pair there is no id-mismatch trap — but the two are
// still named apart deliberately, because sending the user id would 404.

/**
 * Mirrors the Prisma ApprovalStatus enum. Declared here rather than imported
 * from the generated Prisma client: the frontend never depends on
 * @prisma/client, and admin-user-types does not carry this type either (user
 * management deals in AccountState, not approval). The backend default is
 * PENDING (schema.prisma).
 */
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * One row of GET /admin/doctors.
 *
 * The projection carries `user: { id, email, accountState }` — notably NO
 * passwordHash and no auth internals. `biography` is nullable in the schema, as
 * is `name` (a profile created but never filled in).
 */
export interface AdminDoctor {
  id: string;
  userId: string;
  name: string | null;
  biography: string | null;
  specialization: string;
  approvalStatus: ApprovalStatus;
  user: { id: string; email: string; accountState: string };
}

/** Body of PATCH /admin/doctors/:id/review. */
export interface ReviewDoctorInput {
  approvalStatus?: ApprovalStatus;
  name?: string;
  biography?: string;
  specialization?: string;
  reason?: string;
}

/** The three review states, in review lifecycle order. */
export const APPROVAL_STATUSES: ReadonlyArray<ApprovalStatus> = [
  'PENDING',
  'APPROVED',
  'REJECTED',
];

/**
 * Human label for an approval status. Sentence case, matching the rest of the
 * app (the raw enum is never shown to a user).
 */
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

/**
 * Badge variant per status.
 *
 * PENDING is 'muted' rather than the more obvious 'danger': a pending profile is
 * the DEFAULT state (schema default) and represents work waiting to be done, not
 * a problem. Colouring the whole queue red would make a normal backlog read as a
 * failure, and would compete with the REJECTED rows that the admin is actually
 * looking for. This mirrors accountStateVariant's treatment of DEACTIVATED.
 */
export function approvalStatusVariant(
  status: ApprovalStatus,
): 'success' | 'danger' | 'muted' {
  switch (status) {
    case 'APPROVED':
      return 'success';
    case 'REJECTED':
      return 'danger';
    case 'PENDING':
      return 'muted';
  }
}

/**
 * Display name for a row.
 *
 * Falls back to the email rather than a placeholder: a profile with no name yet
 * still has to be identifiable in the review queue (and a nameless profile is
 * plausible — the field is nullable), and the email is the only other
 * identifier the projection carries.
 */
export function displayName(doctor: AdminDoctor): string {
  const name = doctor.name?.trim();
  return name && name !== '' ? name : doctor.user.email;
}

/**
 * Server-less avatar initials, matching the doctor's own profile screen.
 *
 * The "Dr." honorific is stripped first so "Dr. Rohan Patel" yields "RP" rather
 * than "DR" — the honorific is a title, not a name, and including it makes most
 * doctor avatars read identically.
 */
export function initials(name: string | null, fallbackEmail: string): string {
  const source = (name?.trim() || fallbackEmail).replace(/^Dr\.?\s+/i, '');
  const letters = source
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return letters || '—';
}

/** Where the account stands on sign-in, shown alongside the review state. */
export function accountStateNote(doctor: AdminDoctor): string | null {
  if (doctor.user.accountState === 'ACTIVE') return null;
  return `Account ${doctor.user.accountState.toLowerCase()}`;
}

export interface DoctorFilters {
  q: string;
  approvalStatus: ApprovalStatus | 'ALL';
}

export const EMPTY_FILTERS: DoctorFilters = { q: '', approvalStatus: 'ALL' };

/**
 * Build the query string for GET /admin/doctors.
 *
 * Empty/ALL filters are OMITTED rather than sent as blank values: a
 * present-but-empty `q` makes the backend run two pointless ILIKE clauses, and
 * an unvalidated '' for `approvalStatus` would be a 400 against the enum. Same
 * rule as buildUsersQuery.
 */
export function buildDoctorsQuery(filters: DoctorFilters): string {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  if (q !== '') params.set('q', q);
  if (filters.approvalStatus !== 'ALL') params.set('approvalStatus', filters.approvalStatus);
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

/** True when any filter is narrowing the list — drives the "clear" affordance. */
export function hasActiveFilters(filters: DoctorFilters): boolean {
  return filters.q.trim() !== '' || filters.approvalStatus !== 'ALL';
}

/** Count the doctors in each review state, for the summary line. */
export function summarizeApproval(
  doctors: ReadonlyArray<AdminDoctor>,
): Record<ApprovalStatus, number> {
  const summary: Record<ApprovalStatus, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const d of doctors) summary[d.approvalStatus] += 1;
  return summary;
}

/** A stable, readable summary of the current result set, or null when empty. */
export function resultSummary(count: number, filters: DoctorFilters): string | null {
  if (count === 0) return null;
  const noun = count === 1 ? 'profile' : 'profiles';
  return hasActiveFilters(filters)
    ? `${count} matching ${noun} shown`
    : `${count} ${noun} shown`;
}

/**
 * The editable snapshot of a doctor, as the review form holds it.
 * All three are plain strings so an untouched field round-trips exactly
 * (a null biography becomes '' and is compared against '' — see buildReviewPatch).
 */
export interface ReviewForm {
  name: string;
  specialization: string;
  biography: string;
}

export function doctorToForm(doctor: AdminDoctor): ReviewForm {
  return {
    name: doctor.name ?? '',
    specialization: doctor.specialization ?? '',
    biography: doctor.biography ?? '',
  };
}

/**
 * Diff the form against the loaded doctor so PATCH carries ONLY changed fields.
 *
 * Three rules, each of which is a bug if broken:
 *
 *  1. Unchanged fields are OMITTED. The DTO is a partial update, so a field the
 *     admin never touched must not be re-sent — otherwise a stale form could
 *     clobber a concurrent edit.
 *  2. `approvalStatus` is included ONLY when the admin actually changed it.
 *     Re-sending the current status is accepted by the server and still audited
 *     (see reviewDoctor), so doing it silently would manufacture an audit entry
 *     claiming a decision nobody made.
 *  3. The result is NEVER empty. The server answers an empty body with
 *     400 "No review fields provided", so an all-unchanged form must be caught
 *     by the caller BEFORE reaching here — `reviewPatchIsEmpty` exists for that,
 *     and the screen checks it to show "No changes to save" instead of erroring.
 *
 * `name` and `specialization` are NOT NULL in the schema; an emptied field is
 * therefore a validation failure, not a clear, and is left to the caller's
 * client-side guard (the server's `@IsNotEmpty` is the authority either way).
 */
export function buildReviewPatch(
  form: ReviewForm,
  original: AdminDoctor,
  nextStatus: ApprovalStatus,
  reason: string,
): ReviewDoctorInput {
  const patch: ReviewDoctorInput = {};

  if (nextStatus !== original.approvalStatus) patch.approvalStatus = nextStatus;

  const name = form.name.trim();
  if (name !== (original.name ?? '').trim() && name !== '') patch.name = name;

  const specialization = form.specialization.trim();
  if (
    specialization !== (original.specialization ?? '').trim() &&
    specialization !== ''
  ) {
    patch.specialization = specialization;
  }

  // biography has NO @IsNotEmpty on the server, so an emptied biography is a
  // deliberate clear, not an error — sending '' is the only way to express it.
  const biography = form.biography.trim();
  if (biography !== (original.biography ?? '').trim()) patch.biography = biography;

  // `reason` rides along with any actual change; on its own it changes nothing,
  // so it is never what makes the patch non-empty.
  const trimmedReason = reason.trim();
  if (Object.keys(patch).length > 0 && trimmedReason !== '') patch.reason = trimmedReason;

  return patch;
}

/** True when a patch would change nothing — the caller must not send it (400). */
export function reviewPatchIsEmpty(patch: ReviewDoctorInput): boolean {
  return (
    patch.approvalStatus === undefined &&
    patch.name === undefined &&
    patch.biography === undefined &&
    patch.specialization === undefined
  );
}

/**
 * Client-side guard mirroring the server's @IsNotEmpty on name/specialization.
 *
 * These are the only two rules the backend expresses as a plain 400 on this
 * path, so they are checked before the request to give the admin a field-level
 * message rather than a generic failure. Everything else is left to the server,
 * which stays the authority. Mirrors doctor-profile-screen's onSubmit guards.
 */
export function validateReviewForm(form: ReviewForm): {
  name?: string;
  specialization?: string;
} {
  const errors: { name?: string; specialization?: string } = {};
  if (form.name.trim() === '') errors.name = 'Name cannot be empty.';
  if (form.specialization.trim() === '') errors.specialization = 'Choose a specialization.';
  return errors;
}

export type ReviewAction = 'approve' | 'reject' | 'reopen';

export interface ReviewActionOption {
  action: ReviewAction;
  label: string;
  /** The status this action moves the profile TO. */
  target: ApprovalStatus;
  /** Variant for the button, so the rejecting option reads as such. */
  variant: 'default' | 'outline' | 'destructive';
  /** Whether this action warrants a confirmation dialog. */
  confirm: boolean;
}

/**
 * Decision actions offered for a profile currently in `status`.
 *
 * The CURRENT status's own action is omitted, mirroring availableActions in
 * admin-user-types: offering "Approve" on an approved profile invites a
 * pointless round-trip, and the server accepts and AUDITS a no-op re-apply, so
 * it would produce a misleading audit trail.
 *
 * Confirmation is scoped to the two decisions (approve/reject) because those are
 * communicated to the doctor — they are the "ruling". Reopening to PENDING is
 * administrative bookkeeping and is not gated, matching ACTIVATE in sub-item 1.
 *
 * REJECTED keeps both options deliberately: a rejection is reversible and is the
 * normal way back from a mistaken decision, so it must not be a dead end.
 */
export function availableReviewActions(status: ApprovalStatus): ReviewActionOption[] {
  const options: ReviewActionOption[] = [];

  if (status !== 'APPROVED') {
    options.push({
      action: 'approve',
      label: 'Approve',
      target: 'APPROVED',
      variant: 'default',
      confirm: true,
    });
  }
  if (status !== 'REJECTED') {
    options.push({
      action: 'reject',
      label: 'Reject',
      target: 'REJECTED',
      variant: 'destructive',
      confirm: true,
    });
  }
  if (status !== 'PENDING') {
    options.push({
      action: 'reopen',
      label: 'Reopen',
      target: 'PENDING',
      variant: 'outline',
      confirm: false,
    });
  }

  return options;
}

/**
 * Confirmation copy for a decision.
 *
 * Written from the DOCTOR's point of view rather than the admin's, because the
 * consequence lands on them: only APPROVED doctors appear in patient discovery
 * and matching (see DoctorsService), so approving and rejecting are the events
 * that decide whether this doctor can be found. An admin should confirm knowing
 * that, not just that a status field is changing.
 */
export function confirmCopy(
  action: ReviewAction,
  name: string,
): { title: string; description: string; confirmLabel: string } {
  switch (action) {
    case 'approve':
      return {
        title: `Approve ${name}?`,
        description:
          'Their profile becomes visible to patients in search and matching.',
        confirmLabel: 'Approve',
      };
    case 'reject':
      return {
        title: `Reject ${name}?`,
        description:
          'They will not appear in patient search or matching. You can reopen the profile later if this was a mistake.',
        confirmLabel: 'Reject',
      };
    case 'reopen':
      return {
        title: `Reopen ${name}?`,
        description: 'The profile returns to the pending queue for review.',
        confirmLabel: 'Reopen',
      };
  }
}
