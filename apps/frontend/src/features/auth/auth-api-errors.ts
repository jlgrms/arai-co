// Maps the backend's single error envelope (apps/backend/src/common/filters/
// all-exceptions.filter.ts) onto per-field + form-level messages the auth
// screens render.
//
// Envelope: { statusCode, error, message, path, timestamp } — `message` is
// ALWAYS a string. Validation failures put class-validator's constraint
// messages in one string, joined with '; ' (e.g.
// "email must be an email; password must be longer than or equal to 8 characters").

import { ApiError } from '@/lib/api-client';

export interface FieldErrors {
  email?: string;
  password?: string;
  name?: string;
  specialization?: string;
  contactDetails?: string;
  biography?: string;
}

export interface ParsedAuthError {
  /** Field-scoped messages extracted from a 400 validation response. */
  fields: FieldErrors;
  /** Form-level message for the alert region (auth failures, 409, 403, 5xx). */
  form: string | null;
  statusCode: number;
}

/**
 * class-validator constraint strings look like "<field> <phrase>". We map the
 * leading token back to the form field so the error lands under the right input.
 */
const FIELD_NAMES: ReadonlyArray<keyof FieldErrors> = [
  'email',
  'password',
  'name',
  'specialization',
  'contactDetails',
  'biography',
];

function splitConstraint(message: string): { field: keyof FieldErrors; text: string } | null {
  const match = FIELD_NAMES.find((field) => message.startsWith(`${field} `));
  return match ? { field: match, text: message } : null;
}

export function parseAuthError(err: unknown): ParsedAuthError {
  if (!(err instanceof ApiError)) {
    return {
      fields: {},
      form: 'Something went wrong. Please try again.',
      statusCode: 0,
    };
  }

  // Network failure — the api-client surfaces status 0.
  if (err.statusCode === 0) {
    return { fields: {}, form: err.message, statusCode: 0 };
  }

  // 400: validation — distribute constraint messages onto their fields.
  if (err.statusCode === 400) {
    const fields: FieldErrors = {};
    const unassigned: string[] = [];
    for (const part of err.message.split('; ')) {
      const split = splitConstraint(part);
      if (split) {
        fields[split.field] = split.text;
      } else {
        unassigned.push(part);
      }
    }
    return {
      fields,
      // Anything that could not be attributed to a field is shown form-level.
      form: unassigned.length > 0 ? unassigned.join('; ') : null,
      statusCode: 400,
    };
  }

  // 401 invalid credentials / 403 suspended-or-deactivated / 409 duplicate email
  // all carry a human-readable `message` -> show it in the form alert.
  return { fields: {}, form: err.message, statusCode: err.statusCode };
}

export function hasFieldErrors(fields: FieldErrors): boolean {
  return Object.values(fields).some((v) => Boolean(v));
}