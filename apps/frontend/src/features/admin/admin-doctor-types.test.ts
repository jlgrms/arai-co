import { describe, expect, it } from 'vitest';

import {
  accountStateNote,
  approvalStatusLabel,
  approvalStatusVariant,
  APPROVAL_STATUSES,
  availableReviewActions,
  buildDoctorsQuery,
  buildReviewPatch,
  confirmCopy,
  displayName,
  doctorToForm,
  EMPTY_FILTERS,
  hasActiveFilters,
  initials,
  resultSummary,
  reviewPatchIsEmpty,
  summarizeApproval,
  validateReviewForm,
  type AdminDoctor,
} from './admin-doctor-types';

function doctor(overrides: Partial<AdminDoctor> = {}): AdminDoctor {
  return {
    id: 'dp1',
    userId: 'u1',
    name: 'Dr. Rohan Patel',
    biography: 'General practitioner with an interest in preventive care.',
    specialization: 'General Medicine',
    approvalStatus: 'APPROVED',
    user: { id: 'u1', email: 'dr.patel@example.com', accountState: 'ACTIVE' },
    ...overrides,
  };
}

describe('labels', () => {
  it('renders approval states in sentence case, never the raw enum', () => {
    expect(approvalStatusLabel('PENDING')).toBe('Pending review');
    expect(approvalStatusLabel('APPROVED')).toBe('Approved');
    expect(approvalStatusLabel('REJECTED')).toBe('Rejected');
  });

  it('marks rejected danger, approved success, and pending muted', () => {
    // PENDING is muted on purpose: it is the schema default (a normal backlog),
    // not an alarm. Asserted so a later "make it red" change is caught.
    expect(approvalStatusVariant('REJECTED')).toBe('danger');
    expect(approvalStatusVariant('APPROVED')).toBe('success');
    expect(approvalStatusVariant('PENDING')).toBe('muted');
  });

  it('lists all three statuses for the filter control', () => {
    expect(APPROVAL_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED']);
  });
});

describe('displayName / initials', () => {
  it('uses the profile name when present', () => {
    expect(displayName(doctor())).toBe('Dr. Rohan Patel');
  });

  it('falls back to the email when the name is null or blank', () => {
    // name is nullable in the schema, so a profile can exist without one.
    expect(displayName(doctor({ name: null }))).toBe('dr.patel@example.com');
    expect(displayName(doctor({ name: '   ' }))).toBe('dr.patel@example.com');
  });

  it('strips the Dr. honorific so initials come from the name proper', () => {
    expect(initials('Dr. Rohan Patel', 'x@y.com')).toBe('RP');
    expect(initials('Dr Rohan Patel', 'x@y.com')).toBe('RP');
  });

  it('falls back to the email for initials when the name is absent', () => {
    // One whitespace-delimited token, so one letter. An email is never split
    // mid-address, which would yield nonsense like "CE" from the domain.
    expect(initials(null, 'camila@example.com')).toBe('C');
  });

  it('never renders an empty avatar', () => {
    expect(initials('   ', '')).toBe('—');
  });
});

describe('accountStateNote', () => {
  it('says nothing for an active account', () => {
    expect(accountStateNote(doctor())).toBeNull();
  });

  it('surfaces a non-active account, because a suspended doctor is still reviewable', () => {
    expect(
      accountStateNote(doctor({ user: { id: 'u1', email: 'a@b.c', accountState: 'SUSPENDED' } })),
    ).toBe('Account suspended');
  });
});

describe('buildDoctorsQuery', () => {
  it('omits ALL/empty filters entirely rather than sending blanks', () => {
    // An empty q would make the backend run two pointless ILIKE clauses, and an
    // unvalidated '' for approvalStatus is a 400 against the enum.
    expect(buildDoctorsQuery(EMPTY_FILTERS)).toBe('');
  });

  it('encodes the search term and status when set', () => {
    expect(buildDoctorsQuery({ q: 'patel', approvalStatus: 'PENDING' })).toBe(
      '?q=patel&approvalStatus=PENDING',
    );
  });

  it('trims the query', () => {
    expect(buildDoctorsQuery({ q: '  reyes  ', approvalStatus: 'ALL' })).toBe('?q=reyes');
  });

  it('encodes special characters in the search term', () => {
    expect(buildDoctorsQuery({ q: 'a&b=c', approvalStatus: 'ALL' })).toBe('?q=a%26b%3Dc');
  });
});

describe('hasActiveFilters / resultSummary', () => {
  it('reports when the list is narrowed', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ q: 'x', approvalStatus: 'ALL' })).toBe(true);
    expect(hasActiveFilters({ q: '', approvalStatus: 'REJECTED' })).toBe(true);
  });

  it('words the summary for filtered vs unfiltered results', () => {
    expect(resultSummary(6, EMPTY_FILTERS)).toBe('6 profiles shown');
    expect(resultSummary(1, { q: 'x', approvalStatus: 'ALL' })).toBe('1 matching profile shown');
    expect(resultSummary(0, EMPTY_FILTERS)).toBeNull();
  });
});

