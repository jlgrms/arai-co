/**
 * Medical records (Layer 6 sub-item 6) — types and pure helpers.
 *
 * Contract mirrors the backend:
 *   `GET /consultations/records/me` -> MedicalRecord[]
 *
 * RBAC NOTE — there is deliberately NO patient id anywhere in this module, and
 * no function takes one. The backend derives the patient from the JWT and the
 * route is PATIENT-only (@Roles), so the client cannot ask for another
 * patient's records even if it wanted to; a cross-patient request is rejected
 * 403 at the role guard before any query runs (verified live). Adding a
 * `patientId` parameter here would create the very capability the API refuses,
 * so the scoping stays entirely server-side rather than being re-implemented
 * (and potentially got wrong) on the client.
 *
 * The endpoint already returns ONLY COMPLETED sessions, in completedAt-desc
 * order, with the doctor pre-joined. These helpers must not re-derive any of
 * that — they only format and aggregate what the server decided.
 */

export interface MedicalRecordNote {
  id: string;
  sessionId: string;
  findings: string | null;
  recommendations: string | null;
  recordedAt: string;
}

export interface MedicalRecordPrescription {
  id: string;
  sessionId: string;
  details: string;
  issuedAt: string;
}

/**
 * One completed consultation. Note this is a FLATTENED shape — not the nested
 * ConsultationSession used by the workspace. The backend deliberately projects
 * just what a history view needs (doctor name + specialization as plain
 * strings), so no client-side join against the doctor list is required.
 */
export interface MedicalRecord {
  sessionId: string;
  completedAt: string;
  doctorName: string | null;
  specialization: string | null;
  notes: MedicalRecordNote[];
  prescriptions: MedicalRecordPrescription[];
}

/** Total notes + prescriptions across all records. */
export function countEntries(records: MedicalRecord[]): number {
  return records.reduce((sum, r) => sum + r.notes.length + r.prescriptions.length, 0);
}

/** Distinct specializations the patient has consulted, alphabetically. */
export function distinctSpecializations(records: MedicalRecord[]): string[] {
  const found = new Set<string>();
  for (const r of records) {
    if (r.specialization) found.add(r.specialization);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/**
 * `doctorName` and `specialization` are nullable in the contract (the backend
 * uses `?? null` because a doctor profile may be absent). A history view that
 * renders "null" or a blank line looks broken, so the fallback is resolved
 * here, in one place.
 */
export function doctorLabel(record: MedicalRecord): string {
  return record.doctorName ?? 'Doctor unavailable';
}

export function specializationLabel(record: MedicalRecord): string | null {
  return record.specialization ?? null;
}

/** Group records by calendar year, newest first, for a long history. */
export interface RecordYearGroup {
  year: string;
  records: MedicalRecord[];
}

export function groupRecordsByYear(records: MedicalRecord[]): RecordYearGroup[] {
  // Preserve the server's completedAt-desc order rather than re-sorting, so the
  // page and the API agree on what "most recent" means.
  const groups = new Map<string, MedicalRecord[]>();
  for (const record of records) {
    const year = String(new Date(record.completedAt).getFullYear());
    const bucket = groups.get(year);
    if (bucket) bucket.push(record);
    else groups.set(year, [record]);
  }
  return [...groups.entries()].map(([year, recs]) => ({ year, records: recs }));
}

/**
 * A record is "empty" when the consultation produced neither a note nor a
 * prescription. That is a legitimate outcome (a short consult), and it should
 * read as such rather than as missing data.
 */
export function isEmptyRecord(record: MedicalRecord): boolean {
  return record.notes.length === 0 && record.prescriptions.length === 0;
}

/** True when the patient has no completed consultations at all. */
export function hasNoRecords(records: MedicalRecord[]): boolean {
  return records.length === 0;
}

/** Full date for a history entry, e.g. "Thu, 17 Sep 2026". */
export function formatRecordDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
