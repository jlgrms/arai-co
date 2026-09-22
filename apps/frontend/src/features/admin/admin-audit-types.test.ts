import { describe, expect, it } from 'vitest';

import {
  actionLabel,
  adminText,
  affectedRecordText,
  auditSummary,
  distinctAdminCount,
  EMPTY_AUDIT_FILTERS,
  filterAuditLog,
  filterOptions,
  formatAuditTimestamp,
  hasActiveAuditFilters,
  isKnownAction,
  isNewestFirst,
  reasonText,
  recordTypeLabel,
  type AuditLogRow,
} from './admin-audit-types';

/**
 * Fixtures deliberately mirror the LIVE payload shapes, including its awkward
 * cases: a null reason (23 of 44 live rows), an unrecognised action (none today,
 * but the schema is a free-form String so one can appear), and a null
 * affectedRecordId (nullable in the schema).
 */
function row(over: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: 'row-1',
    adminUserId: 'admin-1',
    action: 'APPOINTMENT_CANCEL',
    affectedRecordType: 'APPOINTMENT',
    affectedRecordId: '78e04d2a-4fb4-4777-b164-2d328accf7f1',
    reason: 'harness cleanup of rebooking',
    timestamp: '2026-09-22T16:00:33.225Z',
    adminUser: { id: 'admin-1', email: 'admin@example.com' },
    ...over,
  };
}

describe('actionLabel', () => {
  it('labels every known action with human wording, never the raw enum', () => {
    expect(actionLabel('APPOINTMENT_CANCEL')).toBe('Appointment cancelled');
    expect(actionLabel('DOCTOR_APPROVAL_UPDATE')).toBe('Doctor profile reviewed');
    expect(actionLabel('USER_STATE_CHANGE')).toBe('User state changed');
    for (const a of ['APPOINTMENT_CANCEL', 'DOCTOR_APPROVAL_UPDATE', 'USER_STATE_CHANGE']) {
      expect(actionLabel(a)).not.toBe(a);
    }
  });

  it('FALLS BACK TO THE RAW STRING for an unrecognised action', () => {
    // The important property: a future backend action must render its stored
    // value, not be hidden behind "Unknown". An audit log that cannot describe a
    // record must still show it.
    expect(actionLabel('SOMETHING_NEW_IN_2027')).toBe('SOMETHING_NEW_IN_2027');
    expect(actionLabel('SOMETHING_NEW_IN_2027')).not.toBe('Unknown');
  });

  it('renders an em-dash for an empty or whitespace-only action', () => {
    // Not blank: a blank Action cell reads as a failed render, the same reason
    // the Reason column uses an em-dash.
    expect(actionLabel('')).toBe('—');
    expect(actionLabel('   ')).toBe('—');
  });

  it('trims surrounding whitespace before labelling', () => {
    expect(actionLabel('  APPOINTMENT_CANCEL  ')).toBe('Appointment cancelled');
  });

  it('isKnownAction distinguishes labelled from unlabelled', () => {
    expect(isKnownAction('APPOINTMENT_CANCEL')).toBe(true);
    expect(isKnownAction('SOMETHING_NEW')).toBe(false);
    // Prototype keys must not be mistaken for known actions.
    expect(isKnownAction('toString')).toBe(false);
    expect(isKnownAction('constructor')).toBe(false);
  });
});

describe('recordTypeLabel', () => {
  it('labels the known record types', () => {
    expect(recordTypeLabel('APPOINTMENT')).toBe('Appointment');
    expect(recordTypeLabel('DOCTOR_PROFILE')).toBe('Doctor profile');
    expect(recordTypeLabel('USER')).toBe('User');
  });

  it('falls back to the raw string for an unknown type', () => {
    expect(recordTypeLabel('PRESCRIPTION')).toBe('PRESCRIPTION');
  });

  it('renders an em-dash for an empty record type', () => {
    expect(recordTypeLabel('')).toBe('—');
    expect(recordTypeLabel('  ')).toBe('—');
  });
});

describe('affectedRecordText', () => {
  it('returns the id when present', () => {
    expect(affectedRecordText(row())).toBe('78e04d2a-4fb4-4777-b164-2d328accf7f1');
  });

  it('returns an em-dash, not blank, when the id is null', () => {
    const text = affectedRecordText(row({ affectedRecordId: null }));
    expect(text).toBe('—');
    expect(text).not.toBe('');
  });
});

