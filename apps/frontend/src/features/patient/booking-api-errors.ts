// Maps the backend's error envelope onto messages for the booking surfaces.
//
// The important case here is the CONFLICT (409). It is not a crash — it is the
// system correctly refusing a double-booking, and it is the one booking error
// the patient can act on (pick a different slot). So it is flagged separately
// (`isConflict`) and the UI offers a concrete next step instead of a bare
// "something went wrong".
//
// Envelope (apps/backend/src/common/filters/all-exceptions.filter.ts):
//   { statusCode, error, message, path, timestamp } — `message` is ALWAYS a string.

import { ApiError } from '@/lib/api-client';

export interface ParsedBookingError {
  /** Message rendered in the alert region. */
  message: string;
  statusCode: number;
  /**
   * True for 409 — the slot is blocked, already taken, or overlaps. The patient
   * should choose another slot; the server message says which case it was.
   */
  isConflict: boolean;
  /** True when the patient's chosen slot no longer exists (server 404). */
  isMissingSlot: boolean;
  /** True when retrying the identical request could plausibly succeed. */
  retryable: boolean;
}

export function parseBookingError(err: unknown): ParsedBookingError {
  if (!(err instanceof ApiError)) {
    return {
      message: 'Something went wrong. Please try again.',
      statusCode: 0,
      isConflict: false,
      isMissingSlot: false,
      retryable: true,
    };
  }

  // Network failure / backend unreachable — the api-client surfaces status 0.
  if (err.statusCode === 0) {
    return {
      message: err.message,
      statusCode: 0,
      isConflict: false,
      isMissingSlot: false,
      retryable: true,
    };
  }

  if (err.statusCode === 401) {
    return {
      message: 'Your session has expired. Please sign in again.',
      statusCode: 401,
      isConflict: false,
      isMissingSlot: false,
      retryable: false,
    };
  }

  if (err.statusCode === 403) {
    return {
      message: err.message,
      statusCode: 403,
      isConflict: false,
      isMissingSlot: false,
      retryable: false,
    };
  }

  // 409 — genuine booking conflict. Surface the server's own wording (it
  // distinguishes blocked / already-booked / overlapping) and mark it actionable.
  if (err.statusCode === 409) {
    return {
      message: err.message,
      statusCode: 409,
      isConflict: true,
      isMissingSlot: false,
      // Retrying the SAME slot will fail identically; a different slot may work,
      // which the UI expresses by keeping the picker available.
      retryable: false,
    };
  }

  // 404 — the slot was withdrawn or the appointment is gone. Refreshing the list
  // is the right next move, not retrying this request.
  if (err.statusCode === 404) {
    return {
      message: err.message,
      statusCode: 404,
      isConflict: false,
      isMissingSlot: true,
      retryable: false,
    };
  }

  // 400 — rejected outright (e.g. rescheduling a cancelled appointment).
  if (err.statusCode === 400) {
    return {
      message: err.message,
      statusCode: 400,
      isConflict: false,
      isMissingSlot: false,
      retryable: false,
    };
  }

  return {
    message: err.message,
    statusCode: err.statusCode,
    isConflict: false,
    isMissingSlot: false,
    retryable: err.statusCode >= 500,
  };
}
