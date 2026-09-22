// Error mapping for the admin console.
//
// Envelope (apps/backend/src/common/filters/all-exceptions.filter.ts):
//   { statusCode, error, message, path, timestamp } — `message` is ALWAYS a string.
//
// The admin routes are ADMIN-only behind JwtAuthGuard + RolesGuard, so the
// interesting failure modes are not validation-shaped like the patient/doctor
// forms — they are authorisation and existence:
//   401  token missing/expired
//   403  signed in but not an admin (e.g. a demoted account, stale token)
//   404  the target user/appointment/doctor no longer exists
//   400  a business refusal — notably "Cannot change the state of an admin
//        account", which is a real rule the admin should see verbatim rather
//        than a generic failure
//   409  state conflict (used by the consultation state machine elsewhere)
//
// There is no per-field validation on this surface, so unlike
// doctor-api-errors.ts this returns a single message rather than a field map.
// Pretending otherwise would invent form fields that do not exist.

import { ApiError } from '@/lib/api-client';

export interface ParsedAdminError {
  /** Rendered in the alert region or toast. */
  message: string;
  statusCode: number;
  /** 401 — the session is gone; the only fix is signing in again. */
  isUnauthenticated: boolean;
  /** 403 — signed in without the required role. Retrying cannot help. */
  isForbidden: boolean;
  /** 404 — the target is gone; refreshing the list is the right next move. */
  isMissing: boolean;
  /** True when retrying the identical request could plausibly succeed. */
  retryable: boolean;
}

export function parseAdminError(err: unknown, fallback: string): ParsedAdminError {
  if (!(err instanceof ApiError)) {
    return {
      message: fallback,
      statusCode: 0,
      isUnauthenticated: false,
      isForbidden: false,
      isMissing: false,
      retryable: true,
    };
  }

  // Network failure / backend unreachable — api-client surfaces status 0.
  if (err.statusCode === 0) {
    return {
      message: err.message,
      statusCode: 0,
      isUnauthenticated: false,
      isForbidden: false,
      isMissing: false,
      retryable: true,
    };
  }

  if (err.statusCode === 401) {
    return {
      message: 'Your session has expired. Please sign in again.',
      statusCode: 401,
      isUnauthenticated: true,
      isForbidden: false,
      isMissing: false,
      retryable: false,
    };
  }

  if (err.statusCode === 403) {
    return {
      // The server's own wording, because a 403 here has a precise meaning
      // (not an administrator) that is more useful than anything generic.
      message: err.message,
      statusCode: 403,
      isUnauthenticated: false,
      isForbidden: true,
      isMissing: false,
      retryable: false,
    };
  }

  if (err.statusCode === 404) {
    return {
      message: err.message,
      statusCode: 404,
      isUnauthenticated: false,
      isForbidden: false,
      isMissing: true,
      retryable: false,
    };
  }

  // 400 / 409 — a deliberate refusal. Surface the server's words verbatim; they
  // name the actual rule (e.g. the admin-account guard) and are actionable.
  return {
    message: err.message,
    statusCode: err.statusCode,
    isUnauthenticated: false,
    isForbidden: false,
    isMissing: false,
    retryable: err.statusCode >= 500,
  };
}
