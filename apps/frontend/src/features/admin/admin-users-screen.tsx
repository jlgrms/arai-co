import * as React from 'react';
import { Search, Users } from 'lucide-react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { fetchUsers, updateUserState } from './admin-api';
import { parseAdminError, type ParsedAdminError } from './admin-api-errors';
import {
  ACCOUNT_STATES,
  accountStateLabel,
  accountStateVariant,
  availableActions,
  confirmCopy,
  displayName,
  EMPTY_FILTERS,
  FILTERABLE_ROLES,
  hasActiveFilters,
  nextStateFor,
  resultSummary,
  roleDetail,
  roleLabel,
  secondaryLabel,
  summarizeStates,
  type AdminUser,
  type UserAction,
  type UserFilters,
} from './admin-user-types';

/**
 * Layer 8 sub-item 1 — Admin user management.
 *
 * `GET /admin/users` + `PATCH /admin/users/:id/state`, ADMIN-only.
 *
 * SEARCH IS SERVER-SIDE. `q` is matched by the backend against email and both
 * profile names (case-insensitive ILIKE), so this screen sends the query rather
 * than filtering the loaded array. Filtering client-side would silently only
 * search the rows already fetched — a subtle lie that looks like it works.
 *
 * ADMIN ACCOUNTS ARE NOT LISTED and not editable: listUsers() excludes them and
 * updateUserState() rejects them with 400. There is no client-side mirror of
 * that rule; the server is the authority, and its refusal is surfaced verbatim
 * if it ever happens.
 *
 * NO PAGINATION. The endpoint returns the whole result set. The account count is
 * small enough for that today (the seed baseline is 10), and inventing client
 * pagination over a full fetch would be fake. If the table grows, the fix is
 * server-side paging, not here.
 *
 * The reason field is OPTIONAL on the server (AuditLog.reason is nullable) but
 * is collected here, because the audit log is the point of the action: an
 * unexplained suspension is what an audit trail is supposed to prevent.
 */
