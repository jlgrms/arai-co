import * as React from 'react';
import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { parseBookingError, type ParsedBookingError } from '@/features/patient/booking-api-errors';
import { formatAppointmentWhen } from '@/features/patient/booking-types';
import { fetchMyAppointments } from './patient-records-api';
import { buildPatientList, filterPatients, type DoctorPatientSummary } from './patient-records-types';

/**
 * Layer 7 sub-item 3 — Patients (doctor side), list step.
 *
 * The doctor's patient list is DERIVED, not fetched from a dedicated endpoint:
 * there is no `GET /doctors/me/patients` and none was added. A doctor's patients
 * are exactly the counterparties on their own appointments, so `GET /appointments/me`
 * is the authoritative source and `patientProfile` is projected onto it (the
 * Layer 7 backend fix). One request feeds both this list and the records screen
 * that follows it.
 *
 * Why derive rather than invent an endpoint: an endpoint would need its own
 * scoping rule and could drift from what the appointment feed says. Deriving
 * means the list can never show a patient the doctor has no appointment with —
 * the moment a row exists here, the records call for it is guaranteed to pass
 * the server's appointment-relation check.
 */
export function DoctorPatientsScreen() {
  const [patients, setPatients] = React.useState<DoctorPatientSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedBookingError | null>(null);
  const [query, setQuery] = React.useState('');

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const appointments = await fetchMyAppointments(signal);
      setPatients(buildPatientList(appointments));
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(parseBookingError(err));
      setPatients([]);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const visible = React.useMemo(() => filterPatients(patients, query), [patients, query]);
  const upcomingCount = React.useMemo(
    () => patients.filter((p) => p.nextAppointmentAt !== null).length,
    [patients],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patients"
        description="People you have appointments with, and their records."
      />

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Couldn&apos;t load your patients</AlertTitle>
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
          {Array.from({ length: 3 }).map((_, i) => (
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
      ) : patients.length === 0 ? (
        /* A doctor with no appointments yet has no patients. This is the normal
           state for a newly approved doctor, so it explains how patients appear
           instead of reading as a failure. */
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="space-y-1">
              <p className="font-heading text-base font-semibold text-ink">No patients yet</p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Patients appear here once someone books an appointment with you. Keep
                your availability up to date so they can find a time.
              </p>
            </div>
            <Button type="button" variant="cta" asChild>
              <Link to="/doctor/schedule">Manage availability</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Size stated up front: "who do I have today" is the question this
              screen answers, and it must not require counting rows. */}
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary">
              {patients.length} patient{patients.length === 1 ? '' : 's'}
            </Badge>
            {upcomingCount > 0 && (
              <Badge variant="outline">
                {upcomingCount} with an upcoming appointment
              </Badge>
            )}
          </div>

          {/* Search is client-side over the already-loaded derived list. The
              full set is one request and is small (a doctor's own panel), so a
              round trip per keystroke would add latency and a new failure mode
              for no gain. */}
          <div className="max-w-sm">
            <label htmlFor="patient-search" className="sr-only">
              Search patients by name
            </label>
            <Input
              id="patient-search"
              type="search"
              placeholder="Search patients by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {visible.length === 0 ? (
            <Card>
              <CardContent className="px-6 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  No patients match &ldquo;{query.trim()}&rdquo;.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3">
              {visible.map((patient) => (
                <li key={patient.patientProfileId}>
                  <PatientRow patient={patient} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function PatientRow({ patient }: { patient: DoctorPatientSummary }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          <p className="font-heading text-base font-semibold text-ink">{patient.name}</p>
          <p className="text-sm text-muted-foreground">
            {patient.appointmentCount} appointment
            {patient.appointmentCount === 1 ? '' : 's'}
            {patient.nextAppointmentAt
              ? ` · Next ${formatAppointmentWhen(patient.nextAppointmentAt)}`
              : patient.lastAppointmentAt
                ? ` · Last seen ${formatAppointmentWhen(patient.lastAppointmentAt)}`
                : ''}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {patient.nextAppointmentAt && <Badge variant="default">Upcoming</Badge>}
          {/* The patient id travels in the URL. It is a server-issued id taken
              from the doctor's own feed; the records screen re-validates it by
              simply calling the API, which is what actually enforces scoping. */}
          <Button type="button" variant="outline" size="sm" asChild>
            <Link to={`/doctor/patients/${patient.patientProfileId}`}>View records</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
