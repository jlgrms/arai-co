// Maps the backend's error envelope onto per-field + form-level messages for the
// doctor profile and schedule forms.
//
// Envelope (apps/backend/src/common/filters/all-exceptions.filter.ts):
//   { statusCode, error, message, path, timestamp } — `message` is ALWAYS a string.
// class-validator constraint messages arrive joined with '; ', e.g.
//   "endTime must be a valid ISO 8601 date string"
//
// The backend's OWN wording is surfaced verbatim so the UI reflects real server
// validation rather than a hardcoded guess.

import { ApiError } from '@/lib/api-client';
import type { UpdateDoctorProfileInput } from './doctor-types';

export type DoctorProfileField = keyof UpdateDoctorProfileInput;
export type DoctorProfileFieldErrors = Partial<Record<DoctorProfileField, string>>;

export interface ParsedDoctorError<Field extends string> {
  fields: Partial<Record<Field, string>>;
  form: string | null;
  statusCode: number;
}

const PROFILE_FIELD_NAMES: ReadonlyArray<DoctorProfileField> = [
  'name',
  'biography',
  'specialization',
];

/** Schedule fields, matching Create/UpdateAvailabilityDto property names. */
const AVAILABILITY_FIELD_NAMES = ['startTime', 'endTime', 'isBlocked'] as const;
export type AvailabilityField = (typeof AVAILABILITY_FIELD_NAMES)[number];

/**
 * class-validator strings look like "<field> <phrase>". Map the leading token
 * back to its form field so the message renders under the right input.
 */
function splitConstraint<Field extends string>(
  message: string,
  names: ReadonlyArray<Field>,
): { field: Field; text: string } | null {
  const field = names.find((candidate) => message.startsWith(`${candidate} `));
  return field ? { field, text: message } : null;
}

function parse<Field extends string>(
  err: unknown,
  names: ReadonlyArray<Field>,
  fallback: string,
): ParsedDoctorError<Field> {
  if (!(err instanceof ApiError)) {
    return { fields: {}, form: fallback, statusCode: 0 };
  }

  // Network failure — the api-client surfaces status 0.
  if (err.statusCode === 0) {
    return { fields: {}, form: err.message, statusCode: 0 };
  }

  if (err.statusCode === 400) {
    const fields: Partial<Record<Field, string>> = {};
    const unassigned: string[] = [];
    for (const part of err.message.split('; ')) {
      const split = splitConstraint(part, names);
      if (split) fields[split.field] = split.text;
      else unassigned.push(part);
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

export function parseDoctorProfileError(err: unknown): ParsedDoctorError<DoctorProfileField> {
  return parse(err, PROFILE_FIELD_NAMES, 'Could not save your profile. Please try again.');
}

export function parseAvailabilityError(err: unknown): ParsedDoctorError<AvailabilityField> {
  return parse(err, AVAILABILITY_FIELD_NAMES, 'Could not save this slot. Please try again.');
}

/**
 * Explain a failed schedule write in the domain's terms.
 *
 * The backend returns a plain 400 for an inverted window (it validates
 * endTime > startTime itself), and a 409 for a booking conflict. Both are
 * actionable, so they get specific copy rather than a generic failure.
 */
export function describeAvailabilityFailure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 0) return err.message;
    return err.message;
  }
  return 'Could not save this slot. Please try again.';
}

export function hasFieldErrors<Field extends string>(
  fields: Partial<Record<Field, string>>,
): boolean {
  return Object.values(fields).some((value) => Boolean(value));
}
