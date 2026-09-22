/**
 * Notification message composition (Layer 7 sub-item 5).
 *
 * WHY THIS EXISTS
 * Appointment notifications previously interpolated a raw `Date.toISOString()`
 * into user-facing prose, producing rows like:
 *
 *   Appointment booked with Dr. Camila Reyes on 2026-09-23T09:00:00.000Z
 *
 * `2026-09-23T09:00:00.000Z` is a machine string, not a time a patient or a
 * clinician should ever be shown. Every other surface in the product renders
 * times through the client's `formatAppointmentWhen` ("Wed, 23 Sep 2026, 09:00").
 * The notification list was the one place that leaked the wire format, because
 * the message is composed here on the server rather than in the browser.
 *
 * WHY IT IS NOT FORMATTED PER-USER
 * The obvious fix — format it nicely — is the wrong one to attempt here. Two
 * reasons, both structural:
 *
 *   1. The server has no locale. `toLocaleString` in Node falls back to the
 *      host's default locale and timezone, so "09:00" would silently mean
 *      whatever the container is set to. A patient in another timezone would be
 *      told the wrong time, with no indication that it was wrong.
 *   2. The message is STORED, not rendered. Formatting at write time bakes one
 *      particular rendering into the row forever; the correct fix (a structured
 *      time field the client formats) needs a schema change, and the C4 entity
 *      for Notification carries only `string message` — Notification, AuditLog
 *      and SymptomSpecialtyMap are the frozen leaf tables.
 *
 * So this renders in UTC, explicitly and unambiguously labelled. `2026-09-23
 * 09:00 UTC` cannot be misread as local time, which the previous string could —
 * `Z` is meaningless to most readers, and its absence would be worse.
 *
 * KNOWN LIMITATION, recorded rather than hidden: times are shown in UTC, not the
 * reader's timezone. Fixing that properly means carrying the instant as data on
 * the notification and formatting in the client. That is a schema change, out of
 * scope for a message-content defect, and is flagged for the hardening pass.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Render an instant for human eyes, in UTC.
 *
 * Deliberately not `toLocaleString` — see the note above on the server having no
 * locale. The output shape mirrors the client's `formatAppointmentWhen` as
 * closely as a locale-free format can: day, month, year, then 24h time.
 *
 *   2026-09-23T09:00:00.000Z -> "23 Sep 2026, 09:00 UTC"
 */
export function formatInstantForNotification(instant: Date): string {
  const day = String(instant.getUTCDate());
  const month = MONTHS[instant.getUTCMonth()];
  const year = instant.getUTCFullYear();
  const hours = String(instant.getUTCHours()).padStart(2, '0');
  const minutes = String(instant.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}

/**
 * Message builders for the three appointment events.
 *
 * Each is built PER-RECIPIENT, because each party must be told about the OTHER
 * one. The subject is the counterparty's name, so the same builder produces
 * "Dr. Camila Reyes" for the patient and the patient's name for the doctor.
 */
export function bookingConfirmedMessage(
  counterpartyName: string,
  scheduledAt: Date,
): string {
  return `Appointment booked with ${counterpartyName} on ${formatInstantForNotification(scheduledAt)}`;
}

export function appointmentRescheduledMessage(
  counterpartyName: string,
  newScheduledAt: Date,
): string {
  return `Appointment with ${counterpartyName} rescheduled to ${formatInstantForNotification(newScheduledAt)}`;
}

export function appointmentCancelledMessage(
  counterpartyName: string,
  wasScheduledAt: Date,
): string {
  return `Appointment with ${counterpartyName} on ${formatInstantForNotification(wasScheduledAt)} was cancelled`;
}

/**
 * Message for an admin-initiated cancellation.
 *
 * Distinct from the patient-initiated one because the reason differs — the
 * recipient is told who cancelled, which the patient-initiated flow gets wrong
 * if reused verbatim (there, the recipient IS the other party; here, neither
 * recipient cancelled). Notifies both the doctor and the patient, each naming
 * the actor.
 */
export function adminCancelledMessage(
  wasScheduledAt: Date,
): string {
  return `Appointment on ${formatInstantForNotification(wasScheduledAt)} was cancelled by an administrator`;
}
