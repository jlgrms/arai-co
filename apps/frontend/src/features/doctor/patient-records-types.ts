/**
 * Doctor-side patient records (Layer 7 sub-item 3) — types and pure helpers.
 *
 * Contract mirrors the backend:
 *   `GET /consultations/records/patient/:patientProfileId` -> DoctorPatientRecord[]
 *
 * SCOPING NOTE — unlike the patient's `records/me`, this endpoint DOES take a
 * patient id in the path. That is unavoidable: a doctor legitimately views many
 * different patients, so the id has to come from somewhere. The scoping is
 * enforced server-side (appointment-count check -> 403 when the doctor has no
 * appointment with that patient), and the id itself is obtained from the
 * doctor's OWN appointment feed, which is participant-scoped by the API. This
 * module never mints an id; it only carries one the server already vouched for.
 *
 * SHAPE NOTE — this endpoint is deliberately NOT identical to `records/me`:
 *   - it includes NON-completed sessions (READ_DOCTOR allows IN_PROGRESS), so an
 *     upcoming consultation still appears, with clinical content withheld
 *   - the counterparty is `patientName`, not `doctorName`
 *   - it carries `state` and `scheduledAt` so both kinds of row can render
 * Both endpoints were aligned in Layer 7 so that every field `records/me`
 * returns is also present here; the doctor row is a superset.
 */

/**
 * Clinical content is gated by state server-side: a JOINED/SCHEDULED session is
 * described but its notes and prescriptions come back EMPTY. The client must not
 * infer content from an empty array — see `hasClinicalContent`.
 */
export interface DoctorRecordNote {
  id: string;
  sessionId: string;
  findings: string | null;
  recommendations: string | null;
  recordedAt: string;
}

export interface DoctorRecordPrescription {
  id: string;
  sessionId: string;
  details: string;
  issuedAt: string;
}

export type ConsultationState = 'SCHEDULED' | 'JOINED' | 'IN_PROGRESS' | 'COMPLETED';

export interface DoctorPatientRecord {
  sessionId: string;
  state: ConsultationState;
  /** The appointment time. Always present, including for upcoming sessions. */
  scheduledAt: string;
  /** When the session was completed; null while it is still upcoming/active. */
  completedAt: string | null;
  doctorName: string | null;
  specialization: string | null;
  /** The counterparty for a doctor — whose records these are. */
  patientName: string | null;
  notes: DoctorRecordNote[];
  prescriptions: DoctorRecordPrescription[];
}

/**
 * A patient the doctor has a relationship with, derived from their own
 * appointment feed.
 *
 * This is the ONLY source of `patientProfileId`, and it is the whole reason
 * Layer 7 needed a backend change: before `patientProfile` was projected onto
 * the doctor's appointment reads, there was no way to address the records
 * endpoint from the UI at all.
 */
export interface DoctorPatientSummary {
  patientProfileId: string;
  name: string;
  /** Total appointments with this patient, any status. */
  appointmentCount: number;
  /** The soonest upcoming appointment, or null when there is none. */
  nextAppointmentAt: string | null;
  /** The most recent past appointment, or null when there is none. */
  lastAppointmentAt: string | null;
}

/**
 * Build the doctor's patient list from their appointment feed.
 *
 * Deduplicated by patientProfileId: a doctor who has seen the same patient three
 * times has ONE patient row, not three. Appointments without a joined
 * `patientProfile` are skipped rather than shown as "unknown" — the API always
 * projects it, so an absent profile means the relation is genuinely missing.
 */
export function buildPatientList(
  appointments: Array<{
    patientProfile: { id: string; name: string } | null;
    scheduledAt: string;
    status: string;
  }>,
  now: Date = new Date(),
): DoctorPatientSummary[] {
  const byPatient = new Map<string, DoctorPatientSummary>();

  for (const appt of appointments) {
    if (!appt.patientProfile) continue;
    const { id, name } = appt.patientProfile;
    const at = new Date(appt.scheduledAt).getTime();

    const existing = byPatient.get(id) ?? {
      patientProfileId: id,
      name,
      appointmentCount: 0,
      nextAppointmentAt: null,
      lastAppointmentAt: null,
    };
    existing.appointmentCount += 1;

    // A CANCELLED appointment is not "upcoming" even if its time has not
    // passed — it will not take place, so it must not be advertised as next.
    const isUpcoming = at >= now.getTime() && appt.status !== 'CANCELLED';
    if (isUpcoming) {
      const current = existing.nextAppointmentAt
        ? new Date(existing.nextAppointmentAt).getTime()
        : Infinity;
      if (at < current) existing.nextAppointmentAt = appt.scheduledAt;
    } else {
      const current = existing.lastAppointmentAt
        ? new Date(existing.lastAppointmentAt).getTime()
        : -Infinity;
      if (at > current) existing.lastAppointmentAt = appt.scheduledAt;
    }

    byPatient.set(id, existing);
  }

  // Patients with an upcoming appointment first (soonest first), then the rest
  // by most recent contact — the order a doctor actually works in.
  return [...byPatient.values()].sort((a, b) => {
    if (a.nextAppointmentAt && b.nextAppointmentAt) {
      return (
        new Date(a.nextAppointmentAt).getTime() - new Date(b.nextAppointmentAt).getTime()
      );
    }
    if (a.nextAppointmentAt) return -1;
    if (b.nextAppointmentAt) return 1;
    const aLast = a.lastAppointmentAt ? new Date(a.lastAppointmentAt).getTime() : 0;
    const bLast = b.lastAppointmentAt ? new Date(b.lastAppointmentAt).getTime() : 0;
    return bLast - aLast;
  });
}

