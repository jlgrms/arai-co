// Types and pure helpers for the admin audit log (Layer 8 sub-item 5).
//
// Mirrors GET /admin/audit-logs exactly (apps/backend/src/admin/admin.service.ts,
// listAuditLogs()). Kept as a separate pure module so the labelling, the
// filtering, and the "unknown action" handling are unit-testable without a DOM —
// the same split used by admin-user-types / admin-doctor-types /
// admin-appointment-types / admin-dashboard-types.

/**
 * One audit row as the endpoint returns it.
 *
 * `action` and `affectedRecordType` are free-form Strings in the schema
 * (schema.prisma, AuditLog) — NOT Prisma enums. They are typed as `string` here
 * on purpose, not as a union of the three values in use today: an audit log that
 * could only display actions the frontend already knew about would silently hide
 * a row written by any future action. See actionLabel / recordTypeLabel.
 *
 * `affectedRecordId` is nullable in the schema. It happens to be non-null for
 * every row today, but the type must not assume that.
 */
export interface AuditLogRow {
  id: string;
  adminUserId: string;
  action: string;
  affectedRecordType: string;
  affectedRecordId: string | null;
  reason: string | null;
  timestamp: string;
  adminUser: {
    id: string;
    email: string;
  };
}

/**
 * The known actions in use, with human labels.
 *
 * This map is for DISPLAY ONLY. It is deliberately not a closed union and
 * anything missing falls back to the raw string (see actionLabel) — a new
 * backend action must show up in the log the day it starts being written, not
 * the day a frontend constant is updated.
 */
const ACTION_LABELS: Record<string, string> = {
  APPOINTMENT_CANCEL: 'Appointment cancelled',
  DOCTOR_APPROVAL_UPDATE: 'Doctor profile reviewed',
  USER_STATE_CHANGE: 'User state changed',
};

/** The known record types, with human labels. Same display-only caveat. */
const RECORD_TYPE_LABELS: Record<string, string> = {
  APPOINTMENT: 'Appointment',
  DOCTOR_PROFILE: 'Doctor profile',
  USER: 'User',
};

/**
 * Human label for an action, falling back to the raw stored string.
 *
 * The fallback is the point: an unrecognised action renders as its raw value
 * rather than as "Unknown" or blank. An audit log must never make a record it
 * cannot describe look like a record that failed to load.
 *
 * An empty or whitespace-only action also renders an em-dash rather than an
 * empty cell, for the same reason the Reason column does: a blank cell reads as
 * a failed render, not as absent data.
 */
export function actionLabel(action: string): string {
  const trimmed = action?.trim();
  if (!trimmed) return '—';
  return ACTION_LABELS[trimmed] ?? trimmed;
}

/** True when the action is one this build has a label for. */
export function isKnownAction(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACTION_LABELS, action);
}

export function recordTypeLabel(recordType: string): string {
  const trimmed = recordType?.trim();
  if (!trimmed) return '—';
  return RECORD_TYPE_LABELS[trimmed] ?? trimmed;
}

/**
 * The record's id, or an explicit em-dash when it is null.
 *
 * Rendered as PLAIN TEXT and never as a link (Flag A). The id is a UUID pointing
 * at a record that may since have been deleted — 9 APPOINTMENT rows already
 * reference appointments removed by harness cleanup, and 4 DOCTOR_PROFILE rows
 * reference the deleted sub-item 2 fixture doctor. A link to a UUID that no
 * longer resolves would be a dead end presented as navigation.
 */
export function affectedRecordText(row: AuditLogRow): string {
  return row.affectedRecordId ?? '—';
}

/**
 * The reason, or an explicit em-dash when absent.
 *
 * NEVER redacted and never replaced with a generic phrase (Flag C): 23 of the 44
 * rows in the live log carry no reason, and "no reason given" is itself part of
 * the audit record. Blank would read as a failed render, so an em-dash states
 * the absence deliberately.
 */
export function reasonText(row: AuditLogRow): string {
  const reason = row.reason?.trim();
  return reason ? reason : '—';
}

/**
 * The admin's email, or a fallback when the relation is unexpectedly absent.
 *
 * `adminUser` is a required relation with a Cascade delete, so the server always
 * includes it — but the screen must not throw a whitescreen on a payload that
 * disagrees.
 */
export function adminText(row: AuditLogRow): string {
  return row.adminUser?.email ?? 'Unknown administrator';
}

