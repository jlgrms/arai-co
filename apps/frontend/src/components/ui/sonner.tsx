import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * App Toaster. toast() is called directly from feature code.
 * Bundled/local styling only — no external service.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-right"
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border border-border bg-surface text-ink shadow-small',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
          error: 'border-transparent bg-danger-tint text-status-danger',
          success: 'border-transparent bg-success-tint text-status-success',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
