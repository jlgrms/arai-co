// Maps the backend's single error envelope onto per-field + form-level messages
// for the patient profile form.
//
// Envelope (apps/backend/src/common/filters/all-exceptions.filter.ts):
//   { statusCode, error, message, path, timestamp } — `message` is ALWAYS a string.
// class-validator constraint messages arrive joined with '; ', e.g.
//   "weight must not be less than 0"
//
// We surface the BACKEND'S OWN message verbatim (never a hardcoded substitute)
// so the UI reflects real server validation rather than a guess.

import { ApiError } from '@/lib/api-client';
import type { UpdatePatientProfileInput } from './types';

export type ProfileField = keyof UpdatePatientProfileInput;

export type ProfileFieldErrors = Partial<Record<ProfileField, string>>;

export interface ParsedProfileError {
  /** Field-scoped messages extracted from a 400 validation response. */
  fields: ProfileFieldErrors;
  /** Form-level message for the alert region (network, 404, 5xx). */
  form: string | null;
  statusCode: number;
}

const FIELD_NAMES: ReadonlyArray<ProfileField> = [
  'name',
  'birthday',
  'weight',
  'height',
  'contactDetails',
  'basicMedicalHistory',
];

/**
 * class-validator strings look like "<field> <phrase>". Map the leading token
 * back to its form field so the message renders under the right input.
 */
function splitConstraint(message: string): { field: ProfileField; text: string } | null {
  const field = FIELD_NAMES.find((candidate) => message.startsWith(`${candidate} `));
  return field ? { field, text: message } : null;
}

export function parseProfileError(err: unknown): ParsedProfileError {
  if (!(err instanceof ApiError)) {
    return { fields: {}, form: 'Something went wrong. Please try again.', statusCode: 0 };
  }

  // Network failure — the api-client surfaces status 0.
  if (err.statusCode === 0) {
    return { fields: {}, form: err.message, statusCode: 0 };
  }

  if (err.statusCode === 400) {
    const fields: ProfileFieldErrors = {};
    const unassigned: string[] = [];
    for (const part of err.message.split('; ')) {
      const split = splitConstraint(part);
      if (split) {
        // Keep the backend's exact wording.
        fields[split.field] = split.text;
      } else {
        unassigned.push(part);
      }
    }
    return {
      fields,
      form: unassigned.length > 0 ? unassigned.join('; ') : null,
      statusCode: 400,
    };
  }

  // 404 profile missing, 403 wrong role / inactive account, 5xx, etc.
  return { fields: {}, form: err.message, statusCode: err.statusCode };
}

export function hasProfileFieldErrors(fields: ProfileFieldErrors): boolean {
  return Object.values(fields).some((value) => Boolean(value));
}
