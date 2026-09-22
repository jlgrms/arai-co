import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm text-ink shadow-small transition-colors duration-200',
          'placeholder:text-muted-foreground',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-[invalid=true]:border-status-danger aria-[invalid=true]:ring-status-danger/30',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