export function AdminUsersScreen() {
  const [filters, setFilters] = React.useState<UserFilters>(EMPTY_FILTERS);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedAdminError | null>(null);

  // The typed query is deferred so a keystroke does not fire a request per
  // character; 300ms is below the threshold where a search feels laggy.
  const [debouncedQ, setDebouncedQ] = React.useState('');
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => window.clearTimeout(t);
  }, [filters.q]);

  const effectiveFilters = React.useMemo<UserFilters>(
    () => ({ ...filters, q: debouncedQ }),
    [filters, debouncedQ],
  );

  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchUsers(effectiveFilters, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setUsers(data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        setError(parseAdminError(err, 'Could not load accounts. Please try again.'));
        setUsers([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [effectiveFilters, reloadToken]);

  // The action awaiting confirmation, if any. Held as state rather than acted on
  // immediately so the dialog has something to describe.
  const [pending, setPending] = React.useState<{
    user: AdminUser;
    action: UserAction;
  } | null>(null);
  const [reason, setReason] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const applyAction = React.useCallback(
    async (target: AdminUser, action: UserAction, why: string) => {
      setBusyId(target.id);
      setActionError(null);
      try {
        const updated = await updateUserState(target.id, {
          accountState: nextStateFor(target.accountState, action),
          ...(why.trim() !== '' ? { reason: why.trim() } : {}),
        });
        // Patch in place rather than refetching: the list order is
        // createdAt desc and state does not affect it, so a refetch would only
        // add latency and risk a flicker.
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
        toast.success(`${displayName(updated)} — ${accountStateLabel(updated.accountState)}`);
      } catch (err: unknown) {
        // Kept inline (not only a toast) so the message survives the dismissal
        // of a toast and is still readable next to the row it concerns.
        setActionError(
          parseAdminError(err, 'Could not update this account. Please try again.').message,
        );
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  const onAction = React.useCallback(
    (target: AdminUser, action: UserAction) => {
      const option = availableActions(target.accountState).find((a) => a.action === action);
      if (option?.confirm) {
        setReason('');
        setPending({ user: target, action });
        return;
      }
      void applyAction(target, action, '');
    },
    [applyAction],
  );

  const summary = React.useMemo(() => summarizeStates(users), [users]);
  const filtered = hasActiveFilters(effectiveFilters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Search and manage patient and doctor accounts."
      />

      {/* Filters. Kept in a card so they read as one control group. */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="admin-user-search">Search</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="admin-user-search"
                className="pl-9"
                placeholder="Search by email or name"
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2 sm:w-40">
            <Label htmlFor="admin-user-role">Role</Label>
            <select
              id="admin-user-role"
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filters.role}
              onChange={(e) =>
                setFilters((f) => ({ ...f, role: e.target.value as UserFilters['role'] }))
              }
            >
              <option value="ALL">All roles</option>
              {FILTERABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 sm:w-44">
            <Label htmlFor="admin-user-state">Status</Label>
            <select
              id="admin-user-state"
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filters.accountState}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  accountState: e.target.value as UserFilters['accountState'],
                }))
              }
            >
              <option value="ALL">All statuses</option>
              {ACCOUNT_STATES.map((state) => (
                <option key={state} value={state}>
                  {accountStateLabel(state)}
                </option>
              ))}
            </select>
          </div>

          {filtered && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <Alert variant="destructive">
          <AlertTitle>Could not update that account</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>
                {error.isForbidden ? 'Not permitted' : "Couldn't load accounts"}
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
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? 'No accounts match those filters' : 'No accounts yet'}
          description={
            filtered
              ? 'Try a different search term, role, or status.'
              : 'Patient and doctor accounts will appear here once they register.'
          }
          action={
            filtered ? (
              <Button type="button" variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const secondary = secondaryLabel(user);
                  const detail = roleDetail(user);
                  const busy = busyId === user.id;
                  return (
                    <TableRow key={user.id} data-testid={`admin-user-row-${user.id}`}>
                      <TableCell>
                        <div className="space-y-0.5">
                          <div className="font-medium text-ink">{displayName(user)}</div>
                          {secondary && (
                            <div className="text-xs text-muted-foreground">{secondary}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <div className="text-sm text-ink">{roleLabel(user.role)}</div>
                          {detail && (
                            <div className="text-xs text-muted-foreground">{detail}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant={accountStateVariant(user.accountState)}>
                            {accountStateLabel(user.accountState)}
                          </Badge>
                          {/* The reason is shown inline: a suspended account
                              without its justification forces the admin to
                              cross-reference the audit log to understand it. */}
                          {user.stateReason && (
                            <div className="max-w-[16rem] text-xs text-muted-foreground">
                              {user.stateReason}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatRegistered(user.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {availableActions(user.accountState).map((option) => (
                            <Button
                              key={option.action}
                              type="button"
                              size="sm"
                              variant={option.variant}
                              disabled={busy}
                              onClick={() => onAction(user, option.action)}
                              data-testid={`admin-user-${option.action}-${user.id}`}
                            >
                              {busy ? 'Working…' : option.label}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!loading && !error && users.length > 0 && (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{resultSummary(users.length, effectiveFilters)}</p>
          {/* Counts describe the CURRENT filter, not the whole table, because
              the client only ever sees what it fetched. The wording says so. */}
          {filtered && (
            <p className="text-xs">
              Active {summary.ACTIVE} · Suspended {summary.SUSPENDED} · Deactivated{' '}
              {summary.DEACTIVATED} (within these results)
            </p>
          )}
        </div>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          {pending && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmCopy(pending.action, displayName(pending.user)).title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmCopy(pending.action, displayName(pending.user)).description}
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-2">
                <Label htmlFor="admin-user-reason">Reason (optional)</Label>
                <Input
                  id="admin-user-reason"
                  placeholder="e.g. Reported for abusive behaviour"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Recorded in the audit log against this account.
                </p>
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const target = pending;
                    setPending(null);
                    void applyAction(target.user, target.action, reason);
                  }}
                >
                  {confirmCopy(pending.action, displayName(pending.user)).confirmLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Registration date, rendered as a stable day-precision date.
 *
 * Day precision is deliberate: an admin is answering "when did this account
 * appear", and an exact time invites reading significance into it. Rendered in
 * the browser's locale, which is the only timezone the client actually knows.
 */
function formatRegistered(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
