import * as React from 'react';
import { AlertTriangle, CalendarClock, Search } from 'lucide-react';
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
import { formatAppointmentWhen } from '@/features/patient/booking-types';
import { fetchAdminAppointments, cancelAdminAppointment } from './admin-api';
import { parseAdminError, type ParsedAdminError } from './admin-api-errors';
import {
  APPOINTMENT_STATUSES,
  appointmentStatusLabel,
  appointmentStatusVariant,
  buildCancelBody,
  canAdminCancel,
  cancelConfirmCopy,
  countIncoherent,
  EMPTY_FILTERS,
  filterAppointments,
  hasActiveFilters,
  isIncoherent,
  mergeCancelledAppointment,
  profileName,
  resultSummary,
  sessionStateLabel,
  sessionStateVariant,
  slotReleased,
  summarizeStatus,
  type AdminAppointment,
  type AppointmentFilters,
} from './admin-appointment-types';

/**
 * Layer 8 sub-item 3 — Admin appointment oversight.
 *
 * `GET /admin/appointments` + `POST /admin/appointments/:id/cancel`, ADMIN-only.
 * Both routes pre-exist from Layer 4 sub-item 9; this screen adds no backend.
 *
 * THE CANCEL HERE IS THE ADMIN OVERRIDE, not the patient action. It has no
 * ownership gate, so it works on any row — deliberately. But the UI still only
 * OFFERS it on live rows (BOOKED/RESCHEDULED): the endpoint returns an
 * already-cancelled row unchanged with NO second audit entry, so offering it on
 * a CANCELLED row would suggest an action that leaves no trace. Same convention
 * as sub-items 1 & 2 (omit the impossible action rather than let the server no-op
 * it). See canAdminCancel.
 *
 * FILTERING IS CLIENT-SIDE, and that is a deliberate divergence from sub-items 1
 * & 2. The endpoint accepts NO query parameters at all (no search, no status, no
 * pagination) — so a "server-side search" here would be an illusion. This narrows
 * the fetched array locally and the summary line says "shown", not "found".
 *
 * TWO COLUMNS, TWO TABLES. `status` (Appointment) and session `state`
 * (ConsultationSession) are separate rows in separate tables written by separate
 * flows, so they can contradict each other. The screen renders both RAW and adds
 * a warning treatment ONLY for the genuinely impossible pairs (see isIncoherent)
 * — it never rewrites or hides a contradiction, because an operator seeing one is
 * the whole point. COMPLETED + COMPLETED is the healthy end state and is left
 * alone.
 */
