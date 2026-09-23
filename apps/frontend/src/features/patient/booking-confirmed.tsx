import { Link } from 'react-router-dom';
import { CalendarCheck, CheckCircle2, MessageSquareText, Video } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConsultationStateBadge } from '@/components/ui/status-badge';
import { TintedIcon } from '@/components/ui/tinted-icon';
import { formatAppointmentWhen, type Appointment } from './booking-types';

/**
 * The booking confirmation moment.
 *
 * WHY THIS EXISTS: booking used to POST and then silently `navigate` to the
 * appointments list. The patient got no acknowledgement of a consequential,
 * irreversible action — they were left to infer success from a list now
 * containing one more row. This gives the moment its own screen.
 *
 * It is deliberately a SCREEN and not a toast. A toast is right for a
 * lightweight success (v3: "toasts for lightweight success; dialogs for
 * consequential confirmation"); booking a medical appointment is consequential,
 * and the patient needs the time and the next step in front of them, not
 * scrolling past in the corner.
 *
 * Everything it shows comes from the POST response, so the particulars can
 * never disagree with what the server actually recorded. No re-fetch.
 */
export function BookingConfirmed({
  appointment,
  onDone,
}: {
  appointment: Appointment;
  /** Clears the confirmation and returns to the slot picker. */
  onDone: () => void;
}) {
  const doctor = appointment.doctorProfile;
  const session = appointment.consultationSession;

  return (
    <div className="space-y-6">
      {/* The one dominant card on this screen (v3: one visually dominant card
          per screen). Mint — the reassuring supporting tint — never coral,
          which v3 forbids as a large-section background. */}
      <Card className="overflow-hidden">
        {/* A tinted header band rather than a full tinted card, so the coral
            CTA below still reads as the primary action. */}
        <div className="border-b border-green-text/20 bg-green-tint px-6 py-8 text-center sm:px-10 sm:py-10">
          <span className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-surface shadow-small">
            <CheckCircle2 className="size-8 text-green-text" strokeWidth={2.5} aria-hidden />
          </span>
          <h2 className="font-heading text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
            Naka-book na. Kita tayo!
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Your consultation is confirmed for{' '}
            <span className="font-semibold text-ink">
              {formatAppointmentWhen(appointment.scheduledAt)}
            </span>
            .
          </p>
        </div>

        <CardContent className="space-y-5 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <TintedIcon icon={CalendarCheck} tone="yellow" size="lg" />
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
                Your doctor
              </p>
              <p className="font-heading text-lg font-semibold text-ink">{doctor.name}</p>
              <p className="text-sm text-muted-foreground">{doctor.specialization}</p>
            </div>
          </div>

          {session && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-page px-4 py-3">
              <span className="text-sm text-muted-foreground">Room status</span>
              <ConsultationStateBadge state={session.state} className="ml-auto" />
            </div>
          )}

          {/* "What happens next" — the patient has just committed; the useful
              thing is not to celebrate but to tell them the next step. */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <TintedIcon icon={Video} tone="blue" size="sm" />
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-ink">Join from your appointments.</span>{' '}
                Your consultation room opens from the{' '}
                <span className="font-medium text-ink">My appointments</span> page. Balik ka
                a few minutes early.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <TintedIcon icon={MessageSquareText} tone="mint" size="sm" />
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-ink">Notes come after.</span> Findings and
                any prescriptions appear in your medical records once the consultation is
                completed.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-border pt-5">
            <Button type="button" variant="cta" asChild>
              <Link to="/patient/appointments">View my appointments</Link>
            </Button>
            <Button type="button" variant="outline" onClick={onDone}>
              Book another time
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Need to change this? You can reschedule or cancel from{' '}
        <Link to="/patient/appointments" className="underline underline-offset-4 hover:text-ink">
          My appointments
        </Link>
        .
      </p>
    </div>
  );
}