describe('reasonText', () => {
  it('returns the reason verbatim when present', () => {
    expect(reasonText(row({ reason: 'Patient requested' }))).toBe('Patient requested');
  });

  it('returns an em-dash for a null reason', () => {
    expect(reasonText(row({ reason: null }))).toBe('—');
  });

  it('treats whitespace-only as absent rather than rendering blank space', () => {
    expect(reasonText(row({ reason: '   ' }))).toBe('—');
  });

  it('NEVER redacts or paraphrases a reason', () => {
    const text = reasonText(row({ reason: 'suspended pending investigation' }));
    expect(text).toBe('suspended pending investigation');
  });
});

describe('adminText', () => {
  it('returns the admin email', () => {
    expect(adminText(row())).toBe('admin@example.com');
  });

  it('falls back rather than throwing when the relation is missing', () => {
    // Deliberately malformed payload: the relation is required in the type, so
    // the cast is what models "the server sent something the type did not
    // predict". The screen must degrade, not whitescreen.
    const malformed = row({ adminUser: undefined as unknown as AuditLogRow['adminUser'] });
    expect(adminText(malformed)).toBe('Unknown administrator');
  });
});

describe('formatAuditTimestamp', () => {
  it('renders UTC explicitly with a UTC suffix', () => {
    const text = formatAuditTimestamp('2026-09-22T16:00:33.225Z');
    expect(text).toBe('22 Sep 2026, 16:00:33 UTC');
  });

  it('does NOT shift the time to a local zone', () => {
    // A security record must state which clock it uses; silently localising
    // would make two viewers disagree about when an action happened.
    const text = formatAuditTimestamp('2026-09-22T00:30:00.000Z');
    expect(text).toContain('00:30:00');
    expect(text).toContain('22 Sep 2026');
  });

  it('renders an em-dash for an unparseable timestamp instead of "Invalid Date"', () => {
    const text = formatAuditTimestamp('not-a-date');
    expect(text).toBe('—');
    expect(text).not.toContain('Invalid');
  });

  it('zero-pads the time components', () => {
    expect(formatAuditTimestamp('2026-01-02T03:04:05.000Z')).toBe('2 Jan 2026, 03:04:05 UTC');
  });
});

describe('filterOptions', () => {
  it('derives facets from the data, not a hardcoded list', () => {
    const rows = [
      row({ action: 'USER_STATE_CHANGE', affectedRecordType: 'USER' }),
      row({ action: 'APPOINTMENT_CANCEL', affectedRecordType: 'APPOINTMENT' }),
      row({ action: 'SOMETHING_NEW', affectedRecordType: 'PRESCRIPTION' }),
    ];
    const opts = filterOptions(rows);
    expect(opts.actions).toContain('SOMETHING_NEW');
    expect(opts.recordTypes).toContain('PRESCRIPTION');
  });

  it('deduplicates and sorts', () => {
    const rows = [
      row({ action: 'USER_STATE_CHANGE' }),
      row({ action: 'APPOINTMENT_CANCEL' }),
      row({ action: 'USER_STATE_CHANGE' }),
    ];
    expect(filterOptions(rows).actions).toEqual(['APPOINTMENT_CANCEL', 'USER_STATE_CHANGE']);
  });

  it('lists each distinct admin once, sorted by email', () => {
    const rows = [
      row({ adminUser: { id: 'b', email: 'zoe@example.com' } }),
      row({ adminUser: { id: 'a', email: 'amy@example.com' } }),
      row({ adminUser: { id: 'b', email: 'zoe@example.com' } }),
    ];
    expect(filterOptions(rows).admins).toEqual([
      { id: 'a', email: 'amy@example.com' },
      { id: 'b', email: 'zoe@example.com' },
    ]);
  });

  it('returns empty facets for an empty log rather than throwing', () => {
    expect(filterOptions([])).toEqual({ admins: [], actions: [], recordTypes: [] });
  });
});

