import * as React from 'react';
import { Link, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { parseBookingError, type ParsedBookingError } from '@/features/patient/booking-api-errors';
import { fetchPatientRecords } from './patient-records-api';
import {
  countEntries,
  formatAppointmentWhen,
  formatRecordDate,
  groupRecordsByYear,
  hasClinicalContent,
  isCompleted,
  isUpcoming,
  patientLabel,
  stateBadgeVariant,
  stateLabel,
  type DoctorPatientRecord,
} from './patient-records-types';

/**
 * Layer 7 sub-item 3 — Patient records (doctor side), detail step.
 *
 * `GET /consultations/records/patient/:patientProfileId`, DOCTOR-only.
 *
 * SCOPING — the patient id comes from the route, which is set by the patients
 * list from the doctor's own appointment feed. This screen does NOT attempt to
 * validate that id itself: the server enforces the relation (a 403, "You have no
 * appointments with this patient", when the doctor has no appointment with
 * them) and there is deliberately no client-side allow-list. Mirroring an
 * authorisation rule in the client is how a client ends up appearing to permit
 * something the server rejects; the only real check is the request.
 *
 * SHAPE — unlike the patient's `records/me`, this endpoint includes sessions
 * that are NOT completed (READ_DOCTOR allows IN_PROGRESS), so an upcoming or
 * live consultation appears in the list with its clinical content withheld.
 * The screen must therefore distinguish "nothing was written" from "nothing is
 * readable yet" — see the empty states below.
 */
export function DoctorPatientRecordsScreen() {
  const { patientProfileId } = useParams<{ patientProfileId: string }>();

  const [records, setRecords] = React.useState<DoctorPatientRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedBookingError | null>(null);

  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      if (!patientProfileId) {
        setLoading(false);
        setError({
          message: 'No patient was specified.',
          statusCode: 400,
          isConflict: false,
          isMissingSlot: false,
          retryable: false,
        });
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPatientRecords(patientProfileId, signal);
        setRecords(data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(parseBookingError(err));
        setRecords([]);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [patientProfileId],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const years = React.useMemo(() => groupRecordsByYear(records), [records]);
  const entries = React.useMemo(() => countEntries(records), [records]);

  // Every row is for the same patient, so the heading name is taken from any
  // record. `patientName` is nullable in the contract and resolved through
  // `patientLabel` rather than rendered raw.
  const heading = records.length > 0 ? patientLabel(records[0]!) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={heading ? `${heading} — records` : 'Patient records'}
        description="Consultation notes and prescriptions for this patient."
        actions={
          <Button type="button" variant="outline" size="sm" asChild>
            <Link to="/doctor/patients">Back to patients</Link>
          </Button>
        }
      />

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              {/* The 403 has a precise, actionable meaning here — it is not a
                  generic failure, and saying so prevents the doctor thinking
                  the app is broken when they simply mistyped a link. */}
              <AlertTitle>
                {error.statusCode === 403
                  ? 'No appointments with this patient'
                  : "Couldn't load these records"}
              </AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
            <div className="flex flex-wrap justify-center gap-3">
              {error.retryable && (
                <Button type="button" onClick={() => void load()}>
                  Try again
                </Button>
              )}
              <Button type="button" variant="outline" asChild>
                <Link to="/doctor/patients">Back to patients</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="space-y-4" aria-hidden="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-4 p-6">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="space-y-1">
              <p className="font-heading text-base font-semibold text-ink">
                No consultations yet
              </p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                This patient has an appointment with you, but no consultation
                session exists for it yet. Records appear here once a session
                starts.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Badge variant="secondary">
              {records.length} consultation{records.length === 1 ? '' : 's'}
            </Badge>
            <Badge variant="secondary">
              {entries} record{entries === 1 ? '' : 's'}
            </Badge>
          </div>

          <div className="space-y-8">
            {years.map((group) => (
              <section key={group.year} className="space-y-4">
                <h2 className="font-heading text-lg font-semibold text-ink">{group.year}</h2>
                <ul className="space-y-4">
                  {group.records.map((record) => (
                    <li key={record.sessionId}>
                      <RecordCard record={record} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RecordCard({ record }: { record: DoctorPatientRecord }) {
  // An upcoming/live session is described but has no readable content: the API
  // returns empty arrays for anything below IN_PROGRESS. Wording must reflect
  // that distinction, so the two cases are branched on STATE, not on the arrays
  // being empty — "no notes were recorded" would be a lie about a session that
  // has not happened yet.
  const readable = isCompleted(record) || record.state === 'IN_PROGRESS';
  // The treating clinician. `doctorName` is nullable in the contract, and is the
  // doctor's OWN name when viewing their own consultation — it is shown plainly
  // rather than hidden, because a records list read by a clinician should state
  // who wrote each entry, and records can span a change of clinician.
  const clinician = record.doctorName ?? 'Clinician unavailable';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="font-heading text-base text-ink">
              {isCompleted(record)
                ? formatRecordDate(record.completedAt)
                : formatAppointmentWhen(record.scheduledAt)}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {clinician}
              {record.specialization ? ` · ${record.specialization}` : ''}
            </p>
          </div>
          <Badge variant={stateBadgeVariant(record.state)}>{stateLabel(record.state)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!readable && isUpcoming(record) ? (
          <p className="text-sm text-muted-foreground">
            {record.state === 'JOINED'
              ? 'This consultation is waiting to open. Notes and prescriptions appear once it is in progress.'
              : 'This consultation has not started. Notes and prescriptions appear once it is in progress.'}
          </p>
        ) : !hasClinicalContent(record) ? (
          <p className="text-sm text-muted-foreground">
            No notes or prescriptions were recorded for this consultation.
          </p>
        ) : (
          <>
            {record.notes.map((note) => (
              <div key={note.id} className="space-y-3">
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

            {record.prescriptions.length > 0 && (
              <>
                {record.notes.length > 0 && <Separator />}
                <div className="space-y-3">
                  <p className="text-sm font-medium text-ink">Prescriptions</p>
                  <ul className="space-y-3">
                    {record.prescriptions.map((rx) => (
                      <li key={rx.id} className="space-y-1 border-l-2 border-coral pl-3">
                        <p className="text-sm text-ink">{rx.details}</p>
                        <p className="text-xs text-muted-foreground">
                          Issued {formatRecordDate(rx.issuedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </>
        )}

        <div className="pt-1">
          <Button type="button" variant="outline" size="sm" asChild>
            <Link to={`/doctor/consultations/${record.sessionId}`}>
              Open consultation
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
