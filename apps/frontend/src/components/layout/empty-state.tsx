import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Optional call-to-action (e.g. a Button). */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Shared empty-state block for every list/table view (§6: empty states are part
 * of the deliverable). Consistent across appointments, doctors, notifications,
 * audit log. Screens supply their own icon and copy.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-heading text-base font-semibold text-ink">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