export function AdminAppointmentsScreen() {
  const [filters, setFilters] = React.useState<AppointmentFilters>(EMPTY_FILTERS);
  const [appointments, setAppointments] = React.useState<AdminAppointment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedAdminError | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchAdminAppointments(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setAppointments(data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        setError(
          parseAdminError(err, 'Could not load appointments. Please try again.'),
        );
        setAppointments([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken]);

  const [pendingCancel, setPendingCancel] = React.useState<AdminAppointment | null>(null);
  const [reason, setReason] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Cancel one row, then MERGE the server's answer back into THAT row.
  //
  // MERGE, do not replace. The cancel response is the raw Appointment row with
  // NO relations (see CancelledAppointmentRow) — swapping it in wholesale drops
  // patientProfile / doctorProfile / consultationSession, and the next render
  // throws reading `consultationSession.state`: a whitescreen on a SUCCESSFUL
  // cancel. mergeCancelledAppointment folds in only the scalars that can change.
  //
  // No refetch: the list is ordered by scheduledAt desc and a cancellation does
  // not move the appointment in time, so a refetch would only add latency.
  const submitCancel = React.useCallback(
    async (target: AdminAppointment, reasonText: string) => {
      setBusyId(target.id);
      setActionError(null);
      try {
        const updated = await cancelAdminAppointment(target.id, buildCancelBody(reasonText));
        setAppointments((prev) =>
          prev.map((a) => (a.id === updated.id ? mergeCancelledAppointment(a, updated) : a)),
        );
        toast.success('Appointment cancelled', {
          description: 'Both parties were notified and the slot is available again.',
        });
        return true;
      } catch (err: unknown) {
        setActionError(
          parseAdminError(err, 'Could not cancel this appointment. Please try again.').message,
        );
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  const visible = React.useMemo(
    () => filterAppointments(appointments, filters),
    [appointments, filters],
  );
  const summary = React.useMemo(() => summarizeStatus(appointments), [appointments]);
  const incoherentCount = React.useMemo(() => countIncoherent(appointments), [appointments]);
  const filtered = hasActiveFilters(filters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments"
        description="Every appointment across the platform, with its consultation state."
      />

      {/* Filters. Kept in a card so they read as one control group. */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="admin-appointment-search">Search</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="admin-appointment-search"
                className="pl-9"
                placeholder="Search by patient, doctor, or specialization"
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2 sm:w-48">
            <Label htmlFor="admin-appointment-status">Status</Label>
            <select
              id="admin-appointment-status"
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  status: e.target.value as AppointmentFilters['status'],
                }))
              }
            >
              <option value="ALL">All statuses</option>
              {APPOINTMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {appointmentStatusLabel(status)}
                </option>
              ))}
            </select>
          </div>

          {filtered && (
            <Button type="button" variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Coherence banner. Deliberately loud but non-blocking: the rows are still
          shown and still cancelable — an operator seeing the contradiction is the
          point, not having it hidden from them. */}
      {!loading && !error && incoherentCount > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>
            {incoherentCount === 1
              ? '1 appointment has a contradictory consultation state'
              : `${incoherentCount} appointments have a contradictory consultation state`}
          </AlertTitle>
          <AlertDescription>
            These are highlighted below. A live consultation on a cancelled or completed
            appointment usually means a session was not closed out — it is a data problem,
            not an action to take here.
          </AlertDescription>
        </Alert>
      )}

      {actionError && (
        <Alert variant="destructive">
          <AlertTitle>Could not cancel that appointment</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>
                {error.isForbidden ? 'Not permitted' : "Couldn't load appointments"}
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
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : appointments.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No appointments yet"
          description="Appointments appear here as patients book with doctors."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No appointments match those filters"
          description="Try a different search term or status."
          action={
            <Button type="button" variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
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
                  <TableHead>Patient</TableHead>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Appointment</TableHead>
                  <TableHead>Consultation</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((appointment) => {
                  const busy = busyId === appointment.id;
                  const incoherent =
                    appointment.consultationSession !== null &&
                    isIncoherent(appointment.status, appointment.consultationSession.state);
                  return (
                    <TableRow
                      key={appointment.id}
                      data-testid={`admin-appointment-row-${appointment.id}`}
                      className={incoherent ? 'bg-danger-text/5' : undefined}
                    >
                      <TableCell className="whitespace-nowrap text-sm text-ink">
                        {formatAppointmentWhen(appointment.scheduledAt)}
                      </TableCell>
                      <TableCell className="text-sm text-ink">
                        {profileName(appointment.patientProfile, 'The patient')}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <div className="text-sm text-ink">
                            {profileName(appointment.doctorProfile, 'The doctor')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {appointment.doctorProfile.specialization}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={appointmentStatusVariant(appointment.status)}>
                            {appointmentStatusLabel(appointment.status)}
                          </Badge>
                          {/* The slot is released when the FK is nulled by a
                              cancellation. Shown for cancelled rows because that
                              is where an operator wants to confirm the slot came
                              back — and it is the server's own field, not a
                              client-side guess. */}
                          {appointment.status === 'CANCELLED' &&
                            slotReleased(appointment) && (
                              <span className="text-xs text-muted-foreground">Slot released</span>
                            )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          {appointment.consultationSession ? (
                            <>
                              <Badge
                                variant={sessionStateVariant(
                                  appointment.consultationSession.state,
                                )}
                              >
                                {sessionStateLabel(appointment.consultationSession.state)}
                              </Badge>
                              {incoherent && (
                                <span className="flex items-center gap-1 text-xs font-medium text-danger-text">
                                  <AlertTriangle className="size-3" aria-hidden />
                                  Contradicts status
                                </span>
                              )}
                            </>
                          ) : (
                            // No session row: an appointment that never produced a
                            // consultation. Rendered as an explicit em-dash rather
                            // than a blank cell so it reads as "none", not "failed
                            // to load".
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          {canAdminCancel(appointment.status) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={busy}
                              onClick={() => {
                                setReason('');
                                setPendingCancel(appointment);
                              }}
                              data-testid={`admin-appointment-cancel-${appointment.id}`}
                            >
                              {busy ? 'Cancelling…' : 'Cancel'}
                            </Button>
                          ) : (
                            // No action offered on a terminal row: the server
                            // would no-op a re-cancel and write no audit entry.
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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

      {!loading && !error && appointments.length > 0 && (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{resultSummary(visible.length, filters)}</p>
          {/* Counts describe the WHOLE set (the filter is a local narrowing), so
              the wording does not imply a server query. */}
          {!filtered && (
            <p className="text-xs">
              Scheduled {summary.BOOKED} · Rescheduled {summary.RESCHEDULED} · Cancelled{' '}
              {summary.CANCELLED} · Completed {summary.COMPLETED}
            </p>
          )}
        </div>
      )}

      <AlertDialog
        open={pendingCancel !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCancel(null);
        }}
      >
        <AlertDialogContent>
          {pendingCancel && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{cancelConfirmCopy(pendingCancel).title}</AlertDialogTitle>
                <AlertDialogDescription>
                  {cancelConfirmCopy(pendingCancel).description}
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-2">
                <Label htmlFor="admin-appointment-reason">Reason (optional)</Label>
                <Input
                  id="admin-appointment-reason"
                  placeholder="e.g. Doctor unavailable"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Recorded in the audit log against this appointment.
                </p>
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>Keep appointment</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const target = pendingCancel;
                    setPendingCancel(null);
                    void submitCancel(target, reason);
                  }}
                  data-testid="admin-appointment-confirm-cancel"
                >
                  {cancelConfirmCopy(pendingCancel).confirmLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
