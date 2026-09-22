// Audit action + affected-record discriminators (sub-item 9).
// Stored as plain strings on AuditLog.action / AuditLog.affectedRecordType
// (C4: `string action`, `string affectedRecordType`) — kept as a shared constant
// object so every admin write path emits a consistent shape rather than
// five independently-invented inline literals.
export const AuditAction = {
  USER_STATE_CHANGE: 'USER_STATE_CHANGE',
  DOCTOR_APPROVAL_UPDATE: 'DOCTOR_APPROVAL_UPDATE',
  APPOINTMENT_CANCEL: 'APPOINTMENT_CANCEL',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

// The kind of record an audit entry points at (AuditLog.affectedRecordId).
export const AuditedRecordType = {
  USER: 'USER',
  DOCTOR_PROFILE: 'DOCTOR_PROFILE',
  APPOINTMENT: 'APPOINTMENT',
} as const;

export type AuditedRecordTypeValue =
  (typeof AuditedRecordType)[keyof typeof AuditedRecordType];