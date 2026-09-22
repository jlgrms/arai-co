import { Link } from 'react-router-dom';

import { BrandLogo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

/**
 * PLACEHOLDER public surfaces. The real Product Website (Layer 9) and auth
 * screens (sub-item 3) replace these. They exist now so the router is complete
 * and guard redirects land somewhere real and verifiable.
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
        <Link to="/" aria-label="aray.co! home">
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
        aray.co! — prototype for demonstration only. Not for real medical use.
      </footer>
    </div>
  );
}

export function PublicHomePlaceholder() {
  return (
    <PublicFrame>
      <h1 className="font-heading text-4xl font-bold text-ink">
        Care that starts with how you feel.
      </h1>
      <p className="mt-4 max-w-xl text-base text-muted-foreground">
        aray.co! connects you with the right doctor, lets you book in moments, and keeps your
        consultation history in one place.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild variant="cta" size="xl">
          <Link to="/register">Get started</Link>
        </Button>
        <Button asChild variant="outline" size="xl">
          <Link to="/login">I already have an account</Link>
        </Button>
      </div>
    </PublicFrame>
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
