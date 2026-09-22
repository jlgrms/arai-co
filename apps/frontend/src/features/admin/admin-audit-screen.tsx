import * as React from 'react';
import { AlertTriangle, ScrollText } from 'lucide-react';

import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fetchAuditLogs } from './admin-api';
import { parseAdminError, type ParsedAdminError } from './admin-api-errors';
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
  isNewestFirst,
  reasonText,
  recordTypeLabel,
  type AuditFilters,
  type AuditLogRow,
} from './admin-audit-types';

/**
 * Layer 8 sub-item 5 — Admin audit log.
 *
 * `GET /admin/audit-logs`, ADMIN-only. The route pre-exists from Layer 4
 * sub-item 9; this screen adds no backend.
 *
 * THIS IS AN APPEND-ONLY HISTORICAL RECORD, not a list of live entities. Two
 * things follow, and both are the opposite of how the other four admin screens
 * behave:
 *
 *  1. NOTHING HERE LINKS TO A RECORD. `affectedRecordId` is a UUID pointing at
 *     something that may since have been deleted — 9 APPOINTMENT rows already
 *     reference appointments removed by harness cleanup, and 4 DOCTOR_PROFILE
 *     rows reference the sub-item 2 fixture doctor that was deleted on purpose.
 *     Rendering a link would present a dead end as navigation, so the id is
 *     PLAIN TEXT (Flag A).
 *  2. NOTHING HERE IS REDACTED. 23 of the 44 rows carry no reason; a blank
 *     Reason cell would read as a failed render, so absent values render as an
 *     em-dash. The reason itself is always shown verbatim (Flag C) — the log's
 *     job is to be complete.
 *
 * ACTIONS ARE NOT AN ENUM. `action` and `affectedRecordType` are free-form
 * Strings in the schema, so both render through a label map that FALLS BACK to
 * the raw stored string. A row written by a future backend action appears here
 * immediately, with its real value, rather than being hidden behind "Unknown" or
 * dropped. The filter facets are likewise derived from the loaded data, so they
 * can only ever offer values that exist.
 *
 * FILTERING IS LOCAL (Flag B). The endpoint takes no parameters, so the screen
 * narrows the fetched array and the summary says "shown", not "found". There is
 * deliberately NO free-text box: the id column is UUIDs, which are not a useful
 * search target, and a search over them would be effort spent on the dimension an
 * admin is least likely to use. Three structured facets only.
 *
 * Timestamps render in UTC — the known gap recorded as DEFERRED.md item 4.
 */
