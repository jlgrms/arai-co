import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Button variants.
 *
 * CONTRAST CONSTRAINT: coral (#FF7F50) fails WCAG AA for small text — with
 * either ink or white — at small-text scale. Therefore the default `variant`
 * is ink-filled, never coral. The `cta` variant is the ONLY place coral is used
 * as a solid fill, and it is deliberately large + bold (text-base/font-bold
 * ≈ 16px, and always used at large sizes on the single most prominent CTA per
 * screen). The `destructive` variant uses the danger tint/text tokens
 * (#FFE4D9 / #B34A1F) which DO pass AA, rather than shadcn's usual red small
 * text.
 *
 * CTA TEXT COLOUR (brand ref v2, confirmed decision #1): the cta variant takes
 * WHITE text/icon on coral. This measures below the strict AA 4.5:1/3:1
 * thresholds (≈2.4:1) and is an accepted, deliberate tradeoff scoped ONLY to
 * this variant at hero/CTA scale. It does NOT extend to small coral text
 * (badges, the 13px card button), which stays on ink-on-coral / AA-safe
 * combinations. Do not copy `text-white` onto other coral usage.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        // Ink is the default solid/interactive color everywhere.
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-surface text-ink hover:bg-muted',
        secondary: 'bg-green-tint text-green-text hover:bg-green-tint/80',
        ghost: 'text-ink hover:bg-muted',
        link: 'text-ink underline-offset-4 hover:underline',
        // Coral only for the single hero CTA. Large + bold enforced here.
        // White text/icon is the confirmed v2 tradeoff — this variant only.
        cta: 'bg-accent text-white text-base font-bold hover:bg-accent/90',
        // AA-safe destructive styling (danger tint/text), not red.
        destructive: 'bg-danger-tint text-danger-text hover:bg-danger-tint/80',
      },
      size: {
        default: 'h-9 px-4 py-2 text-sm',
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