describe('summarizeApproval', () => {
  it('counts each review state', () => {
    const summary = summarizeApproval([
      doctor({ approvalStatus: 'APPROVED' }),
      doctor({ approvalStatus: 'APPROVED' }),
      doctor({ approvalStatus: 'PENDING' }),
      doctor({ approvalStatus: 'REJECTED' }),
    ]);
    expect(summary).toEqual({ PENDING: 1, APPROVED: 2, REJECTED: 1 });
  });

  it('returns zeroes for an empty list rather than omitting keys', () => {
    expect(summarizeApproval([])).toEqual({ PENDING: 0, APPROVED: 0, REJECTED: 0 });
  });
});

describe('buildReviewPatch', () => {
  it('includes only approvalStatus when nothing but a decision changed', () => {
    const d = doctor();
    const patch = buildReviewPatch(doctorToForm(d), d, 'REJECTED', '');
    expect(patch).toEqual({ approvalStatus: 'REJECTED' });
  });

  it('omits approvalStatus when the status did not change', () => {
    // Re-sending the current status is accepted and AUDITED by the server, so a
    // silent no-op would manufacture a decision nobody made.
    const d = doctor();
    const patch = buildReviewPatch(doctorToForm(d), d, 'APPROVED', '');
    expect(patch.approvalStatus).toBeUndefined();
  });

  it('omits unchanged profile fields so a stale form cannot clobber them', () => {
    const d = doctor();
    const patch = buildReviewPatch(doctorToForm(d), d, 'APPROVED', '');
    expect(patch.name).toBeUndefined();
    expect(patch.biography).toBeUndefined();
    expect(patch.specialization).toBeUndefined();
  });

  it('carries only the fields that actually changed', () => {
    const d = doctor();
    const form = { ...doctorToForm(d), specialization: 'Cardiology' };
    const patch = buildReviewPatch(form, d, 'APPROVED', '');
    expect(patch).toEqual({ specialization: 'Cardiology' });
  });

  it('trims edited values before sending', () => {
    const d = doctor();
    const form = { ...doctorToForm(d), name: '  Dr. Rohan A. Patel  ' };
    expect(buildReviewPatch(form, d, 'APPROVED', '').name).toBe('Dr. Rohan A. Patel');
  });

  it('treats a null biography as empty, so clearing an already-empty bio is not a change', () => {
    const d = doctor({ biography: null });
    const patch = buildReviewPatch({ ...doctorToForm(d), biography: '' }, d, 'APPROVED', '');
    expect(patch.biography).toBeUndefined();
  });

  it('sends an emptied biography as a deliberate clear (the server allows it)', () => {
    // biography has no @IsNotEmpty on this path, unlike name/specialization.
    const d = doctor({ biography: 'Something long.' });
    const patch = buildReviewPatch({ ...doctorToForm(d), biography: '' }, d, 'APPROVED', '');
    expect(patch.biography).toBe('');
  });

  it('never sends a blank name or specialization, even if the field was emptied', () => {
    // Both are @IsNotEmpty server-side; a blank would be a 400. The form guard
    // catches this first — here we assert the patch cannot smuggle it through.
    const d = doctor();
    const patch = buildReviewPatch({ ...doctorToForm(d), name: '', specialization: '' }, d, 'APPROVED', '');
    expect(patch.name).toBeUndefined();
    expect(patch.specialization).toBeUndefined();
  });

  it('attaches a trimmed reason to a real change', () => {
    const d = doctor();
    const patch = buildReviewPatch(doctorToForm(d), d, 'REJECTED', '  Credentials unverifiable  ');
    expect(patch.reason).toBe('Credentials unverifiable');
  });

  it('never attaches a reason to an otherwise-empty patch', () => {
    // A reason alone changes nothing, so it must not be what makes a patch
    // non-empty — otherwise the request would be a 400 "No review fields
    // provided" dressed up as a successful save.
    const d = doctor();
    const patch = buildReviewPatch(doctorToForm(d), d, 'APPROVED', 'just a note');
    expect(reviewPatchIsEmpty(patch)).toBe(true);
    expect(patch.reason).toBeUndefined();
  });

  it('can gatekeep and edit in one call, which is the point of the endpoint', () => {
    const d = doctor({ approvalStatus: 'PENDING' });
    const patch = buildReviewPatch(
      { ...doctorToForm(d), specialization: 'Dermatology', biography: 'Updated bio.' },
      d,
      'APPROVED',
      'Verified',
    );
    expect(patch).toEqual({
      approvalStatus: 'APPROVED',
      specialization: 'Dermatology',
      biography: 'Updated bio.',
      reason: 'Verified',
    });
  });
});

