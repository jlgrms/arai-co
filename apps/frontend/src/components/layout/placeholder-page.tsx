import { PageHeader } from './page-header';

/**
 * Temporary screen body for routes whose real UI lands in a later sub-item.
 * Keeps the router complete and every shell reachable/verifiable now without
 * pretending the feature exists. Removed as each surface is implemented.
 */
export function PlaceholderPage({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">This screen is delivered in a later step.</p>
      </div>
    </div>
  );
}