export function AdminAuditScreen() {
  const [rows, setRows] = React.useState<AuditLogRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedAdminError | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [filters, setFilters] = React.useState<AuditFilters>(EMPTY_AUDIT_FILTERS);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchAuditLogs(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setRows(data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        setError(parseAdminError(err, 'Could not load the audit log. Please try again.'));
        setRows([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken]);

  const options = React.useMemo(() => filterOptions(rows), [rows]);
  const visible = React.useMemo(() => filterAuditLog(rows, filters), [rows, filters]);
  const filtered = hasActiveAuditFilters(filters);

  // The server promises newest-first. Do NOT re-sort to fix it — surface it, so
  // an ordering regression is visible rather than silently corrected.
  const ordered = React.useMemo(() => isNewestFirst(rows), [rows]);

  // Facets are derived from the DATA, so a filter can only offer a value that
  // exists. If the log is refetched and an admin no longer appears, a stale
  // selection would silently narrow to nothing — reset it instead.
  React.useEffect(() => {
    setFilters((current) => {
      const next = { ...current };
      let changed = false;
      if (current.adminUserId !== 'ALL' && !options.admins.some((a) => a.id === current.adminUserId)) {
        next.adminUserId = 'ALL';
        changed = true;
      }
      if (current.action !== 'ALL' && !options.actions.includes(current.action)) {
        next.action = 'ALL';
        changed = true;
      }
      if (
        current.recordType !== 'ALL' &&
        !options.recordTypes.includes(current.recordType)
      ) {
        next.recordType = 'ALL';
        changed = true;
      }
      return changed ? next : current;
    });
  }, [options]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Every administrative action, newest first. Append-only: entries are never edited or removed."
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => setReloadToken((n) => n + 1)}
          >
            Refresh
          </Button>
        }
      />

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>
                {error.isForbidden ? 'Not permitted' : "Couldn't load the audit log"}
              </AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
            <Button type="button" variant="outline" onClick={() => setReloadToken((n) => n + 1)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No recorded actions yet"
          description="Administrative actions — approving a doctor, changing a user's state, cancelling an appointment — appear here as they happen."
        />
      ) : (
        <>
          {/* Ordering banner. Only shown when the payload actually disagrees with
              the documented contract, so it is a real signal rather than
              decoration. */}
          {!ordered && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden />
              <AlertTitle>Entries are not in newest-first order</AlertTitle>
              <AlertDescription>
                The server orders this log by timestamp descending. The order below was left
                as received rather than silently corrected, so this indicates a server-side
                ordering problem worth investigating.
              </AlertDescription>
            </Alert>
          )}

          {/* Structured facets only — no free-text (Flag B). Kept in a card so
              they read as one control group. */}
          <Card>
            <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="audit-filter-admin">Administrator</Label>
                <select
                  id="audit-filter-admin"
                  className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={filters.adminUserId}
                  onChange={(e) => setFilters((f) => ({ ...f, adminUserId: e.target.value }))}
                >
                  <option value="ALL">All administrators</option>
                  {options.admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 sm:w-56">
                <Label htmlFor="audit-filter-action">Action</Label>
                <select
                  id="audit-filter-action"
                  className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={filters.action}
                  onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
                >
                  <option value="ALL">All actions</option>
                  {options.actions.map((action) => (
                    <option key={action} value={action}>
                      {actionLabel(action)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 sm:w-48">
                <Label htmlFor="audit-filter-record-type">Record type</Label>
                <select
                  id="audit-filter-record-type"
                  className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={filters.recordType}
                  onChange={(e) => setFilters((f) => ({ ...f, recordType: e.target.value }))}
                >
                  <option value="ALL">All types</option>
                  {options.recordTypes.map((type) => (
                    <option key={type} value={type}>
                      {recordTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </div>

              {filtered && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFilters(EMPTY_AUDIT_FILTERS)}
                >
                  Clear
                </Button>
              )}
            </CardContent>
          </Card>

          {visible.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No entries match those filters"
              description="Try a different administrator, action, or record type."
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFilters(EMPTY_AUDIT_FILTERS)}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Administrator</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Record</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((row) => (
                      <TableRow key={row.id} data-testid={`admin-audit-row-${row.id}`}>
                        <TableCell className="whitespace-nowrap text-sm text-ink">
                          {formatAuditTimestamp(row.timestamp)}
                        </TableCell>
                        <TableCell className="text-sm text-ink">{adminText(row)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-sm text-ink">{actionLabel(row.action)}</span>
                            {/* The RAW stored action, always visible. Jean's
                                decision (Flag D): a human label alone would hide
                                what was actually written to the table, and this
                                is a technical record. */}
                            <span className="font-mono text-xs text-muted-foreground">
                              {row.action}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant="outline">{recordTypeLabel(row.affectedRecordType)}</Badge>
                            {/* PLAIN TEXT, never a link (Flag A). The id may point
                                at a record that no longer exists, and a dead link
                                presented as navigation is worse than no link. */}
                            <span className="font-mono text-xs text-muted-foreground">
                              {affectedRecordText(row)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs text-sm text-ink">
                          <span
                            className={
                              row.reason?.trim() ? undefined : 'text-muted-foreground'
                            }
                          >
                            {reasonText(row)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{auditSummary(visible.length, rows.length, filters)}</p>
            {/* Counts describe the WHOLE loaded log, so they are not shown when a
                filter is active (they would describe a different set to the one
                on screen). */}
            {!filtered && (
              <p className="text-xs">
                {distinctAdminCount(rows) === 1
                  ? '1 administrator has acted'
                  : `${distinctAdminCount(rows)} administrators have acted`}{' '}
                · times shown in UTC
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
