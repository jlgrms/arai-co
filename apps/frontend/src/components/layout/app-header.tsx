import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Menu, UserRound } from 'lucide-react';

import { BrandLogo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/features/auth/auth-context';
import type { Role } from '@/features/auth/types';
import { HOME_BY_ROLE, PUBLIC_HOME_PATH } from '@/app/nav';
import { NotificationBell } from '@/features/notifications/notification-bell';

const ROLE_LABEL: Record<Role, string> = {
  PATIENT: 'Patient',
  DOCTOR: 'Doctor',
  ADMIN: 'Administrator',
};

function initials(userId: string): string {
  return userId.slice(0, 2).toUpperCase();
}

interface AppHeaderProps {
  role: Role;
  /** Toggles the mobile nav drawer (sidebar collapses below lg). */
  onOpenNav: () => void;
  /** Notification affordance — patient/doctor only, admin has none. */
  showNotifications: boolean;
}

/**
 * Persistent top bar for every authenticated shell. Thin by design: brand on
 * the left, mobile nav toggle, notifications, and the account menu. The role is
 * shown explicitly so a user always knows which surface they are in.
 */
export function AppHeader({ role, onOpenNav, showNotifications }: AppHeaderProps) {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  /**
   * Sign out, then land on the public marketing page.
   *
   * The navigation is explicit here rather than left to the route guard. The
   * guard DOES redirect an unauthenticated user, but to /login — correct for
   * someone who deep-links into a guarded route, wrong for someone who just
   * chose to sign out (they would be shown a sign-in form they deliberately
   * dismissed). Racing those two is also what makes the destination
   * order-dependent, so the intent is stated once, here, at the moment the user
   * expresses it.
   */
  function handleSignOut() {
    logout();
    navigate(PUBLIC_HOME_PATH, { replace: true });
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation menu"
        onClick={onOpenNav}
      >
        <Menu />
      </Button>

      <Link to={HOME_BY_ROLE[role]} aria-label="Go to your home">
        <BrandLogo size="sm" />
      </Link>

      <span className="hidden rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground sm:inline-block">
        {ROLE_LABEL[role]}
      </span>

      <div className="ml-auto flex items-center gap-1">
        {showNotifications && <NotificationBell />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account menu">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-[11px]">
                  {initials(user?.userId ?? 'ar')}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>{ROLE_LABEL[role]}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <UserRound /> Account settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
