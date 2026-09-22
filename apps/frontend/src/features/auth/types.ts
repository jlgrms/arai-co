// Shared auth types. Mirrors the backend contract (apps/backend/src/auth) —
// keep in sync with AuthService.issueToken() response shape.

export type Role = 'PATIENT' | 'DOCTOR' | 'ADMIN';

export type AccountState = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

/** Response body of POST /auth/login and POST /auth/register/(patient|doctor). */
export interface AuthResponse {
  accessToken: string;
  userId: string;
  role: Role;
}

/** Decoded identity the frontend keeps about the signed-in user. */
export interface AuthUser {
  userId: string;
  role: Role;
}

export interface RegisterPatientInput {
  email: string;
  password: string;
  name: string;
  contactDetails?: string;
}

export interface RegisterDoctorInput {
  email: string;
  password: string;
  name: string;
  specialization: string;
  biography?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}
