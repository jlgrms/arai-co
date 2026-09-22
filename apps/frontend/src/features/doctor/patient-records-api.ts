// API calls backing the doctor's patient-records screens (Layer 7 sub-item 3).
//
// Two reads, one per screen:
//   GET /appointments/me                                  -> the doctor's OWN feed
//   GET /consultations/records/patient/:patientProfileId  -> that patient's records
//
// The patient id for the second call is NEVER minted here — it is the `id` of a
// `patientProfile` the server already attached to the doctor's own appointment
// feed. That feed is participant-scoped by the API, so every id in it is one the
// server has already vouched belongs to this doctor. The records endpoint then
// re-checks the doctor/patient appointment relation and answers 403 otherwise
// ("You have no appointments with this patient"), so the scoping is enforced
// server-side twice over; nothing here is a security boundary.

import { api } from '@/lib/api-client';
import type { Appointment } from '@/features/patient/booking-types';
import type { DoctorPatientRecord } from './patient-records-types';

/** The doctor's own appointments, both sides joined by the API. */
export function fetchMyAppointments(signal?: AbortSignal): Promise<Appointment[]> {
  return api.get<Appointment[]>('/appointments/me', { signal });
}

/**
 * Records for one patient, from this doctor's perspective.
 *
 * `patientProfileId` must come from the doctor's own appointment feed. It is
 * interpolated raw because it is always a server-issued UUID; `encodeURIComponent`
 * guards against a malformed value ever reaching the path segment regardless.
 */
export function fetchPatientRecords(
  patientProfileId: string,
  signal?: AbortSignal,
): Promise<DoctorPatientRecord[]> {
  return api.get<DoctorPatientRecord[]>(
    `/consultations/records/patient/${encodeURIComponent(patientProfileId)}`,
    { signal },
  );
}
