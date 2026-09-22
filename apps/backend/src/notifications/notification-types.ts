// Notification type discriminators (sub-item 8).
// Stored as a plain String on Notification.type (C4: `string type`), not a DB
// enum — this keeps the discriminator extensible without a migration.
export const NotificationType = {
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  APPOINTMENT_RESCHEDULED: 'APPOINTMENT_RESCHEDULED',
  APPOINTMENT_CANCELLED: 'APPOINTMENT_CANCELLED',
} as const;

export type NotificationTypeValue =
  (typeof NotificationType)[keyof typeof NotificationType];