/** Filter the patient list by name, case-insensitively. */
export function filterPatients(
  patients: DoctorPatientSummary[],
  query: string,
): DoctorPatientSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return patients;
  return patients.filter((p) => p.name.toLowerCase().includes(q));
}

/** A record whose clinical content is available to read. */
export function hasClinicalContent(record: DoctorPatientRecord): boolean {
  return record.notes.length > 0 || record.prescriptions.length > 0;
}

/**
 * Whether the state is one where content COULD exist.
 *
 * Used to word the empty state honestly. A JOINED session showing no notes is
 * not "no records were written" — the consultation has not happened yet, so
 * there is nothing to read. Those are different messages and conflating them
 * would tell the doctor their colleague recorded nothing.
 */
export function isCompleted(record: DoctorPatientRecord): boolean {
  return record.state === 'COMPLETED';
}

export function isUpcoming(record: DoctorPatientRecord): boolean {
  return record.state !== 'COMPLETED';
}

/** Notes + prescriptions for one record. */
export function countEntries(records: DoctorPatientRecord[]): number {
  return records.reduce((sum, r) => sum + r.notes.length + r.prescriptions.length, 0);
}

/**
 * `patientName` is nullable in the contract (the backend uses `?? null` when a
 * profile is absent). Rendering "null" or a blank heading looks broken, so the
 * fallback is resolved once, here.
 */
export function patientLabel(record: DoctorPatientRecord): string {
  return record.patientName ?? 'Patient unavailable';
}

/** Distinct patients across a set of records, alphabetically. */
export function distinctPatients(records: DoctorPatientRecord[]): string[] {
  const found = new Set<string>();
  for (const r of records) {
    if (r.patientName) found.add(r.patientName);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/** Human label for a consultation state. */
export function stateLabel(state: ConsultationState): string {
  switch (state) {
    case 'SCHEDULED':
      return 'Scheduled';
    case 'JOINED':
      return 'Waiting';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'COMPLETED':
      return 'Completed';
  }
}

/**
 * Badge variant for a state. Completed is the only "done" state, IN_PROGRESS is
 * live, and the rest are pending — mapped onto the design system's semantic
 * variants rather than introducing new colours.
 */
export function stateBadgeVariant(
  state: ConsultationState,
): 'success' | 'default' | 'muted' {
  if (state === 'COMPLETED') return 'success';
  if (state === 'IN_PROGRESS') return 'default';
  return 'muted';
}

/** Group records by calendar year, newest first, for a long history. */
export interface DoctorRecordYearGroup {
  year: string;
  records: DoctorPatientRecord[];
}

/**
 * Group by the date the doctor thinks in: completion date when completed,
 * otherwise the scheduled date. An upcoming consultation has no completedAt, and
 * grouping it under "null" would hide it.
 */
export function groupRecordsByYear(records: DoctorPatientRecord[]): DoctorRecordYearGroup[] {
  const groups = new Map<string, DoctorPatientRecord[]>();
  for (const record of records) {
    const iso = record.completedAt ?? record.scheduledAt;
    const year = String(new Date(iso).getFullYear());
    const bucket = groups.get(year);
    if (bucket) bucket.push(record);
    else groups.set(year, [record]);
  }

  // Records arrive newest-first from the API; re-sort within each year so an
  // upcoming session (no completedAt) does not silently land at the bottom.
  return [...groups.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([year, yearRecords]) => ({
      year,
      records: [...yearRecords].sort((a, b) => {
        const aTime = new Date(a.completedAt ?? a.scheduledAt).getTime();
        const bTime = new Date(b.completedAt ?? b.scheduledAt).getTime();
        return bTime - aTime;
      }),
    }));
}

/** "Wed, 24 Sep 2026" — date only, for a record heading. */
export function formatRecordDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "Wed, 24 Sep 2026, 09:00" — date and time, for an appointment. */
export function formatAppointmentWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
