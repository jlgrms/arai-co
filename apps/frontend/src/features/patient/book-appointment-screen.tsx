import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarClock, CalendarX2 } from 'lucide-react';

import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { JourneyProgress } from '@/components/ui/journey-progress';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { BookingConfirmed } from './booking-confirmed';
import { parseBookingError, type ParsedBookingError } from './booking-api-errors';
import {
  BOOKING_STEPS,
  CONFIRMED_STEP,
  formatTime,
  groupSlotsByDay,
  SCHEDULE_STEP,
  type Appointment,
  type DoctorWithSlots,
} from './booking-types';

/** Initials for the avatar fallback — mirrors the discovery screen's rule. */
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

function SlotPickerSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g} className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-20" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Layer 6 sub-item 4 — Book an appointment with a specific doctor.
 *
 * Reached from the doctor's card ("View availability" / "Select doctor"). The
 * doctor's id comes from the URL so the screen is linkable and refreshable.
 *
 * Slots are rendered pre-filtered by the backend (unblocked, future, unconsumed),
 * grouped by day. Selection is local state; the actual booking is a POST whose
 * conflicts are surfaced from the server's 409 rather than predicted here — the
 * check has to be atomic with the write, and a prediction could be stale.
 */
export function BookAppointmentScreen() {
  const { doctorId = '' } = useParams<{ doctorId: string }>();

  const [doctor, setDoctor] = React.useState<DoctorWithSlots | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<ParsedBookingError | null>(null);

  const [selectedSlotId, setSelectedSlotId] = React.useState<string | null>(null);
  const [booking, setBooking] = React.useState(false);
  const [bookError, setBookError] = React.useState<ParsedBookingError | null>(null);

  /**
   * Set once the POST succeeds. While present, the screen renders the
   * confirmation instead of the picker — this is the third step of the booking
   * journey, not a separate route, so the patient keeps their place in the
   * flow and "Book another time" can return them to the picker without a
   * round trip.
   */
  const [confirmed, setConfirmed] = React.useState<Appointment | null>(null);

  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await api.get<DoctorWithSlots>(`/doctors/${doctorId}`, { signal });
        setDoctor(data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError(parseBookingError(err));
        setDoctor(null);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [doctorId],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function handleBook() {
    if (!selectedSlotId) return;
    setBooking(true);
    setBookError(null);
    try {
      const appointment = await api.post<Appointment>('/appointments', {
        availabilityId: selectedSlotId,
      });
      // Success now shows a CONFIRMATION step rather than navigating straight to
      // the list. Booking is consequential and irreversible, and the old
      // behaviour acknowledged it only by making a list one row longer. The
      // response is kept so the confirmation can state the exact recorded time.
      setConfirmed(appointment);
      toast.success('Appointment booked', {
        description: 'Naka-book na — kita-kita tayo.',
      });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.isUnauthorized) {
        setBookError(parseBookingError(err));
        return;
      }
      setBookError(parseBookingError(err));
    } finally {
      setBooking(false);
    }
  }

  const dayGroups = doctor ? groupSlotsByDay(doctor.availabilities) : [];
  const hasSlots = dayGroups.length > 0;

  // ---- Step 3: confirmed ----------------------------------------------------
  // Rendered from the POST response, so nothing here is re-derived or guessed.
  // "Book another time" clears it and drops back to the picker with the same
  // doctor, which is the only sensible next move from here.
  if (confirmed) {
    return (
      <div className="space-y-6">
        <PageHeader title="Booking confirmed" description="You're all set." />
        <JourneyProgress steps={[...BOOKING_STEPS]} current={CONFIRMED_STEP} />
        <BookingConfirmed appointment={confirmed} onDone={() => setConfirmed(null)} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Book appointment" description="Choose a time that works for you." />
        <JourneyProgress steps={[...BOOKING_STEPS]} current={SCHEDULE_STEP} />
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          </CardContent>
        </Card>
        <SlotPickerSkeleton />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Book appointment" description="Choose a time that works for you." />
        <JourneyProgress steps={[...BOOKING_STEPS]} current={SCHEDULE_STEP} />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Couldn&apos;t load this doctor</AlertTitle>
              <AlertDescription>{loadError.message}</AlertDescription>
            </Alert>
            {loadError.retryable && (
              <Button type="button" onClick={() => void load()}>
                Try again
              </Button>
            )}
            <Button type="button" variant="outline" asChild>
              <Link to="/patient/discover">Back to doctors</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Book appointment"
        description="Choose a time that works for you."
      />

      {/* The patient is on the last step: the doctor is chosen (that is how
          they got here) and only the time is outstanding. */}
      <JourneyProgress steps={[...BOOKING_STEPS]} current={SCHEDULE_STEP} />

      {doctor && (
        <Card>
          <CardContent className="flex items-start gap-3 p-6">
            <Avatar className="size-12">
              <AvatarFallback>{initialsFor(doctor.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="truncate font-heading text-base font-semibold text-ink">{doctor.name}</p>
              </div>
              <Badge variant="secondary">{doctor.specialization}</Badge>
              {doctor.biography && (
                <p className="pt-1 text-sm text-muted-foreground">{doctor.biography}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {bookError && (
        <Alert variant="destructive" data-testid="booking-error">
          <AlertTitle>
            {bookError.isConflict ? 'That time is no longer available' : 'Couldn\u2019t book'}
          </AlertTitle>
          <AlertDescription>
            {bookError.message}
            {bookError.isConflict && ' Please choose a different time below.'}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-6 p-6">
          <h2 className="font-heading text-base font-semibold text-ink">Available times</h2>

          {!hasSlots ? (
            <EmptyState
              icon={CalendarX2}
              tone="yellow"
              eyebrow="Puno ang schedule"
              title="No open times right now"
              description={`${doctor?.name ?? 'This doctor'} has no bookable slots at the moment. Their availability may change soon, or you can book with another doctor.`}
              action={
                <Button type="button" variant="outline" asChild>
                  <Link to="/patient/discover">Browse other doctors</Link>
                </Button>
              }
            />
          ) : (
            <>
              {dayGroups.map((group) => (
                <div key={group.key} className="space-y-3">
                  <h3 className="font-heading text-sm font-semibold text-ink">{group.label}</h3>
                  <ul className="flex flex-wrap gap-2">
                    {group.slots.map((slot) => {
                      const isSelected = slot.id === selectedSlotId;
                      return (
                        <li key={slot.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedSlotId(slot.id)}
                            aria-pressed={isSelected}
                            className={cn(
                              'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                              isSelected
                                ? 'border-ink bg-ink text-white'
                                : 'border-border bg-surface text-ink hover:border-accent hover:bg-green-tint/40',
                            )}
                          >
                            {formatTime(slot.startTime)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
                <Button
                  type="button"
                  variant="cta"
                  onClick={() => void handleBook()}
                  disabled={!selectedSlotId || booking}
                >
                  {booking ? 'Booking…' : 'Confirm booking'}
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link to="/patient/discover">Cancel</Link>
                </Button>
                {!selectedSlotId && (
                  <p className="text-sm text-muted-foreground">Pick a time to continue.</p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
