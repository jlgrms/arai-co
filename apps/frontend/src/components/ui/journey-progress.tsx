import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A horizontal progress track — filled circles joined by a connecting line.
 *
 * This is the ONE progress pattern for the product, extracted from the booking
 * flow's step indicator so the patient journey reads as a single continuous
 * thing rather than as several unrelated screens. Any screen that advances a
 * patient through ordered steps should render this, not a bespoke variant.
 *
 * Semantics it gets right on purpose:
 *  - `current` is the index of the step being worked on, not the number done.
 *    A step is COMPLETE when its index is below `current`, so the last step is
 *    complete only when the flow has actually passed it.
 *  - The current step is marked `aria-current="step"`, the completed ones are
 *    announced as done via visually-hidden text ("Step 2 of 3, completed"),
 *    so the state is not carried by colour alone (v3 accessibility).
 *  - The connector ahead of the current step is untinted; behind it is filled.
 *    That is what makes the track read as "real" progress rather than a row of
 *    numbered labels.
 */
export interface JourneyStep {
  /** Short label under the circle, e.g. "Schedule". */
  label: string;
}

export function JourneyProgress({
  steps,
  current,
  className,
  /** Compact reduces the label size for sidebars/tight columns. */
  compact = false,
}: {
  steps: JourneyStep[];
  current: number;
  className?: string;
  compact?: boolean;
}) {
  return (
    <ol
      className={cn('flex items-start', className)}
      aria-label={`Step ${Math.min(current + 1, steps.length)} of ${steps.length}`}
    >
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const last = index === steps.length - 1;
        return (
          <li
            key={step.label}
            className={cn('flex min-w-0 flex-1 flex-col items-center gap-2', !last && 'pr-0')}
            aria-current={active ? 'step' : undefined}
          >
            {/* Circle + connector share a row so the line meets each circle's
                centre rather than floating between them. */}
            <div className="flex w-full items-center">
              {/* Left connector: hidden on the first circle. */}
              <span
                aria-hidden
                className={cn(
                  'h-[3px] flex-1 rounded-full',
                  index === 0 ? 'bg-transparent' : done || active ? 'bg-accent' : 'bg-border',
                )}
              />
              <span
                aria-hidden
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border-2 text-[11px] font-bold transition-colors duration-200',
                  done && 'border-accent bg-accent text-white',
                  active && 'border-accent bg-surface text-accent',
                  !done && !active && 'border-border bg-surface text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              {/* Right connector: hidden on the last circle. */}
              <span
                aria-hidden
                className={cn(
                  'h-[3px] flex-1 rounded-full',
                  last ? 'bg-transparent' : done ? 'bg-accent' : 'bg-border',
                )}
              />
            </div>

            <span
              className={cn(
                'text-center font-medium leading-tight',
                compact ? 'text-[11px]' : 'text-xs',
                done || active ? 'text-ink' : 'text-muted-foreground',
              )}
            >
              {step.label}
              <span className="sr-only">
                {done ? ', completed' : active ? ', current step' : ', not started'}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
