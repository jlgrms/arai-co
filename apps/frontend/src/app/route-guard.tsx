import { UserRound } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { BrandLogo } from '@/components/brand/logo';
import { useAuth } from '@/features/auth/auth-context';
import type { Role } from '@/features/auth/types';
import { HOME_BY_ROLE, LOGIN_PATH } from './nav';

/**
 * Startup / auth-resolution state. Shown while the persisted session is being
 * validated against the backend (AuthProvider.initializing). Deliberately
 * minimal and centered so there is never an unstyled flash of guarded content.
 */
export function AuthLoadingScreen() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background"
      role="status"
      aria-live="polite"
    >
      <BrandLogo />
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <UserRound className="size-4 animate-pulse" aria-hidden />
        Loading your session…
      </p>
    </div>
  );
}

interface RequireRoleProps {
  /** The role(s) allowed to render the nested routes. */
  allow: Role[];
}

/**
 * Client-side route guard.
 *
 * IMPORTANT — this is NOT the security boundary. Every protected API call is
 * still authorized server-side by NestJS RBAC; this guard only prevents
 * rendering a surface a user cannot use, and provides early redirect UX.
 *
 * Outcomes:
 *  - Auth still resolving  → loading screen (no guarded content, no flash)
 *  - No session            → redirect to /login, preserving intended path
 *  - Session, wrong role   → redirect to that user's own home
 *  - Session, allowed role → render <Outlet/>
 */
export function RequireRole({ allow }: RequireRoleProps) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) return <AuthLoadingScreen />;

  if (!user) {
    return <Navigate to={LOGIN_PATH} replace state={{ from: location.pathname }} />;
  }

  if (!allow.includes(user.role)) {
    return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
  }

  return <Outlet />;
}
