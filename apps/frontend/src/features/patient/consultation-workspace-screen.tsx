import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CheckCircle2,
  CircleDashed,
  FileText,
  Hourglass,
  MessageSquareText,
  Video,
  type LucideIcon,
} from 'lucide-react';

import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JitsiCall } from '@/components/ui/jitsi-call';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ConsultationStateBadge } from '@/components/ui/status-badge';
import { TintedIcon } from '@/components/ui/tinted-icon';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { parseBookingError, type ParsedBookingError } from './booking-api-errors';
import { formatAppointmentWhen } from './booking-types';
import {
  canOfferJoin,
  canPatientReadRecords,
  hasNoRecords,
  isWaitingForDoctor,
  presenceOf,
  stateHint,
  stateLabel,
  type ConsultationRecords,
  type ConsultationSession,
  type ConsultationState,
} from './consultation-types';

/**
 * Icon for a session state, mirroring CONSULTATION_STATE_META's glyph choices so
 * the big status mark and the badge next to it never disagree. `JOINED` is
 * handled by the caller (it renders as the waiting mark instead).
 */
function stateIconFor(state: ConsultationState): LucideIcon {
  switch (state) {
    case 'IN_PROGRESS':
      return Video;
    case 'COMPLETED':
      return CheckCircle2;
    case 'JOINED':
      return Hourglass;
    default:
      return CircleDashed;
  }
}

/**
 * One participant's presence. The dot is the at-a-glance channel and the label
 * is the explicit one — v3 forbids colour being the only carrier, so a present
 * participant is never communicated by green alone.
 */
function PresenceRow({
  role,
  present,
  presentLabel,
  absentLabel,
  waiting = false,
}: {
  role: string;
  present: boolean;
  presentLabel: string;
  absentLabel: string;
  /** Marks the doctor's row while the patient is waiting — softens it to amber. */
  waiting?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <span
        aria-hidden
        className={cn(
          'size-2.5 shrink-0 rounded-full',
          present ? 'bg-green-text' : waiting ? 'bg-yellow' : 'bg-border',
        )}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{role}</p>
        <p className="text-sm text-muted-foreground">{present ? presentLabel : absentLabel}</p>
      </div>
    </div>
  );
}

/**
 * Layer 6 sub-item 5 — Consultation workspace, PATIENT side.
 *
 * The patient's room for one consultation session. Three things drive the whole
 * screen: the session state, who is present, and whether records are readable.
 * The doctor side of the workspace (notes/prescription entry, completing the
 * session) is Layer 7 sub-item 4 and is deliberately absent here.
 *
 * The constraint that shapes this UI: the patient CANNOT finish the
 * consultation. Completing is doctor-only, and IN_PROGRESS additionally needs
 * both participants present — so a patient alone in a room is correctly stuck
 * at "waiting for your doctor". That is the common case, so it is presented as
 * a calm, explained waiting state rather than a failure or a dead button.
 */
