/**
 * Mirrors the backend's PATIENT_PROFILE_SELECT (apps/backend/src/patients/
 * patients.service.ts) — the exact shape GET/PATCH /patients/me returns.
 *
 * `birthday` is a date-only value (`@db.Date` in Prisma). The backend serialises
 * it as an ISO string; we treat it as `YYYY-MM-DD` and never round-trip it
 * through a local-time Date, which would shift the day in negative-UTC offsets.
 */
export interface PatientProfile {
  id: string;
  userId: string;
  name: string;
  /** Date-only, `YYYY-MM-DD`, or null when unset. */
  birthday: string | null;
  /** Metric, kg. Null when unset. */
  weight: number | null;
  /** Metric, cm. Null when unset. */
  height: number | null;
  contactDetails: string | null;
  basicMedicalHistory: string | null;
  /** Server-generated from name — read-only in the UI (no upload, no file storage). */
  avatarInitialsOrRef: string | null;
}

/**
 * Partial update body for PATCH /patients/me. Every field optional, matching
 * UpdatePatientProfileDto. Only changed fields are sent so an untouched field
 * is never overwritten.
 */
export interface UpdatePatientProfileInput {
  name?: string;
  /** `YYYY-MM-DD`. */
  birthday?: string;
  weight?: number;
  height?: number;
  contactDetails?: string;
  basicMedicalHistory?: string;
}
