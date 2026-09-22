/**
 * Mirrors the backend's DOCTOR_PUBLIC_SELECT
 * (apps/backend/src/doctors/doctors.service.ts) — the exact shape
 * GET /doctors returns. No passwordHash, no user internals.
 *
 * Only APPROVED doctors are ever returned; see `DoctorPublic.approvalStatus`.
 * The field is present in the payload but the UI does not render it — an
 * unapproved doctor is not listed at all, so a status chip would be noise.
 */
export interface DoctorPublic {
  id: string;
  userId: string;
  name: string;
  biography: string | null;
  specialization: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
}

/**
 * Query filters for GET /doctors. All optional and combinable (AND).
 * The backend omits a filter when its value is blank.
 */
export interface DoctorDiscoveryFilters {
  /** Case-insensitive substring over name OR biography. */
  search?: string;
  /** Exact, case-insensitive specialization match. */
  specialization?: string;
}

/**
 * Build the query string for GET /doctors, dropping blank filters so we never
 * send `?search=` (the backend treats blank as absent anyway, but omitting it
 * keeps the request honest and the URL shareable).
 */
export function buildDiscoveryQuery(filters: DoctorDiscoveryFilters): string {
  const params = new URLSearchParams();
  const search = filters.search?.trim();
  const specialization = filters.specialization?.trim();
  if (search) params.set('search', search);
  if (specialization) params.set('specialization', specialization);
  const qs = params.toString();
  return qs ? `/doctors?${qs}` : '/doctors';
}