describe('reviewPatchIsEmpty', () => {
  it('is true only when no reviewable field is present', () => {
    expect(reviewPatchIsEmpty({})).toBe(true);
    expect(reviewPatchIsEmpty({ reason: 'x' })).toBe(true);
    expect(reviewPatchIsEmpty({ name: 'x' })).toBe(false);
    expect(reviewPatchIsEmpty({ name: '' })).toBe(false); // still a field present
    expect(reviewPatchIsEmpty({ approvalStatus: 'APPROVED' })).toBe(false);
  });
});

describe('validateReviewForm', () => {
  it('accepts a complete form', () => {
    expect(validateReviewForm(doctorToForm(doctor()))).toEqual({});
  });

  it('flags the two fields the server marks @IsNotEmpty', () => {
    expect(validateReviewForm({ name: '  ', specialization: '', biography: 'x' })).toEqual({
      name: 'Name cannot be empty.',
      specialization: 'Choose a specialization.',
    });
  });

  it('never flags biography — the server accepts an empty one', () => {
    expect(validateReviewForm({ name: 'Dr. X', specialization: 'Cardiology', biography: '' })).toEqual(
      {},
    );
  });
});

describe('availableReviewActions', () => {
  it('omits the current status\u2019s own action', () => {
    expect(availableReviewActions('APPROVED').map((o) => o.action)).toEqual(['reject', 'reopen']);
    expect(availableReviewActions('REJECTED').map((o) => o.action)).toEqual(['approve', 'reopen']);
    expect(availableReviewActions('PENDING').map((o) => o.action)).toEqual(['approve', 'reject']);
  });

  it('targets the right status for each action', () => {
    const byAction = Object.fromEntries(
      availableReviewActions('PENDING').map((o) => [o.action, o.target]),
    );
    expect(byAction.approve).toBe('APPROVED');
    expect(byAction.reject).toBe('REJECTED');
  });

  it('leaves rejected profiles a way back — a rejection is not a dead end', () => {
    const actions = availableReviewActions('REJECTED');
    expect(actions.some((o) => o.action === 'approve')).toBe(true);
    expect(actions.some((o) => o.action === 'reopen')).toBe(true);
  });

  it('confirms the two decisions but not the bookkeeping reopen', () => {
    const opts = (s: Parameters<typeof availableReviewActions>[0]) =>
      Object.fromEntries(availableReviewActions(s).map((o) => [o.action, o.confirm]));
    expect(opts('PENDING')).toEqual({ approve: true, reject: true });
    expect(opts('APPROVED').reopen).toBe(false);
    expect(opts('REJECTED').reopen).toBe(false);
  });

  it('marks reject destructive and approve not', () => {
    const opts = Object.fromEntries(
      availableReviewActions('PENDING').map((o) => [o.action, o.variant]),
    );
    expect(opts.reject).toBe('destructive');
    expect(opts.approve).toBe('default');
  });
});

describe('confirmCopy', () => {
  it('names the doctor and states the consequence for each decision', () => {
    expect(confirmCopy('approve', 'Dr. Reyes').title).toBe('Approve Dr. Reyes?');
    expect(confirmCopy('approve', 'Dr. Reyes').description).toContain('visible to patients');
    expect(confirmCopy('reject', 'Dr. Reyes').title).toBe('Reject Dr. Reyes?');
    expect(confirmCopy('reject', 'Dr. Reyes').description).toContain('not appear in patient search');
  });

  it('tells the admin a rejection is reversible', () => {
    expect(confirmCopy('reject', 'Dr. Reyes').description).toContain('reopen');
  });

  it('uses a distinct confirm label per action', () => {
    expect(confirmCopy('approve', 'X').confirmLabel).toBe('Approve');
    expect(confirmCopy('reject', 'X').confirmLabel).toBe('Reject');
    expect(confirmCopy('reopen', 'X').confirmLabel).toBe('Reopen');
  });
});
