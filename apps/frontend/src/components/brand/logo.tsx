import { cn } from '@/lib/utils';

/**
 * aray.co! logo mark — minimalist "T^T" crying-eyes icon.
 * Two short scrunched-eye strokes + two teardrops. No face outline, no mouth.
 * Inline SVG (not an emoji character) so it scales and recolors cleanly.
 * Reused across header, sidebar, and footer via <BrandMark />.
 */
export function TtcIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="aray.co! mark"
      className={cn('h-full w-full', className)}
      fill="none"
    >
      {/* scrunched eyes (left + right), drawn as short angled strokes */}
      <path d="M16 26 L26 20" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M48 26 L38 20" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      {/* teardrops */}
      <path
        d="M18 38 C18 38 13.5 43.5 13.5 46.5 C13.5 49 15.5 51 18 51 C20.5 51 22.5 49 22.5 46.5 C22.5 43.5 18 38 18 38 Z"
        fill="currentColor"
      />
      <path
        d="M46 38 C46 38 41.5 43.5 41.5 46.5 C41.5 49 43.5 51 46 51 C48.5 51 50.5 49 50.5 46.5 C50.5 43.5 46 38 46 38 Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Red rounded-square badge wrapping the mark. The single sanctioned
 * non-CTA use of red: a brand element, not interactive text.
 */
export function BrandBadge({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dims = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12',
  }[size];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg bg-accent p-1.5 text-ink-foreground',
        dims,
        className,
      )}
    >
      <TtcIcon />
    </span>
  );
}

/** Full lockup: badge + wordmark. */
export function BrandLogo({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BrandBadge size={size} />
      <span className="font-heading text-lg font-bold tracking-tight text-ink">aray.co!</span>
    </span>
  );
}
