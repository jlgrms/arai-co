import * as React from 'react';
import { Link } from 'react-router-dom';
import { FileHeart, HeartPulse, Stethoscope } from 'lucide-react';

import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { TintedIcon } from '@/components/ui/tinted-icon';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { parseBookingError, type ParsedBookingError } from './booking-api-errors';
import {
  countEntries,
  distinctSpecializations,
  doctorLabel,
  formatRecordDate,
  groupRecordsByYear,
  hasNoRecords,
  isEmptyRecord,
  specializationLabel,
  type MedicalRecord,
} from './medical-records-types';

/**
 * Layer 6 sub-item 6 — Medical records view (patient side).
 *
 * Read-only history of the patient's completed consultations: who they saw,
 * when, the doctor's findings and recommendations, and any prescriptions.
 *
 * RBAC is entirely server-side and is NOT re-implemented here. The endpoint is
 * `GET /consultations/records/me`: PATIENT-only, deriving the patient from the
 * JWT. There is no patient id in the request, so this screen cannot ask for
 * anyone else's records — and no client-side filtering is attempted, because
 * filtering implies the server might have sent too much. A cross-patient
 * request is rejected 403 by the role guard before any query runs (verified
 * live with a real token).
 *
 * The endpoint returns ONLY COMPLETED sessions, newest first, with the doctor
 * joined. Nothing here re-sorts or re-filters that; it formats what it is given.
 */
export function MedicalRecordsScreen() {
  const [records, setRecords] = React.useState<MedicalRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedBookingError | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<MedicalRecord[]>('/consultations/records/me', { signal });
      setRecords(data);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(parseBookingError(err));
      setRecords([]);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const years = React.useMemo(() => groupRecordsByYear(records), [records]);
  const specialties = React.useMemo(() => distinctSpecializations(records), [records]);
  const entries = React.useMemo(() => countEntries(records), [records]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medical records"
        description="Notes and prescriptions from your completed consultations."
      />

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Couldn&apos;t load your records</AlertTitle>
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
        <div className="space-y-4" aria-hidden="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-4 p-6">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : hasNoRecords(records) ? (
        /* The empty state is a NORMAL case, not an edge case: a patient who has
           booked but never completed a consultation lands here, and so does
           every newly registered patient. Empty records mean nothing bad has
           happened yet — so the tone is reassuring ("malusog ka pa") rather
           than the flat "no data" it used to be, while the explanation below it
           stays direct about what will appear and when. */
        <EmptyState
          icon={HeartPulse}
          eyebrow="Malusog ka pa"
          title="Wala ka pang records"
          description="Your notes and prescriptions appear here once a consultation is completed. If you have an upcoming appointment, records will show up after it finishes."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button type="button" variant="cta" asChild>
                <Link to="/patient/book">Book an appointment</Link>
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/patient/appointments">My appointments</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {/* Summary strip. A long history is hard to survey, so state the size
              and breadth up front instead of making the patient count cards. */}
          <div className="flex flex-wrap gap-3">
            <Badge variant="secondary" className="gap-1.5">
              <Stethoscope className="size-3.5 shrink-0" aria-hidden />
              {records.length} completed consultation{records.length === 1 ? '' : 's'}
            </Badge>
            <Badge variant="secondary">
              {entries} record{entries === 1 ? '' : 's'}
            </Badge>
            {specialties.map((s) => (
              <Badge key={s} variant="outline">
                {s}
              </Badge>
            ))}
          </div>

          <div className="space-y-10">
            {years.map((group) => (
              <section key={group.year} className="space-y-5">
                {/* Year marker with the same tinted-icon treatment used for
                    section headings across the rest of the pass. */}
                <div className="flex items-center gap-3">
                  <TintedIcon icon={FileHeart} tone="mint" size="md" />
                  <h2 className="font-heading text-lg font-semibold text-ink">{group.year}</h2>
                  <Badge variant="muted">
                    {group.records.length}{' '}
                    {group.records.length === 1 ? 'consultation' : 'consultations'}
                  </Badge>
                </div>

                {/* Timeline rail. The connector runs down the left with a node
                    per visit, so the history reads as a sequence of events in
                    time rather than a stack of unrelated cards. It is the
                    vertical counterpart to the booking flow's JourneyProgress,
                    using the same coral node + ink heading language. */}
                <ol className="relative ml-1 space-y-4 border-l-2 border-border pl-6">
                  {group.records.map((record, index) => {
                    const isLast = index === group.records.length - 1;
                    return (
                      <li key={record.sessionId} className="relative">
                        <span
                          aria-hidden
                          className={cn(
                            'absolute -left-[31px] top-1.5 size-3.5 rounded-full border-2 bg-surface',
                            isLast ? 'border-accent' : 'border-border',
                          )}
                        />
                        <RecordCard record={record} />
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RecordCard({ record }: { record: MedicalRecord }) {
  const specialization = specializationLabel(record);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="font-heading text-base text-ink">
              {doctorLabel(record)}
            </CardTitle>
            {specialization && (
              <p className="text-sm text-muted-foreground">{specialization}</p>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {formatRecordDate(record.completedAt)}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isEmptyRecord(record) ? (
          /* A completed consult can legitimately carry no written record.
             Saying so is clearer than rendering an empty box. */
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

        {/* Deep link back into the consultation that produced this record. */}
        <div className="pt-1">
          <Button type="button" variant="outline" size="sm" asChild>
            <Link to={`/patient/consultations/${record.sessionId}`}>
              View full consultation
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
