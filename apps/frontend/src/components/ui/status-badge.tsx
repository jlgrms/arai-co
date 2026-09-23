import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Hourglass,
  RotateCcw,
  Video,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Status badges, with an icon.
 *
 * Per v3 a status badge is a pill carrying STATE, and the icon is not
 * decoration: it is the second, non-colour channel that keeps the state legible
 * for anyone who cannot separate the success/muted/danger tints. Colour alone
 * is never allowed to be the sole carrier (v3 accessibility), so every badge
 * here pairs a tint with a distinct glyph.
 *
 * Two families, deliberately kept in ONE module because they must stay
 * consistent with each other:
 *
 *  - `AppointmentStatusBadge` — the appointment lifecycle
 *    (BOOKED / RESCHEDULED / CANCELLED / COMPLETED). This is the coarse
 *    "did the booking happen" question.
 *  - `ConsultationStateBadge` — the live session lifecycle
 *    (SCHEDULED / JOINED / IN_PROGRESS / COMPLETED). This is the finer "where
 *    are we right now" question.
 *
 * They overlap on COMPLETED but are NOT the same axis: an appointment is
 * COMPLETED exactly when its session is, whereas a session is JOINED or
 * IN_PROGRESS while the appointment is still merely BOOKED. Keeping both
 * mappings here is what stops them drifting into two different colour
 * languages on two screens.
 *
 * No `danger` for any consultation state — a consultation in progress is never
 * an error. Danger is reserved for CANCELLED, which is a genuine "did not
 * happen".
 */

export type AppointmentStatus = 'BOOKED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED';
export type ConsultationState = 'SCHEDULED' | 'JOINED' | 'IN_PROGRESS' | 'COMPLETED';
export type StatusTone = 'success' | 'muted' | 'danger' | 'secondary';

/**
 * The single source of truth for how a status looks. Exported so non-badge
 * surfaces (the upcoming-appointment banner) can reuse the same tone decision
 * without re-deriving it and drifting.
 */
export const APPOINTMENT_STATUS_META: Record<
  AppointmentStatus,
  { label: string; tone: StatusTone; icon: LucideIcon }
> = {
  BOOKED: { label: 'Scheduled', tone: 'success', icon: Clock },
  RESCHEDULED: { label: 'Rescheduled', tone: 'success', icon: RotateCcw },
  CANCELLED: { label: 'Cancelled', tone: 'danger', icon: XCircle },
  COMPLETED: { label: 'Completed', tone: 'muted', icon: CheckCircle2 },
};

export const CONSULTATION_STATE_META: Record<
  ConsultationState,
  { label: string; tone: StatusTone; icon: LucideIcon }
> = {
  SCHEDULED: { label: 'Not started', tone: 'muted', icon: CircleDashed },
  JOINED: { label: 'Waiting for your doctor', tone: 'secondary', icon: Hourglass },
  IN_PROGRESS: { label: 'In progress', tone: 'success', icon: Video },
  COMPLETED: { label: 'Completed', tone: 'muted', icon: CheckCircle2 },
};

const TONE_VARIANT: Record<StatusTone, 'success' | 'muted' | 'danger' | 'secondary'> = {
  success: 'success',
  muted: 'muted',
  danger: 'danger',
  secondary: 'secondary',
};

interface StatusBadgeBaseProps {
  /** Optional extra classes — sizing tweaks only; the tone is not overridable. */
  className?: string;
}

/**
 * A pill for any status, given its tone/label/icon. Use the two named wrappers
 * below in preference to this unless you have a status that is genuinely
 * neither an appointment nor a consultation (e.g. a doctor's approval state).
 */
export function StatusBadge({
  tone,
  label,
  icon: Icon,
  className,
}: StatusBadgeBaseProps & { tone: StatusTone; label: string; icon: LucideIcon }) {
  return (
    <Badge variant={TONE_VARIANT[tone]} className={cn('gap-1.5', className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </Badge>
  );
}

export function AppointmentStatusBadge({
  status,
  className,
}: StatusBadgeBaseProps & { status: AppointmentStatus }) {
  const meta = APPOINTMENT_STATUS_META[status];
  if (!meta) return null;
  return (
    <StatusBadge tone={meta.tone} label={meta.label} icon={meta.icon} className={className} />
  );
}

export function ConsultationStateBadge({
  state,
  className,
}: StatusBadgeBaseProps & { state: ConsultationState }) {
  const meta = CONSULTATION_STATE_META[state];
  if (!meta) return null;
  return (
    <StatusBadge tone={meta.tone} label={meta.label} icon={meta.icon} className={className} />
  );
}

/**
 * Doctor-approval badge — the third status axis in the app (moderation, not
 * appointment). Lives here so all three read from one place.
 */
export function ApprovalStatusBadge({
  status,
  className,
}: StatusBadgeBaseProps & { status: 'PENDING' | 'APPROVED' | 'REJECTED' }) {
  const meta =
    status === 'APPROVED'
      ? { label: 'Approved', tone: 'success' as const, icon: CheckCircle2 }
      : status === 'REJECTED'
        ? { label: 'Rejected', tone: 'danger' as const, icon: XCircle }
        : { label: 'Pending review', tone: 'muted' as const, icon: AlertCircle };
  return (
    <StatusBadge tone={meta.tone} label={meta.label} icon={meta.icon} className={className} />
  );
}
