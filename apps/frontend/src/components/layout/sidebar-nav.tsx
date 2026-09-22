import { NavLink } from 'react-router-dom';

import { cn } from '@/lib/utils';
import type { NavItem } from '@/app/nav';

interface SidebarNavProps {
  items: NavItem[];
  /** Called after a navigation (used to close the mobile drawer). */
  onNavigate?: () => void;
}

/**
 * Primary nav list. Rendered both in the persistent desktop rail and inside
 * the mobile overlay drawer — same items, same active styling, one component.
 *
 * CONTRAST (dark navy sidebar, per approved dashboard mockup):
 *  - active   = light "cutout" pill: #FFFFFF bg, #132B3E text (ink-foreground / ink)
 *  - inactive = translucent light text: rgba(255,255,255,0.75), transparent bg
 * The sidebar is always bg-ink, so these tokens are fixed rather than
 * theme-dependent. Hover uses a faint light wash that stays AA-legible.
 */
export function SidebarNav({ items, onNavigate }: SidebarNavProps) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-foreground/70',
                isActive
                  ? 'bg-ink-foreground text-ink'
                  : 'text-ink-foreground/75 hover:bg-ink-foreground/10 hover:text-ink-foreground',
              )
            }
          >
            <Icon className="size-[18px] shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