/**
 * Fixed month abbreviations, indexed by UTC month.
 *
 * NOT `toLocaleString({ month: 'short' })`. Node's ICU renders September as
 * "Sept" in en-GB, which is neither the 3-letter form the rest of the app uses
 * nor stable across ICU versions and locales — a date format that changes with
 * the environment is a poor fit for a security record. A literal table makes the
 * output identical everywhere. (Found by a failing test.)
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format an audit timestamp for display.
 *
 * NOTE: rendered in UTC, which is the KNOWN GAP recorded as DEFERRED.md item 4.
 * AuditLog.timestamp is a DateTime and the API returns a UTC ISO string; the rest
 * of the app has no user-locale handling, so this screen is consistent with it
 * rather than inventing a second convention. The " UTC" suffix is explicit so an
 * operator reading a security record is never misled about which clock applies.
 */
export function formatAuditTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}:${ss} UTC`;
}

/**
 * The structured filter set. Deliberately has NO free-text field.
 *
 * Jean's decision (Flag B): the UUIDs are not a useful search target, so a
 * free-text box would be effort spent on the dimension admins are least likely
 * to use. Structured facets only.
 */
export interface AuditFilters {
  /** 'ALL', or an admin's user id. */
  adminUserId: string;
  /** 'ALL', or an exact action string. */
  action: string;
  /** 'ALL', or an exact affectedRecordType string. */
  recordType: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  adminUserId: 'ALL',
  action: 'ALL',
  recordType: 'ALL',
};

/**
 * The distinct values actually present in the loaded log, for the filter
 * controls.
 *
 * Derived FROM THE DATA rather than from a hardcoded list, so the facets can only
 * ever offer values that return rows — and so a new backend action appears as a
 * filter option the first time a row uses it. Ordered: admins by email, the rest
 * alphabetically.
 */
export function filterOptions(rows: ReadonlyArray<AuditLogRow>) {
  const admins = new Map<string, string>();
  const actions = new Set<string>();
  const recordTypes = new Set<string>();

  for (const row of rows) {
    if (row.adminUser?.id) admins.set(row.adminUser.id, row.adminUser.email);
    actions.add(row.action);
    recordTypes.add(row.affectedRecordType);
  }

  return {
    admins: [...admins.entries()]
      .map(([id, email]) => ({ id, email }))
      .sort((a, b) => a.email.localeCompare(b.email)),
    actions: [...actions].sort(),
    recordTypes: [...recordTypes].sort(),
  };
}

/** Apply the structured filters. Pure; the caller owns the loaded array. */
export function filterAuditLog(
  rows: ReadonlyArray<AuditLogRow>,
  filters: AuditFilters,
): AuditLogRow[] {
  return rows.filter((row) => {
    if (filters.adminUserId !== 'ALL' && row.adminUser?.id !== filters.adminUserId) return false;
    if (filters.action !== 'ALL' && row.action !== filters.action) return false;
    if (filters.recordType !== 'ALL' && row.affectedRecordType !== filters.recordType) return false;
    return true;
  });
}

/** True when any facet is narrowed. */
export function hasActiveAuditFilters(filters: AuditFilters): boolean {
  return (
    filters.adminUserId !== 'ALL' || filters.action !== 'ALL' || filters.recordType !== 'ALL'
  );
}

/**
 * The summary line.
 *
 * Says "shown", not "found", because the filtering is LOCAL over an already
 * complete fetch (the endpoint takes no parameters). Claiming a server "found N"
 * would describe a query that never happened — the same wording rule the
 * Appointments screen follows.
 */
export function auditSummary(
  shown: number,
  total: number,
  filters: AuditFilters,
): string {
  if (!hasActiveAuditFilters(filters)) {
    return `Showing all ${total} recorded entr${total === 1 ? 'y' : 'ies'}.`;
  }
  return `Showing ${shown} of ${total} recorded entr${total === 1 ? 'y' : 'ies'} (filtered locally).`;
}

/**
 * Newest-first ordering check.
 *
 * The server orders by timestamp desc. The client does NOT re-sort — re-sorting
 * would hide a server ordering regression behind a client fix. This helper
 * exists so the screen can assert the payload actually arrived in the order it
 * claims, and warn rather than silently repair if not.
 */
export function isNewestFirst(rows: ReadonlyArray<AuditLogRow>): boolean {
  for (let i = 1; i < rows.length; i++) {
    if (new Date(rows[i - 1].timestamp).getTime() < new Date(rows[i].timestamp).getTime()) {
      return false;
    }
  }
  return true;
}

/** True when the current user is looking at a log written entirely by others. */
export function distinctAdminCount(rows: ReadonlyArray<AuditLogRow>): number {
  return new Set(rows.map((r) => r.adminUser?.id).filter(Boolean)).size;
}
