import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { parseBookingError, type ParsedBookingError } from '@/features/patient/booking-api-errors';
import { formatAppointmentWhen } from '@/features/patient/booking-types';
import { presenceOf, type ConsultationRecords } from '@/features/patient/consultation-types';
import {
  addNote,
  addPrescription,
  completeSession,
  fetchSession,
  fetchSessionRecords,
  joinSession,
} from './consultation-workspace-api';
import {
  CLINICAL_TEXT_MAX_LENGTH,
  canComplete,
  canDoctorOfferJoin,
  canDoctorWrite,
  completionBlockedReason,
  doctorStateHint,
  doctorStateLabel,
  doctorStateVariant,
  isNoteSubmittable,
  isOverLimit,
  isPrescriptionSubmittable,
  remainingChars,
  shouldLoadRecords,
  toNotePayload,
  toPrescriptionPayload,
} from './consultation-workspace-types';

/**
 * Layer 7 sub-item 4 — Consultation workspace, DOCTOR side.
 *
 * This is the only screen in the product from which a consultation can be
 * COMPLETED. Completing is doctor-only on the server, so the patient side
 * (Layer 6 sub-item 5) is structurally unable to finish one: the two halves of
 * this flow only meet here.
 *
 * The whole screen is driven by three server-enforced gates, and each gate is
 * mirrored before the affordance is rendered rather than discovered by getting a
 * 409:
 *   WRITE       = { IN_PROGRESS, COMPLETED }  -> the composer appears only here
 *   READ_DOCTOR = { IN_PROGRESS, COMPLETED }  -> records are fetched only here
 *   complete    = { JOINED, IN_PROGRESS }     -> COMPLETED and SCHEDULED are refused
 *
 * The SCHEDULED completion case is the one worth reading closely: a doctor
 * looking at a no-show cannot close the session, and the API will not let them.
 * That is presented as an explained, unactionable state rather than a button
 * that always fails.
 */
export function DoctorConsultationWorkspaceScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();

  const [session, setSession] = React.useState<Awaited<ReturnType<typeof fetchSession>> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedBookingError | null>(null);

  const [busy, setBusy] = React.useState<null | 'join' | 'complete'>(null);
  const [actionError, setActionError] = React.useState<ParsedBookingError | null>(null);

  const [records, setRecords] = React.useState<ConsultationRecords | null>(null);
  const [recordsLoading, setRecordsLoading] = React.useState(false);
  const [recordsError, setRecordsError] = React.useState<ParsedBookingError | null>(null);

  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionId) return;
      setLoading(true);
      setError(null);
      try {
        setSession(await fetchSession(sessionId, signal));
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

  // Records are fetched ONLY inside the READ_DOCTOR gate. Requesting them from
  // SCHEDULED/JOINED is a 409 by design, so fetching and then rendering that
  // conflict as an error would present correct server behaviour as a fault.
  // `recordsVersion` lets a successful write re-read the list so the doctor sees
  // the entry they just added (writes are append-only; the local copy is stale).
  const [recordsVersion, setRecordsVersion] = React.useState(0);
  const recordsReadable = session ? shouldLoadRecords(session.state) : false;

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
        setRecords(await fetchSessionRecords(sessionId, controller.signal));
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setRecordsError(parseBookingError(err));
        setRecords(null);
      } finally {
        if (!controller.signal.aborted) setRecordsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [sessionId, recordsReadable, recordsVersion]);

  async function handleJoin() {
    if (!sessionId) return;
    setBusy('join');
    setActionError(null);
    try {
      setSession(await joinSession(sessionId));
      toast.success('You have joined the consultation');
    } catch (err: unknown) {
      // A 409 means the session already finished. That is not a failure, so
      // re-read and let the terminal state render instead of an error banner.
      if (err instanceof ApiError && err.statusCode === 409) {
        toast.info('This consultation has already finished');
        await load();
        return;
      }
      setActionError(parseBookingError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleComplete() {
    if (!sessionId) return;
    setBusy('complete');
    setActionError(null);
    try {
      setSession(await completeSession(sessionId));
      toast.success('Consultation completed');
    } catch (err: unknown) {
      setActionError(parseBookingError(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Consultation" description="The consultation room." />
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
        <PageHeader title="Consultation" description="The consultation room." />
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
                <Link to="/doctor/consultations">Back to consultations</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { patientPresent, doctorPresent } = presenceOf(session);
  const writable = canDoctorWrite(session.state);
  const completable = canComplete(session.state);
  const blockedReason = completionBlockedReason(session.state);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consultation"
        description={
          session.appointment
            ? `From the appointment on ${formatAppointmentWhen(session.appointment.scheduledAt)}.`
            : 'The consultation room.'
        }
      />

      {/* ---- Live status -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="font-heading text-lg">
              {doctorStateLabel(session.state, patientPresent)}
            </CardTitle>
            <Badge variant={doctorStateVariant(session.state)}>
              {doctorStateLabel(session.state, patientPresent)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            {doctorStateHint(session.state, patientPresent)}
          </p>

          {/* Presence as two explicit rows so it is obvious WHICH side is missing. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-input p-4">
              <p className="text-sm font-medium text-ink">You</p>
              <p className="text-sm text-muted-foreground">
                {doctorPresent ? 'In the room' : 'Not yet joined'}
              </p>
            </div>
            <div className="rounded-md border border-input p-4">
              <p className="text-sm font-medium text-ink">Patient</p>
              <p className="text-sm text-muted-foreground">
                {patientPresent ? 'In the room' : 'Has not arrived yet'}
              </p>
            </div>
          </div>

          {actionError && (
            <Alert variant="destructive" data-testid="action-error">
              <AlertTitle>Couldn&apos;t update this consultation</AlertTitle>
              <AlertDescription>{actionError.message}</AlertDescription>
            </Alert>
          )}

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            {canDoctorOfferJoin(session) && (
              <Button
                type="button"
                variant="cta"
                onClick={() => void handleJoin()}
                disabled={busy !== null}
              >
                {busy === 'join' ? 'Joining…' : 'Join consultation'}
              </Button>
            )}

            {/* Completion is offered ONLY when the server would accept it. In
                SCHEDULED the API answers 409 NOT_JOINED, so the button is
                replaced by an explanation of what would unblock it. */}
            {completable && (
              <Button
                type="button"
                variant={doctorPresent ? 'cta' : 'outline'}
                onClick={() => void handleComplete()}
                disabled={busy !== null}
              >
                {busy === 'complete' ? 'Completing…' : 'Complete consultation'}
              </Button>
            )}

            <Button type="button" variant="outline" asChild>
              <Link to="/doctor/consultations">All consultations</Link>
            </Button>
          </div>

          {blockedReason && (
            <Alert data-testid="completion-blocked">
              <AlertTitle>Cannot complete this consultation</AlertTitle>
              <AlertDescription>{blockedReason}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ---- Notes & prescriptions ----------------------------------------- */}
      <div className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-ink">
          Notes &amp; prescriptions
        </h2>

        {!writable ? (
          /* Below IN_PROGRESS the WRITE gate is closed. Explain that, rather
             than showing a composer whose every submission would 409. */
          <Alert data-testid="write-gated">
            <AlertTitle>Recording opens during the consultation</AlertTitle>
            <AlertDescription>
              You can record findings, recommendations, and prescriptions once the
              consultation is in progress. Notes written before the encounter
              would have no clinical meaning, so they are not accepted yet.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <ExistingRecords
              records={records}
              loading={recordsLoading}
              error={recordsError}
            />
            <ClinicalComposer
              sessionId={session.id}
              onRecorded={() => setRecordsVersion((v) => v + 1)}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Everything already written for this session. Append-only, so this list grows. */
function ExistingRecords({
  records,
  loading,
  error,
}: {
  records: ConsultationRecords | null;
  loading: boolean;
  error: ParsedBookingError | null;
}) {
  const noteCount = records?.notes.length ?? 0;
  const rxCount = records?.prescriptions.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">
          Already recorded
          {!loading && !error && (noteCount > 0 || rxCount > 0) && (
            <span className="ml-2 font-normal text-muted-foreground">
              {noteCount} note{noteCount === 1 ? '' : 's'} · {rxCount} prescription
              {rxCount === 1 ? '' : 's'}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load existing records</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : noteCount === 0 && rxCount === 0 ? (
          /* Not an error: a consultation in progress usually has nothing written
             yet. This is the first thing the doctor sees, so it reads as a
             prompt rather than as missing data. */
          <p className="text-sm text-muted-foreground">
            Nothing recorded yet for this consultation. Anything you add below is
            saved immediately and cannot be edited or deleted, so add a new entry
            to correct or extend a previous one.
          </p>
        ) : (
          <>
            {records!.notes.map((note, i) => (
              <div key={note.id} className="space-y-3">
                {i > 0 && <Separator />}
                <p className="text-xs text-muted-foreground">
                  Note {i + 1} · recorded {formatAppointmentWhen(note.recordedAt)}
                </p>
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
              </div>
            ))}

            {rxCount > 0 && (
              <>
                {noteCount > 0 && <Separator />}
                <div className="space-y-3">
                  <p className="text-sm font-medium text-ink">Prescriptions</p>
                  <ul className="space-y-3">
                    {records!.prescriptions.map((rx) => (
                      <li key={rx.id} className="space-y-1 border-l-2 border-coral pl-3">
                        <p className="text-sm text-ink">{rx.details}</p>
                        <p className="text-xs text-muted-foreground">
                          Issued {formatAppointmentWhen(rx.issuedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The writing controls. Two separate forms because they map to two separate
 * endpoints with different DTOs — a note must carry findings or recommendations,
 * a prescription must carry details.
 */
function ClinicalComposer({
  sessionId,
  onRecorded,
}: {
  sessionId: string;
  onRecorded: () => void;
}) {
  const [findings, setFindings] = React.useState('');
  const [recommendations, setRecommendations] = React.useState('');
  const [details, setDetails] = React.useState('');
  const [savingNote, setSavingNote] = React.useState(false);
  const [savingRx, setSavingRx] = React.useState(false);
  const [noteError, setNoteError] = React.useState<string | null>(null);
  const [rxError, setRxError] = React.useState<string | null>(null);

  const noteOk = isNoteSubmittable({ findings, recommendations });
  const rxOk = isPrescriptionSubmittable({ details });
  const overLimit =
    isOverLimit(findings) || isOverLimit(recommendations) || isOverLimit(details);

  async function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteOk || overLimit) return;
    setSavingNote(true);
    setNoteError(null);
    try {
      await addNote(sessionId, toNotePayload({ findings, recommendations }));
      // Cleared only on success, so a failed submit does not lose what was typed.
      setFindings('');
      setRecommendations('');
      toast.success('Note added to this consultation');
      onRecorded();
    } catch (err: unknown) {
      setNoteError(parseBookingError(err).message);
    } finally {
      setSavingNote(false);
    }
  }

  async function submitRx(e: React.FormEvent) {
    e.preventDefault();
    if (!rxOk || overLimit) return;
    setSavingRx(true);
    setRxError(null);
    try {
      await addPrescription(sessionId, toPrescriptionPayload({ details }));
      setDetails('');
      toast.success('Prescription issued');
      onRecorded();
    } catch (err: unknown) {
      setRxError(parseBookingError(err).message);
    } finally {
      setSavingRx(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ---- Note ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">Add a note</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submitNote}>
            <div className="space-y-2">
              <Label htmlFor="note-findings">Findings</Label>
              <textarea
                id="note-findings"
                className="flex min-h-24 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={findings}
                onChange={(e) => setFindings(e.target.value)}
                placeholder="What you observed…"
              />
              <CharCounter value={findings} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="note-recommendations">Recommendations</Label>
              <textarea
                id="note-recommendations"
                className="flex min-h-24 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)}
                placeholder="Advice, follow-up, and next steps…"
              />
              <CharCounter value={recommendations} />
            </div>

            {noteError && (
              <Alert variant="destructive" data-testid="note-error">
                <AlertTitle>Couldn&apos;t add this note</AlertTitle>
                <AlertDescription>{noteError}</AlertDescription>
              </Alert>
            )}

            {/* Disabled rather than allowed-then-rejected: the server answers 400
                for a note with neither field. */}
            <Button type="submit" variant="cta" disabled={!noteOk || overLimit || savingNote}>
              {savingNote ? 'Adding…' : 'Add note'}
            </Button>
            {!noteOk && (
              <p className="text-xs text-muted-foreground">
                Enter findings, recommendations, or both.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* ---- Prescription ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">Issue a prescription</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submitRx}>
            <div className="space-y-2">
              <Label htmlFor="rx-details">Prescription</Label>
              <textarea
                id="rx-details"
                className="flex min-h-24 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Drug, dose, and directions…"
              />
              <CharCounter value={details} />
            </div>

            {rxError && (
              <Alert variant="destructive" data-testid="rx-error">
                <AlertTitle>Couldn&apos;t issue this prescription</AlertTitle>
                <AlertDescription>{rxError}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" variant="cta" disabled={!rxOk || overLimit || savingRx}>
              {savingRx ? 'Issuing…' : 'Issue prescription'}
            </Button>
            {!rxOk && (
              <p className="text-xs text-muted-foreground">Enter the prescription details.</p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** Remaining-character hint, shown only as the server's limit approaches. */
function CharCounter({ value }: { value: string }) {
  const remaining = remainingChars(value);
  if (remaining === null) return null;
  return (
    <p
      className={`text-xs ${remaining < 0 ? 'text-danger-text' : 'text-muted-foreground'}`}
      data-testid="char-counter"
    >
      {remaining < 0
        ? `${-remaining} character${remaining === -1 ? '' : 's'} over the ${CLINICAL_TEXT_MAX_LENGTH} limit`
        : `${remaining} character${remaining === 1 ? '' : 's'} remaining`}
    </p>
  );
}