describe('filterAuditLog', () => {
  const rows = [
    row({ id: 'r1', action: 'APPOINTMENT_CANCEL', affectedRecordType: 'APPOINTMENT' }),
    row({ id: 'r2', action: 'USER_STATE_CHANGE', affectedRecordType: 'USER' }),
    row({
      id: 'r3',
      action: 'USER_STATE_CHANGE',
      affectedRecordType: 'USER',
      adminUser: { id: 'admin-2', email: 'other@example.com' },
    }),
  ];

  it('returns everything when no facet is active', () => {
    expect(filterAuditLog(rows, EMPTY_AUDIT_FILTERS)).toHaveLength(3);
  });

  it('narrows by action', () => {
    const out = filterAuditLog(rows, { ...EMPTY_AUDIT_FILTERS, action: 'USER_STATE_CHANGE' });
    expect(out.map((r) => r.id)).toEqual(['r2', 'r3']);
  });

  it('narrows by record type', () => {
    const out = filterAuditLog(rows, { ...EMPTY_AUDIT_FILTERS, recordType: 'APPOINTMENT' });
    expect(out.map((r) => r.id)).toEqual(['r1']);
  });

  it('narrows by admin', () => {
    const out = filterAuditLog(rows, { ...EMPTY_AUDIT_FILTERS, adminUserId: 'admin-2' });
    expect(out.map((r) => r.id)).toEqual(['r3']);
  });

  it('ANDs the facets together', () => {
    const out = filterAuditLog(rows, {
      adminUserId: 'admin-2',
      action: 'USER_STATE_CHANGE',
      recordType: 'USER',
    });
    expect(out.map((r) => r.id)).toEqual(['r3']);
  });

  it('returns empty rather than everything when facets conflict', () => {
    const out = filterAuditLog(rows, {
      ...EMPTY_AUDIT_FILTERS,
      action: 'APPOINTMENT_CANCEL',
      recordType: 'USER',
    });
    expect(out).toHaveLength(0);
  });

  it('does not mutate the input array', () => {
    const before = [...rows];
    filterAuditLog(rows, { ...EMPTY_AUDIT_FILTERS, action: 'USER_STATE_CHANGE' });
    expect(rows).toEqual(before);
  });
});

describe('hasActiveAuditFilters', () => {
  it('is false for the empty filter set', () => {
    expect(hasActiveAuditFilters(EMPTY_AUDIT_FILTERS)).toBe(false);
  });

  it('is true when any single facet is narrowed', () => {
    expect(hasActiveAuditFilters({ ...EMPTY_AUDIT_FILTERS, action: 'X' })).toBe(true);
    expect(hasActiveAuditFilters({ ...EMPTY_AUDIT_FILTERS, recordType: 'X' })).toBe(true);
    expect(hasActiveAuditFilters({ ...EMPTY_AUDIT_FILTERS, adminUserId: 'X' })).toBe(true);
  });
});

describe('auditSummary', () => {
  it('says "shown" not "found" — the filtering is local', () => {
    const text = auditSummary(9, 44, { ...EMPTY_AUDIT_FILTERS, action: 'APPOINTMENT_CANCEL' });
    expect(text).toContain('Showing 9 of 44');
    expect(text).toContain('filtered locally');
    expect(text.toLowerCase()).not.toContain('found');
  });

  it('describes the unfiltered case as showing all', () => {
    expect(auditSummary(44, 44, EMPTY_AUDIT_FILTERS)).toBe('Showing all 44 recorded entries.');
  });

  it('singularises a one-row log', () => {
    expect(auditSummary(1, 1, EMPTY_AUDIT_FILTERS)).toBe('Showing all 1 recorded entry.');
  });

  it('still reads correctly at zero rows', () => {
    expect(auditSummary(0, 0, EMPTY_AUDIT_FILTERS)).toContain('0 recorded entries');
  });
});

describe('isNewestFirst', () => {
  it('is true for descending timestamps', () => {
    expect(
      isNewestFirst([
        row({ timestamp: '2026-09-22T16:00:00.000Z' }),
        row({ timestamp: '2026-09-22T15:00:00.000Z' }),
      ]),
    ).toBe(true);
  });

  it('is true for a single row and for an empty log', () => {
    expect(isNewestFirst([row()])).toBe(true);
    expect(isNewestFirst([])).toBe(true);
  });

  it('is false when the payload arrives oldest-first', () => {
    expect(
      isNewestFirst([
        row({ timestamp: '2026-09-22T15:00:00.000Z' }),
        row({ timestamp: '2026-09-22T16:00:00.000Z' }),
      ]),
    ).toBe(false);
  });

  it('tolerates equal timestamps', () => {
    expect(isNewestFirst([row(), row()])).toBe(true);
  });
});

describe('distinctAdminCount', () => {
  it('counts distinct authors', () => {
    expect(
      distinctAdminCount([
        row({ adminUser: { id: 'a', email: 'a@x.com' } }),
        row({ adminUser: { id: 'a', email: 'a@x.com' } }),
        row({ adminUser: { id: 'b', email: 'b@x.com' } }),
      ]),
    ).toBe(2);
  });

  it('is zero for an empty log', () => {
    expect(distinctAdminCount([])).toBe(0);
  });
});
