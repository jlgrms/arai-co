import logoLight from '@/assets/arai-logo-mark-light.png';
import logoOutline from '@/assets/arai-logo-mark-outline.png';
import { cn } from '@/lib/utils';

/**
 * ARAI.co logo mark — now a real image asset (see arai-brand-design-reference.md v2).
 *
 * Two variants, both transparent PNGs (no colored badge/square backdrop needed):
 *  - "light"   (default): solid black crying-face lockup, for light/white backgrounds
 *    (header, footer, public/auth screens).
 *  - "outline": thin-outline crying-face lockup, for the dark navy sidebar context,
 *    where a solid black face reads too heavy at small sizes.
 *
 * The source art is a wide mark+wordmark lockup (1312x464, ~2.83:1), so we size by
 * HEIGHT and let the intrinsic aspect ratio determine the width (`w-auto`).
 */

const LOGO_SRC = {
  light: logoLight,
  outline: logoOutline,
} as const;

export type LogoVariant = keyof typeof LOGO_SRC;

/** Height classes per context size. Width follows the intrinsic aspect ratio. */
const HEIGHT_BY_SIZE = {
  sm: 'h-[26px]',
  md: 'h-[38px]',
  lg: 'h-[46px]',
} as const;

export type LogoSize = keyof typeof HEIGHT_BY_SIZE;

export interface BrandLogoProps {
  /** Visual variant. Defaults to the light/black mark. */
  variant?: LogoVariant;
  /** Render size. Contexts: sidebar ~sm, header ~md/lg, footer smaller. */
  size?: LogoSize;
  /** Accessible name; the image is decorative when wrapped in a labelled link. */
  alt?: string;
  className?: string;
}

/**
 * Full ARAI.co lockup (mark + wordmark) rendered from an image asset.
 * Used across header, sidebar, footer, and public/auth screens.
 */
export function BrandLogo({
  variant = 'light',
  size = 'md',
  alt = 'ARAI.co',
  className,
}: BrandLogoProps) {
  return (
    <img
      src={LOGO_SRC[variant]}
      alt={alt}
      className={cn('w-auto select-none', HEIGHT_BY_SIZE[size], className)}
      draggable={false}
    />
  );
}
