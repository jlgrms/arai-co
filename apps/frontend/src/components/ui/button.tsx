import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Button variants.
 *
 * CONTRAST CONSTRAINT: coral (#FF705B) fails WCAG AA for small text — with
 * either ink or white — at small-text scale. Therefore the default `variant`
 * is ink-filled, never coral. The `cta` variant is the ONLY place coral is used
 * as a solid fill, and it is deliberately large + bold (text-base/font-bold
 * ≈ 16px, and always used at large sizes on the single most prominent CTA per
 * screen). The `destructive` variant uses the danger tokens
 * (--accent-peach fill / --status-danger text) which DO pass AA, rather than
 * shadcn's usual red small text.
 *
 * CTA TEXT COLOUR (brand ref v3, confirmed decision #1): the cta variant takes
 * WHITE text/icon on coral. This measures below the strict AA 4.5:1/3:1
 * thresholds (≈2.9:1 on white) and is an accepted, deliberate tradeoff scoped
 * ONLY to this variant at hero/CTA scale. It does NOT extend to small coral
 * text (badges, the 13px card button), which stays on ink-on-coral / AA-safe
 * combinations. Do not copy `text-white` onto other coral usage.
 *
 * Interaction states (v3 requires default/hover/focus/active/disabled):
 * `active` was previously absent; each variant now darkens on press rather
 * than relying on hover alone. `cta` presses to --brand-coral-dark instead of
 * an opacity shift, because alpha on coral desaturates it against the page.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        // Ink is the default solid/interactive color everywhere.
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        outline: 'border border-border bg-surface text-ink hover:bg-muted active:bg-muted/80',
        secondary:
          'bg-green-tint text-green-text hover:bg-green-tint/80 active:bg-green-tint/70',
        ghost: 'text-ink hover:bg-muted active:bg-muted/80',
        link: 'text-ink underline-offset-4 hover:underline active:opacity-80',
        // Coral only for the single hero CTA. Large + bold enforced here.
        // White text/icon is the confirmed v3 tradeoff — this variant only.
        cta: 'bg-accent text-white text-base font-bold hover:bg-coral-dark active:bg-coral-dark/90',
        // AA-safe destructive styling (danger tint/text), not red.
        destructive:
          'bg-danger-tint text-danger-text hover:bg-danger-tint/80 active:bg-danger-tint/70',
      },
      size: {
        default: 'h-9 rounded-md px-4 py-2 text-sm',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6 text-base',
        // Paired with `cta` so red always renders large/bold.
        xl: 'h-12 rounded-lg px-8 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
