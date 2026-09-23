import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarPlus } from 'lucide-react';

import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AppointmentStatusBadge,
  ConsultationStateBadge,
  CONSULTATION_STATE_META,
  type ConsultationState,
} from '@/components/ui/status-badge';
import { TintedIcon } from '@/components/ui/tinted-icon';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { parseBookingError, type ParsedBookingError } from './booking-api-errors';
import {
  formatAppointmentWhen,
  formatTime,
  groupSlotsByDay,
  isActionable,
  partitionAppointments,
  type Appointment,
  type AppointmentStatus,
  type DoctorWithSlots,
} from './booking-types';

function initialsFor(name: string): string {
  const parts = name
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '—';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Status badge for an appointment.
 *
 * Delegates to the shared StatusBadge, which pairs every tint with an icon —
 * v3 forbids colour as the sole carrier of state, and these four states are
 * exactly the kind of thing a patient needs to be able to tell apart at a
 * glance without relying on red/green discrimination.
 */
function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <AppointmentStatusBadge status={status} />;
}

/**
 * The most relevant upcoming appointment, surfaced as a banner above the list.
 *
 * WHY IT EXISTS: the list is a record; this is the answer to "what do I
 * actually need to do next". A patient opening this screen during a
 * consultation should not have to scan a list to find the join button.
 *
 * The banner's appearance is driven by the consultation session state when
 * there is one, because that is the finer-grained truth — an appointment can be
 * BOOKED while its session is JOINED or IN_PROGRESS. Where there is no session
 * yet, it falls back to the appointment status. Either way the tone comes from
 * the shared status maps, so this banner can never disagree with the badge on
 * the card below it.
 *
 * `now` is a parameter, not read from the clock inline, so the "soon" logic is
 * testable and does not change mid-render.
 */
