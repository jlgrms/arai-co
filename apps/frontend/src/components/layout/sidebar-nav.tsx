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
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive ? 'bg-ink text-ink-foreground' : 'text-ink hover:bg-muted',
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
