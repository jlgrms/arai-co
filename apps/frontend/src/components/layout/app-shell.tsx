import * as React from 'react';
import { X } from 'lucide-react';

import { NAV_BY_ROLE } from '@/app/nav';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand/logo';
import { useAuth } from '@/features/auth/auth-context';
import { AppHeader } from './app-header';
import { SidebarNav } from './sidebar-nav';

/**
 * Persistent authenticated app shell.
 *
 * RESPONSIVE BEHAVIOUR (confirmed in sub-item 1): the sidebar is a fixed rail
 * at >= lg and collapses to an overlay drawer below it. The rail is always
 * present in the layout at lg+, so there is no layout shift when the drawer
 * opens on smaller viewports.
 *
 * The shell renders ONLY for an authenticated user — the surrounding route
 * guard ensures <Outlet/> is the matched role surface.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Guard exists upstream, but the shell must be self-safe.
  const role = user?.role ?? 'PATIENT';
  const items = NAV_BY_ROLE[role];
  const showNotifications = role === 'PATIENT' || role === 'DOCTOR';

  // Lock body scroll while the mobile drawer is open.
  React.useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // Escape closes the drawer (accessibility).
  React.useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Persistent desktop rail (lg+) — dark navy per approved mockup. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-ink-foreground/[0.14] bg-ink lg:flex">
        <div className="flex h-14 items-center border-b border-ink-foreground/[0.14] px-4">
          {/* Outline variant: thin-outline face reads better than the solid black
              mark against the dark navy sidebar (per brand ref v2). */}
          <BrandLogo variant="outline" size="sm" />
          <span className="ml-2.5 font-heading text-sm font-extrabold tracking-tight text-ink-foreground">
            <span className="text-accent">ARAI</span>.CO
          </span>
        </div>
        <SidebarNav items={items} />
      </aside>

      {/* Mobile overlay drawer (below lg) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col bg-ink shadow-lg">
            <div className="flex h-14 items-center justify-between border-b border-ink-foreground/[0.14] px-4">
              <span className="flex items-center">
                <BrandLogo variant="outline" size="sm" />
                <span className="ml-2.5 font-heading text-sm font-extrabold tracking-tight text-ink-foreground">
                  <span className="text-accent">ARAI</span>.CO
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                className="text-ink-foreground hover:bg-ink-foreground/10 hover:text-ink-foreground"
                onClick={() => setDrawerOpen(false)}
              >
                <X />
              </Button>
            </div>
            <SidebarNav items={items} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          role={role}
          onOpenNav={() => setDrawerOpen(true)}
          showNotifications={showNotifications}
        />
        <main className="flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