function UpcomingBanner({ appointment, now }: { appointment: Appointment; now: number }) {
  const session = appointment.consultationSession;
  const startsAt = new Date(appointment.scheduledAt).getTime();
  const startsInMs = startsAt - now;
  // "Soon" = inside the next 48h. Beyond that the banner is informational only
  // and must not shout, or it competes with whatever the patient is doing now.
  const soon = startsInMs > 0 && startsInMs < 48 * 60 * 60 * 1000;
  const imminent = startsInMs > 0 && startsInMs < 60 * 60 * 1000;

  const state: ConsultationState = session?.state ?? 'SCHEDULED';
  const meta = CONSULTATION_STATE_META[state];

  // Tint the banner by state. Nothing here uses coral as a fill (v3 forbids it
  // as a large-section background); the coral is confined to the CTA button.
  const shell =
    state === 'IN_PROGRESS'
      ? 'border-green-text/30 bg-green-tint'
      : state === 'JOINED'
        ? 'border-blue/30 bg-blue/10'
        : 'border-border bg-surface';

  return (
    <section
      aria-labelledby="next-appointment-heading"
      className={cn('rounded-xl border p-5 sm:p-6', shell)}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <TintedIcon icon={meta.icon} tone={state === 'JOINED' ? 'blue' : 'mint'} size="lg" />
          <div className="min-w-0 space-y-1.5">
            <p
              id="next-appointment-heading"
              className="text-[11px] font-bold uppercase tracking-[0.13em] text-muted-foreground"
            >
              {state === 'IN_PROGRESS'
                ? 'Happening now'
                : state === 'JOINED'
                  ? 'Naghihintay si Doc'
                  : 'Next up'}
            </p>
            <p className="font-heading text-lg font-semibold leading-tight text-ink">
              {appointment.doctorProfile.name}
            </p>
            <p className="text-sm text-muted-foreground">
              {appointment.doctorProfile.specialization}
              {' · '}
              {formatAppointmentWhen(appointment.scheduledAt)}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <ConsultationStateBadge state={state} />
              {imminent && state === 'SCHEDULED' && (
                <span className="text-xs font-semibold text-danger-text">
                  Malapit na — prepare na.
                </span>
              )}
              {soon && !imminent && state === 'SCHEDULED' && (
                <span className="text-xs font-medium text-muted-foreground">
                  Malapit na ito.
                </span>
              )}
            </div>
          </div>
        </div>

        {appointment.consultationSession && isActionable(appointment.status) && (
          <Button type="button" variant="cta" asChild>
            <Link to={`/patient/consultations/${appointment.consultationSession.id}`}>
              {state === 'JOINED' || state === 'IN_PROGRESS' ? 'Balik sa room' : 'Join consultation'}
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}

function AppointmentCard({
  appointment,
  onCancel,
  onReschedule,
  busy,
}: {
  appointment: Appointment;
  onCancel: (appt: Appointment) => void;
  onReschedule: (appt: Appointment) => void;
  busy: boolean;
}) {
  const actionable = isActionable(appointment.status);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Avatar className="size-11">
            <AvatarFallback>{initialsFor(appointment.doctorProfile.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1">
            <p className="truncate font-heading text-base font-semibold text-ink">
              {appointment.doctorProfile.name}
            </p>
            <p className="text-sm text-muted-foreground">
              {appointment.doctorProfile.specialization}
            </p>
            <p className="text-sm font-medium text-ink">
              {formatAppointmentWhen(appointment.scheduledAt)}
            </p>
            <div className="pt-1">
              <StatusBadge status={appointment.status} />
            </div>
          </div>
        </div>

        {actionable && (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {/* Entry point into the consultation room (sub-item 5). The room is
                keyed by session id, which only appears on the row because the
                backend joins the session onto every appointment read. */}
            {appointment.consultationSession && (
              <Button type="button" variant="cta" size="sm" asChild>
                <Link to={`/patient/consultations/${appointment.consultationSession.id}`}>
                  Join consultation
                </Link>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onReschedule(appointment)}
            >
              Reschedule
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onCancel(appointment)}
              className="text-red-600 hover:text-red-700"
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Completed appointments still need a way back into the room, because
            that is where the notes and prescriptions live. The cancel/reschedule
            actions are correctly hidden for a finished consultation. */}
        {!actionable && appointment.consultationSession && (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to={`/patient/consultations/${appointment.consultationSession.id}`}>
                View summary
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-3 p-6">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
              <Skeleton className="h-5 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Reschedule picker — a dialog listing the SAME doctor's other bookable slots.
 *
 * Scoped to the one doctor deliberately: the backend rejects moving an
 * appointment to a different doctor (400), so offering other doctors here would
 * present an action that cannot succeed.
 */
function RescheduleDialog({
  appointment,
  open,
  onOpenChange,
  onDone,
}: {
  appointment: Appointment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [doctor, setDoctor] = React.useState<DoctorWithSlots | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<ParsedBookingError | null>(null);
  const [selectedSlotId, setSelectedSlotId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !appointment) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSelectedSlotId(null);
    void (async () => {
      try {
        const data = await api.get<DoctorWithSlots>(`/doctors/${appointment.doctorProfileId}`, {
          signal: controller.signal,
        });
        setDoctor(data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(parseBookingError(err));
        setDoctor(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, appointment]);

  // The appointment's CURRENT slot is still returned by the doctor endpoint if
  // nothing consumed it... but it IS consumed by this very appointment, so the
  // backend excludes it. Nothing to filter out here.
  const dayGroups = doctor ? groupSlotsByDay(doctor.availabilities) : [];

  async function handleConfirm() {
    if (!appointment || !selectedSlotId) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch<Appointment>(`/appointments/${appointment.id}/reschedule`, {
        availabilityId: selectedSlotId,
      });
      toast.success('Appointment rescheduled');
      onOpenChange(false);
      onDone();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.isUnauthorized) {
        setError(parseBookingError(err));
        return;
      }
      setError(parseBookingError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Reschedule appointment</AlertDialogTitle>
          <AlertDialogDescription>
            {appointment
              ? `Pick a new time with ${appointment.doctorProfile.name}. The current time is ${formatAppointmentWhen(appointment.scheduledAt)}.`
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-[50vh] space-y-5 overflow-y-auto">
          {error && (
            <Alert variant="destructive" data-testid="reschedule-error">
              <AlertTitle>
                {error.isConflict ? 'That time is no longer available' : 'Couldn\u2019t reschedule'}
              </AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="flex flex-wrap gap-2" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-20" />
              ))}
            </div>
          ) : dayGroups.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No other open times with this doctor right now.
            </p>
          ) : (
            dayGroups.map((group) => (
              <div key={group.key} className="space-y-2">
                <h4 className="font-heading text-sm font-semibold text-ink">{group.label}</h4>
                <ul className="flex flex-wrap gap-2">
                  {group.slots.map((slot) => {
                    const isSelected = slot.id === selectedSlotId;
                    return (
                      <li key={slot.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedSlotId(slot.id)}
                          aria-pressed={isSelected}
                          className={
                            isSelected
                              ? 'rounded-md border border-coral bg-coral px-3 py-2 text-sm font-medium text-white'
                              : 'rounded-md border border-input bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-coral hover:text-coral'
                          }
                        >
                          {formatTime(slot.startTime)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Keep current time</AlertDialogCancel>
          <AlertDialogAction
            disabled={!selectedSlotId || saving}
            onClick={(e) => {
              // Keep the dialog open while the request is in flight so a failure
              // can be shown in place; close explicitly on success.
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {saving ? 'Moving…' : 'Confirm new time'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Layer 6 sub-item 4 — the patient's appointments, with cancel and reschedule.
 *
 * Split into upcoming/past so the actionable list is short and the history is
 * clearly separated. Cancelling goes through a confirmation dialog because it is
 * destructive and frees the slot for someone else — an accidental tap should not
 * be able to do it.
 */
export function MyAppointmentsScreen() {
  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedBookingError | null>(null);

  const [pendingCancel, setPendingCancel] = React.useState<Appointment | null>(null);
  const [pendingReschedule, setPendingReschedule] = React.useState<Appointment | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<ParsedBookingError | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Appointment[]>('/appointments/me', { signal });
      setAppointments(data);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(parseBookingError(err));
      setAppointments([]);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function confirmCancel() {
    const target = pendingCancel;
    if (!target) return;
    setBusyId(target.id);
    setActionError(null);
    try {
      await api.patch<Appointment>(`/appointments/${target.id}/cancel`);
      toast.success('Appointment cancelled');
      setPendingCancel(null);
      await load();
    } catch (err: unknown) {
      setActionError(parseBookingError(err));
      setPendingCancel(null);
    } finally {
      setBusyId(null);
    }
  }

  const { upcoming, past } = partitionAppointments(appointments);
  // Read once per render rather than per-branch, so the banner's "soon"
  // thresholds cannot disagree with each other within one paint.
  const now = Date.now();
  const nextUp = upcoming[0] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My appointments"
        description="Your upcoming and past consultations."
      />

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="cta" asChild>
          <Link to="/patient/book">Book an appointment</Link>
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link to="/patient/discover">Find a doctor</Link>
        </Button>
      </div>

      {actionError && (
        <Alert variant="destructive" data-testid="action-error">
          <AlertTitle>Couldn&apos;t complete that</AlertTitle>
          <AlertDescription>{actionError.message}</AlertDescription>
        </Alert>
      )}

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Couldn&apos;t load your appointments</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
            {error.retryable && (
              <Button type="button" onClick={() => void load()}>
                Try again
              </Button>
            )}
          </CardContent>
        </Card>
      ) : loading ? (
        <ListSkeleton />
      ) : appointments.length === 0 ? (
        <EmptyState
          icon={CalendarPlus}
          eyebrow="Wala pang booking"
          title="Wala ka pang appointment"
          description="When you book a consultation it will appear here, kasama na ang notes at prescriptions from it. Tara, mag-book na tayo?"
          action={
            <Button type="button" variant="cta" asChild>
              <Link to="/patient/book">Book your first appointment</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-8" aria-live="polite">
          {/* The single most relevant upcoming appointment, promoted out of the
              list. Hidden when the patient has nothing scheduled, so the
              "Nothing scheduled" line below is not contradicted by a banner. */}
          {nextUp && <UpcomingBanner appointment={nextUp} now={now} />}

          <section className="space-y-4">
            <h2 className="font-heading text-lg font-semibold text-ink">Upcoming</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-4">
                {upcoming.map((appt) => (
                  <li key={appt.id}>
                    <AppointmentCard
                      appointment={appt}
                      onCancel={setPendingCancel}
                      onReschedule={setPendingReschedule}
                      busy={busyId === appt.id}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {past.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-heading text-lg font-semibold text-ink">Past &amp; cancelled</h2>
              <ul className="space-y-4">
                {past.map((appt) => (
                  <li key={appt.id}>
                    <AppointmentCard
                      appointment={appt}
                      onCancel={setPendingCancel}
                      onReschedule={setPendingReschedule}
                      busy={busyId === appt.id}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Cancel confirmation — destructive and irreversible, so it is explicit. */}
      <AlertDialog open={pendingCancel !== null} onOpenChange={(o) => !o && setPendingCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCancel
                ? `Your appointment with ${pendingCancel.doctorProfile.name} on ${formatAppointmentWhen(pendingCancel.scheduledAt)} will be cancelled and the time released for other patients. This cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep appointment</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmCancel();
              }}
            >
              Yes, cancel it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RescheduleDialog
        appointment={pendingReschedule}
        open={pendingReschedule !== null}
        onOpenChange={(o) => !o && setPendingReschedule(null)}
        onDone={() => void load()}
      />
    </div>
  );
}
