// Maps the backend's single error envelope onto a message for the discovery
// list. Discovery is read-only and has no per-field validation, so there are no
// field errors to distribute — only a list-level message.
//
// Envelope (apps/backend/src/common/filters/all-exceptions.filter.ts):
//   { statusCode, error, message, path, timestamp } — `message` is ALWAYS a string.
//
// We surface the BACKEND'S OWN message verbatim rather than hardcoding a
// substitute, so the UI reflects the real server response.

import { ApiError } from '@/lib/api-client';

export interface ParsedDiscoveryError {
  /** List-level message rendered in the alert region. */
  message: string;
  statusCode: number;
  /** True when retrying the same request could plausibly succeed. */
  retryable: boolean;
}

export function parseDiscoveryError(err: unknown): ParsedDiscoveryError {
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

  // 5xx is transient; 4xx is a bug we should not invite a retry for.
  return {
    message: err.message,
    statusCode: err.statusCode,
    retryable: err.statusCode >= 500,
  };
}
