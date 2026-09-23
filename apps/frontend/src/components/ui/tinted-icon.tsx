import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Icon in a coloured circle — the app's standard "personality" mark.
 *
 * v3 lists the supporting tints (mint / peach / yellow / light-blue) as the
 * permitted fills for icon containers, and explicitly allows them as
 * decorative/supporting geometry while forbidding them as body text. So: the
 * tint is always the FILL, and the glyph on top is always an ink-family colour
 * that clears contrast against it. The tint never carries meaning on its own —
 * it is chosen for rhythm across a screen, not as a status signal (status uses
 * <StatusBadge>, which pairs colour with an icon deliberately).
 *
 * `mint` is the default because it is the brand's warmest neutral and reads as
 * the house style; the others are for varying a row of them.
 */

const TONE_CLASSES = {
  mint: 'bg-green-tint text-green-text',
  peach: 'bg-danger-tint text-danger-text',
  yellow: 'bg-yellow/35 text-ink',
  blue: 'bg-blue/12 text-blue',
} as const;

export type IconTone = keyof typeof TONE_CLASSES;

const SIZE_CLASSES = {
  sm: 'size-8 [&_svg]:size-4',
  md: 'size-11 [&_svg]:size-5',
  lg: 'size-14 [&_svg]:size-7',
} as const;

export type IconSize = keyof typeof SIZE_CLASSES;

export interface TintedIconProps {
  icon: LucideIcon;
  tone?: IconTone;
  size?: IconSize;
  className?: string;
}

/** Decorative: always aria-hidden, because the adjacent heading carries meaning. */
export function TintedIcon({ icon: Icon, tone = 'mint', size = 'md', className }: TintedIconProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full',
        TONE_CLASSES[tone],
        SIZE_CLASSES[size],
        className,
      )}
    >
      <Icon strokeWidth={2} />
    </span>
  );
}

/**
 * An icon-in-a-circle heading row.
 *
 * The pairing is the point: v3 asks for icons next to section headers, and
 * putting the icon in a tint is what keeps a heading row from reading as plain
 * text with a stray glyph. Falls back to `h2` so a screen that omits the level
 * still gets a sensible outline.
 */
export function IconHeading({
  icon,
  tone = 'mint',
  size = 'sm',
  level: Level = 'h2',
  children,
  className,
}: {
  icon: LucideIcon;
  tone?: IconTone;
  size?: IconSize;
  level?: 'h2' | 'h3';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <TintedIcon icon={icon} tone={tone} size={size === 'sm' ? 'sm' : size} />
      <Level className="font-heading text-lg font-semibold text-ink">{children}</Level>
    </div>
  );
}
