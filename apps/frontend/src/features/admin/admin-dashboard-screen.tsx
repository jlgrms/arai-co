import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { fetchDashboard } from './admin-api';
import { parseAdminError, type ParsedAdminError } from './admin-api-errors';
import {
  buildSections,
  findInconsistencies,
  manageableUserCount,
  sectionTitle,
  type AdminDashboard,
  type DashboardBucket,
  type DashboardSection,
} from './admin-dashboard-types';

/**
 * Layer 8 sub-item 4 — Admin operational dashboard.
 *
 * `GET /admin/dashboard`, ADMIN-only, no parameters. The route pre-exists from
 * Layer 4 sub-item 9; this screen adds no backend.
 *
 * THIS IS THE ADMIN LANDING PAGE. HOME_BY_ROLE.ADMIN is '/admin' and the nav
 * item is marked `end`, so every admin session opens here. That makes the
 * loading and error states load-bearing rather than boilerplate: the first thing
 * an admin sees must never be an unrecoverable blank. A failure renders the
 * message and a retry button in place, never a bare skeleton that never resolves.
 *
 * ZERO-COALESCING IS THE POINT OF THIS SCREEN'S DATA LAYER. The endpoint's
 * groupBy maps omit any value with no rows — the live payload has no
 * RESCHEDULED, no PENDING, no REJECTED, no SUSPENDED key at all. Rendering the
 * map directly would leave those tiles blank, which an operator reads as "failed
 * to load" rather than "none". buildSections iterates the FULL enum and pulls
 * each count through countOf, so every bucket renders, zero or not, in a stable
 * order. See admin-dashboard-types.
 *
 * AN INCOHERENT PAYLOAD IS SURFACED, NOT HIDDEN. The four counts and the four
 * groupBys are separate untransacted queries, so a write landing between them can
 * make a section's total disagree with its own buckets. Silently rendering either
 * number would conceal a real read inconsistency, so a mismatch is called out.
 * Only single-dimension sections are checked — the users section spans two
 * dimensions and would flag permanently (see findInconsistencies).
 */
export function AdminDashboardScreen() {
  const [data, setData] = React.useState<AdminDashboard | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedAdminError | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchDashboard(controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setData(payload);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        setError(parseAdminError(err, 'Could not load the dashboard. Please try again.'));
        setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken]);

  const sections = React.useMemo(() => (data ? buildSections(data) : []), [data]);
  const inconsistencies = React.useMemo(() => findInconsistencies(sections), [sections]);
  const manageable = data ? manageableUserCount(data) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Operational counts across users, doctors, appointments, and consultations."
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => setReloadToken((n) => n + 1)}
          >
            Refresh
          </Button>
        }
      />

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>
                {error.isForbidden ? 'Not permitted' : "Couldn't load the dashboard"}
              </AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
            <Button type="button" variant="outline" onClick={() => setReloadToken((n) => n + 1)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <DashboardSkeleton />
      ) : data ? (
        <>
          {inconsistencies.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden />
              <AlertTitle>
                {inconsistencies.length === 1
                  ? '1 section does not add up'
                  : `${inconsistencies.length} sections do not add up`}
              </AlertTitle>
              <AlertDescription>
                The headline total and the breakdown are read by separate queries, so a
                change landing between them can make them disagree. Affected:{' '}
                {inconsistencies
                  .map((i) => `${sectionTitle(sections, i.sectionId)} (${i.summed} of ${i.total})`)
                  .join(', ')}
                . Refreshing will usually settle it.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                footnote={section.id === 'users' ? userFootnote(manageable, data) : undefined}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * One section: headline total, breakdown tiles, and a link to the section root.
 *
 * The link carries NO query param (Flag 4). None of the destination screens read
 * a URL filter, so a link that appeared to filter would land on an unfiltered
 * list — the tiles are navigational to the section, not to the subset.
 */
function SectionCard({ section, footnote }: { section: DashboardSection; footnote?: string }) {
  return (
    <Card data-testid={`admin-dashboard-section-${section.id}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="font-heading text-lg">{section.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{section.description}</p>
        </div>
        <div className="shrink-0 text-right">
          <div
            className="font-heading text-3xl font-semibold tabular-nums text-ink"
            data-testid={`admin-dashboard-total-${section.id}`}
          >
            {section.total}
          </div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {section.buckets.map((bucket) => (
            <BucketTile key={bucket.key} bucket={bucket} sectionId={section.id} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
          <div className="min-w-0">
            <Link
              to={section.href}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {section.linkLabel}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            {footnote && <p className="mt-1 text-xs text-muted-foreground">{footnote}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * A single labelled count.
 *
 * The number is rendered through countOf upstream, so a bucket with no rows
 * shows a real "0" rather than an empty element. That distinction is the whole
 * reason this screen does not map over Object.keys(payload).
 */
function BucketTile({ bucket, sectionId }: { bucket: DashboardBucket; sectionId: string }) {
  return (
    <div
      className="flex min-w-[8.5rem] flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2"
      data-testid={`admin-dashboard-bucket-${sectionId}-${bucket.key}`}
    >
      <span className="text-xs text-muted-foreground">{bucket.label}</span>
      <span
        className="font-heading text-xl font-semibold tabular-nums text-ink"
        data-bucket-count={bucket.count}
      >
        {bucket.count}
      </span>
    </div>
  );
}

/**
 * Explains the one honest discrepancy on this screen.
 *
 * `users.total` counts every account including administrators, while
 * GET /admin/users filters to PATIENT/DOCTOR. So the dashboard says 11 and the
 * Users screen lists 10, and both are correct. Naming the difference beside the
 * link stops an operator reading it as a bug.
 */
function userFootnote(manageable: number, data: AdminDashboard): string {
  const admins = data.users.total - manageable;
  if (admins <= 0) {
    return 'The Users screen lists patient and doctor accounts.';
  }
  return `The Users screen lists ${manageable} of these — the other ${
    admins === 1 ? '1 is an administrator' : `${admins} are administrators`
  }.`;
}

/** Skeleton that mirrors the real four-card grid, so the layout does not jump. */
function DashboardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2].map((j) => (
                <Skeleton key={j} className="h-16 w-36" />
              ))}
            </div>
            <Skeleton className="h-4 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
