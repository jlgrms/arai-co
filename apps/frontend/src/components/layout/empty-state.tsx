import type { LucideIcon } from 'lucide-react';

import { TintedIcon, type IconTone } from '@/components/ui/tinted-icon';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Optional call-to-action (e.g. a Button). */
  action?: React.ReactNode;
  className?: string;
  /**
   * Tint for the icon circle. Defaults to mint (the house tone). Vary it when
   * several empty states appear on one screen, or to suit the moment — a
   * reassuring "you're healthy" state reads better in mint than in the
   * warning-adjacent peach.
   */
  tone?: IconTone;
  /** Small line above the title, e.g. "Wala pang laman". */
  eyebrow?: string;
}

/**
 * Shared empty-state block for every list/table view (§6: empty states are part
 * of the deliverable). Consistent across appointments, doctors, notifications,
 * audit log. Screens supply their own icon and copy.
 *
 * The icon now sits in a tinted circle rather than a flat grey one. v3's
 * guidance is that empty states get a personality touch rather than a bare
 * "no data" line, and the tint is the lightest-touch way to do that without
 * inventing a new component: the structure and copy slots are unchanged, so
 * existing call sites keep working as-is.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = 'mint',
  eyebrow,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      <TintedIcon icon={Icon} tone={tone} size="lg" />
      <div className="space-y-1">
        {eyebrow && (
          <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <p className="font-heading text-base font-semibold text-ink">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
