// Maps the backend's single error envelope onto a message for the guided
// matching screen.
//
// CRITICAL DISTINCTION: "no doctors matched your symptom" is NOT an error.
// The backend returns HTTP 200 with empty arrays for an unmatchable symptom,
// and the screen renders a distinct, reassuring empty state for it. This module
// only handles genuine failures (network down, 401, 5xx). Conflating the two
// would tell a worried patient that something broke when in fact the system
// worked correctly and simply needs them to try different words.
//
// Envelope (apps/backend/src/common/filters/all-exceptions.filter.ts):
//   { statusCode, error, message, path, timestamp } — `message` is ALWAYS a string.

import { ApiError } from '@/lib/api-client';

export interface ParsedMatchError {
  /** Message rendered in the alert region. */
  message: string;
  statusCode: number;
  /** True when retrying the same request could plausibly succeed. */
  retryable: boolean;
}

export function parseMatchError(err: unknown): ParsedMatchError {
  if (!(err instanceof ApiError)) {
    return {
      message: 'Something went wrong. Please try again.',
      statusCode: 0,
      retryable: true,
    };
  }

  // Network failure / backend unreachable — the api-client surfaces status 0.
  if (err.statusCode === 0) {
    return { message: err.message, statusCode: 0, retryable: true };
  }

  // 401 is handled by the route guard's session logic; surface it plainly.
  if (err.statusCode === 401) {
    return {
      message: 'Your session has expired. Please sign in again.',
      statusCode: 401,
      retryable: false,
    };
  }

  // 400 means the request itself was rejected (e.g. a missing symptom param).
  // Retrying the identical request cannot fix that.
  if (err.statusCode === 400) {
    return { message: err.message, statusCode: 400, retryable: false };
  }

  // 5xx is transient; other 4xx is a bug we should not invite a retry for.
  return {
    message: err.message,
    statusCode: err.statusCode,
    retryable: err.statusCode >= 500,
  };
}