export function ConsultationWorkspaceScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();

  const [session, setSession] = React.useState<ConsultationSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedBookingError | null>(null);
  const [joining, setJoining] = React.useState(false);
  const [joinError, setJoinError] = React.useState<ParsedBookingError | null>(null);

  const [records, setRecords] = React.useState<ConsultationRecords | null>(null);
  const [recordsLoading, setRecordsLoading] = React.useState(false);
  const [recordsError, setRecordsError] = React.useState<ParsedBookingError | null>(null);

  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<ConsultationSession>(`/consultations/${sessionId}`, { signal });
        setSession(data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(parseBookingError(err));
        setSession(null);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [sessionId],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Records are fetched ONLY when the patient is allowed to read them. Asking
  // earlier is a 409 by design (READ_PATIENT gate), so requesting them and
  // rendering the resulting conflict as an error would present correct
  // server behaviour as a fault. Gating here keeps the two in step.
  const recordsReadable = session ? canPatientReadRecords(session.state) : false;

  React.useEffect(() => {
    if (!sessionId || !recordsReadable) {
      setRecords(null);
      setRecordsLoading(false);
      setRecordsError(null);
      return;
    }
    const controller = new AbortController();
    setRecordsLoading(true);
    setRecordsError(null);
    void (async () => {
      try {
        const data = await api.get<ConsultationRecords>(`/consultations/${sessionId}/records`, {
          signal: controller.signal,
        });
        setRecords(data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setRecordsError(parseBookingError(err));
        setRecords(null);
      } finally {
        if (!controller.signal.aborted) setRecordsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [sessionId, recordsReadable]);

  async function handleJoin() {
    if (!sessionId) return;
    setJoining(true);
    setJoinError(null);
    try {
      const updated = await api.post<ConsultationSession>(`/consultations/${sessionId}/join`);
      setSession(updated);
      // Joining is the patient signalling they are ready; the doctor still has
      // to arrive, so the toast must not imply the consultation has started.
      toast.success('You have joined the consultation');
    } catch (err: unknown) {
      // A 409 here means the session already finished — a re-join is not a
      // failure, so re-read the session and let the terminal state render
      // instead of raising an error banner.
      if (err instanceof ApiError && err.statusCode === 409) {
        toast.info('This consultation has already finished');
        await load();
        return;
      }
      setJoinError(parseBookingError(err));
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Consultation" description="Your consultation room." />
        <Card>
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-9 w-32" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="space-y-6">
        <PageHeader title="Consultation" description="Your consultation room." />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Couldn&apos;t open this consultation</AlertTitle>
              <AlertDescription>
                {error?.message ?? 'This consultation could not be found.'}
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap justify-center gap-3">
              {error?.retryable && (
                <Button type="button" onClick={() => void load()}>
                  Try again
                </Button>
              )}
              <Button type="button" variant="outline" asChild>
                <Link to="/patient/appointments">Back to my appointments</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { patientPresent, doctorPresent } = presenceOf(session);
  const waiting = isWaitingForDoctor(session);
  const finished = session.state === 'COMPLETED';
  // Not just `canJoin(state)`: cancelling an appointment leaves its session
  // SCHEDULED, so a state-only check still offered Join for a cancelled
  // appointment (and the server then accepted it). `canOfferJoin` also consults
  // the appointment status — see consultation-types for the full reasoning.
  const joinable = canOfferJoin(session);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consultation"
        description={
          session.appointment
            ? `Started from your appointment on ${formatAppointmentWhen(
                session.appointment.scheduledAt,
              )}.`
            : 'Your consultation room.'
        }
      />

      {/* ---- Live status -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <TintedIcon
                icon={waiting ? Hourglass : stateIconFor(session.state)}
                tone={waiting ? 'yellow' : session.state === 'IN_PROGRESS' ? 'mint' : 'blue'}
                size="md"
              />
              <CardTitle className="font-heading text-lg">{stateLabel(session.state)}</CardTitle>
            </div>
            <ConsultationStateBadge state={session.state} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">{stateHint(session)}</p>

          {/* Participant presence. Shown as two explicit rows rather than a
              single "waiting" line so it is obvious WHICH side is missing. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <PresenceRow
              role="You"
              present={presenceOf(session).patientPresent}
              presentLabel="In the room"
              absentLabel="Not yet joined"
            />
            <PresenceRow
              role="Your doctor"
              present={doctorPresent}
              presentLabel="In the room"
              absentLabel="Has not arrived yet"
              waiting={waiting}
            />
          </div>

          {joinError && (
            <Alert variant="destructive" data-testid="join-error">
              <AlertTitle>Couldn&apos;t join the consultation</AlertTitle>
              <AlertDescription>{joinError.message}</AlertDescription>
            </Alert>
          )}

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            {joinable ? (
              <Button type="button" variant="cta" onClick={() => void handleJoin()} disabled={joining}>
                {joining ? 'Joining…' : waiting ? 'Check again' : 'Join consultation'}
              </Button>
            ) : (
              // Terminal: no join affordance at all, rather than one that would 409.
              <Button type="button" variant="outline" asChild>
                <Link to="/patient/records">View medical records</Link>
              </Button>
            )}
            <Button type="button" variant="outline" asChild>
              <Link to="/patient/appointments">My appointments</Link>
            </Button>
          </div>

          {/* The waiting state is the COMMON case, not a fault — so it gets a
              warm, reassuring treatment instead of a bare sentence of grey
              text, which read as an apology for a bug. Wording stays calm and
              direct (clinical context, per v3) — no jokes, just warmth. */}
          {waiting && (
            <div className="flex items-start gap-3 rounded-xl border border-yellow/40 bg-yellow/15 p-4">
              <TintedIcon icon={Hourglass} tone="yellow" size="sm" className="mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink">Naghihintay pa si Doc</p>
                <p className="text-sm text-muted-foreground">
                  Nothing is wrong — your doctor simply has not joined yet. You can
                  stay on this page, or leave and come back; this room stays open.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Video call ----------------------------------------------------
          Additive to the join flow, not a replacement: the patient still clicks
          Join (which transitions the session) and only then does the room
          appear. Rendering it before joining would put the patient in the call
          while the workspace still says they have not arrived — the two would
          visibly disagree.

          Kept mounted through IN_PROGRESS and COMPLETED so completing the
          consultation does not yank the doctor's own call out from under them
          (completion is doctor-side; this frame is the patient's). */}
      {patientPresent && !finished && <JitsiCall sessionId={session.id} />}

      {/* ---- Records (only once the session is COMPLETED) ------------------ */}
      {finished && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <TintedIcon icon={MessageSquareText} tone="mint" size="md" />
            <h2 className="font-heading text-lg font-semibold text-ink">
              Consultation notes &amp; prescriptions
            </h2>
          </div>

          {recordsLoading ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </CardContent>
            </Card>
          ) : recordsError ? (
            <Card>
              <CardContent className="px-6 py-8">
                <Alert variant="destructive">
                  <AlertTitle>Couldn&apos;t load your records</AlertTitle>
                  <AlertDescription>{recordsError.message}</AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          ) : hasNoRecords(records) ? (
            <EmptyState
              icon={FileText}
              eyebrow="Walang notes"
              title="No notes were recorded"
              description="This consultation finished without a note or prescription. That happens sometimes — for example, if it was a quick follow-up."
            />
          ) : (
            <div className="space-y-4">
              {records?.notes.map((note) => (
                <Card key={note.id}>
                  <CardHeader>
                    <CardTitle className="font-heading text-base">
                      Note{' '}
                      <span className="font-normal text-muted-foreground">
                        {formatAppointmentWhen(note.recordedAt)}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {note.findings && (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-ink">Findings</p>
                        <p className="text-sm text-muted-foreground">{note.findings}</p>
                      </div>
                    )}
                    {note.recommendations && (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-ink">Recommendations</p>
                        <p className="text-sm text-muted-foreground">{note.recommendations}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

              {records && records.prescriptions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="font-heading text-base">Prescriptions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {records.prescriptions.map((rx) => (
                        <li key={rx.id} className="space-y-1 border-l-2 border-coral pl-3">
                          <p className="text-sm text-ink">{rx.details}</p>
                          <p className="text-xs text-muted-foreground">
                            Issued {formatAppointmentWhen(rx.issuedAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pre-completion: be explicit that records appear later, so the empty
          space is explained rather than looking like missing data. */}
      {!finished && (
        <Alert>
          <AlertTitle>Notes appear after the consultation</AlertTitle>
          <AlertDescription>
            Your doctor records findings and any prescriptions at the end of the
            session. They will appear here once the consultation is completed.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
