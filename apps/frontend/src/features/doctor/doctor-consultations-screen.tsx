import * as React from 'react';
import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { parseBookingError, type ParsedBookingError } from '@/features/patient/booking-api-errors';
import { formatAppointmentWhen } from '@/features/patient/booking-types';
import { fetchMyAppointments } from './patient-records-api';
import {
  doctorStateLabel,
  doctorStateVariant,
  type ConsultationState,
} from './consultation-workspace-types';

/** A consultation as the doctor's list sees it: session + who it is with. */
interface DoctorConsultationRow {
  sessionId: string;
  state: ConsultationState;
  scheduledAt: string;
  patientName: string | null;
  needsAttention: boolean;
}

/**
 * Reduce the doctor's appointment feed to the appointments that actually HAVE a
 * consultation session, with the session's state.
 *
 * An appointment without a session has no room to enter — the API creates the
 * session alongside the booking, but a row without one would render a link to
 * nothing, so it is filtered out rather than shown as broken. Cancelled
 * appointments are dropped: no consultation is happening.
 *
 * "Needs attention" = the patient is waiting at JOINED, or the session is live.
 * That is what a doctor opening this list is looking for, so those sort first.
 */
export function buildConsultationList(
  appointments: Array<{
    status: string;
    scheduledAt: string;
    patientProfile: { id: string; name: string } | null;
    consultationSession: { id: string; state: ConsultationState } | null;
  }>,
): DoctorConsultationRow[] {
  const rows: DoctorConsultationRow[] = [];
  for (const appt of appointments) {
    if (!appt.consultationSession) continue;
    if (appt.status === 'CANCELLED') continue;
    const state = appt.consultationSession.state;
    rows.push({
      sessionId: appt.consultationSession.id,
      state,
      scheduledAt: appt.scheduledAt,
      patientName: appt.patientProfile?.name ?? null,
      needsAttention: state === 'JOINED' || state === 'IN_PROGRESS',
    });
  }

  // Live/waiting first (soonest first), then everything else most-recent-first.
  return rows.sort((a, b) => {
    if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
    const at = new Date(a.scheduledAt).getTime();
    const bt = new Date(b.scheduledAt).getTime();
    return a.needsAttention ? at - bt : bt - at;
  });
}

/**
 * Layer 7 sub-item 4 — Consultations (doctor side), list step.
 *
 * Derives from `GET /appointments/me` exactly as the patient list does: the
 * joined `consultationSession` carries the session id needed to open a room, and
 * that id cannot be derived from the appointment id (different UUIDs). There is
 * no dedicated doctor-consultations endpoint and none was added.
 */
export function DoctorConsultationsScreen() {
  const [rows, setRows] = React.useState<DoctorConsultationRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedBookingError | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setRows(buildConsultationList(await fetchMyAppointments(signal)));
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(parseBookingError(err));
      setRows([]);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const attention = rows.filter((r) => r.needsAttention).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consultations"
        description="Join sessions and record notes and prescriptions."
      />

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Couldn&apos;t load your consultations</AlertTitle>
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
        <div className="space-y-3" aria-hidden="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-9 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="space-y-1">
              <p className="font-heading text-base font-semibold text-ink">
                No consultations yet
              </p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                A consultation room is created for each appointment. Once a patient
                books with you, the session appears here.
              </p>
            </div>
            <Button type="button" variant="cta" asChild>
              <Link to="/doctor/schedule">Manage availability</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary">
              {rows.length} consultation{rows.length === 1 ? '' : 's'}
            </Badge>
            {attention > 0 && (
              <Badge variant="default">
                {attention} needing attention
              </Badge>
            )}
          </div>

          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.sessionId}>
                <ConsultationRowCard row={row} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ConsultationRowCard({ row }: { row: DoctorConsultationRow }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          <p className="font-heading text-base font-semibold text-ink">
            {row.patientName ?? 'Patient unavailable'}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatAppointmentWhen(row.scheduledAt)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant={doctorStateVariant(row.state)}>{doctorStateLabel(row.state)}</Badge>
          <Button type="button" variant={row.needsAttention ? 'cta' : 'outline'} size="sm" asChild>
            <Link to={`/doctor/consultations/${row.sessionId}`}>
              {row.state === 'COMPLETED' ? 'View records' : 'Open room'}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
