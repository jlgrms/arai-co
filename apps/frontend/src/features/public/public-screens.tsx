import { Link } from 'react-router-dom';

import { BrandLogo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

/**
 * Public fallback surfaces.
 *
 * The real Product Website (Layer 9) now lives in `landing-screen.tsx` and owns
 * `/`. `PublicHomePlaceholder`, which this module used to provide, was retired
 * when the real landing page shipped — it was a stand-in for exactly one screen
 * and keeping it would leave a second, drifting answer to "what is the home
 * page". What remains here is the not-found surface plus the frame it shares.
 *
 * No bell/sidebar on public surfaces (confirmed in scope).
 */

function PublicFrame({
  children,
  showNav = true,
}: {
  children: React.ReactNode;
  showNav?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-6">
        <Link to="/" aria-label="ARAI.co home">
          <BrandLogo />
        </Link>
        {showNav && (
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/register">Register</Link>
            </Button>
          </nav>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
        {children}
      </main>
      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        ARAI.co — prototype for demonstration only. Not for real medical use.
      </footer>
    </div>
  );
}

export function NotFoundPlaceholder() {
  return (
    <PublicFrame>
      <div className="space-y-4 text-center">
        <h1 className="font-heading text-2xl font-semibold text-ink">Page not found</h1>
        <p className="text-sm text-muted-foreground">That page doesn&apos;t exist.</p>
        <Button asChild variant="outline">
          <Link to="/">Go to home</Link>
        </Button>
      </div>
    </PublicFrame>
  );
}
