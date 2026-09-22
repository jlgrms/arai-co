import * as React from 'react';
import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { parseDiscoveryError, type ParsedDiscoveryError } from './discover-api-errors';
import { buildDiscoveryQuery, type DoctorDiscoveryFilters, type DoctorPublic } from './discover-types';

/**
 * Debounce for the search box. Search runs server-side (it covers the whole
 * approved set, not just what's on screen), so each keystroke would be a
 * request without this. 300ms is short enough to feel immediate.
 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * "All specialties" sentinel. A native <select> needs a non-empty value for the
 * unfiltered state; the empty string is what we map back to "no filter".
 */
const ALL_SPECIALTIES = '';

/** Initials for the avatar fallback — mirrors the server's generated-initials rule. */
function initialsFor(name: string): string {
  const parts = name
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '—';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Loading state — three card placeholders so the list doesn't jump on arrival. */
function DoctorListSkeleton() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i}>
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function DoctorCard({ doctor }: { doctor: DoctorPublic }) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-start gap-3">
          <Avatar className="size-12">
            <AvatarFallback>{initialsFor(doctor.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate font-heading text-base font-semibold text-ink">{doctor.name}</p>
            <Badge variant="secondary">{doctor.specialization}</Badge>
          </div>
        </div>

        <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">
          {doctor.biography ?? 'No biography provided yet.'}
        </p>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          asChild
        >
          <Link to={`/patient/book/${doctor.id}`}>View availability</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Layer 6 sub-item 2 — Doctor discovery (browse/search/filter).
 *
 * Lists APPROVED doctors from GET /doctors with a server-side search (name or
 * biography) and a specialization filter. Both compose with each other.
 *
 * Doctor data is public-by-design (no per-user scoping beyond "approved"), so
 * there is no role branching here — the route guard already limits this screen
 * to patients.
 */
export function DiscoverDoctorsScreen() {
  const [doctors, setDoctors] = React.useState<DoctorPublic[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedDiscoveryError | null>(null);

  // The raw input value updates on every keystroke; `search` is the debounced
  // value that actually drives the request.
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [specialization, setSpecialization] = React.useState(ALL_SPECIALTIES);

  // Specialization options accumulate from every unfiltered fetch, so the
  // dropdown doesn't shrink to only the currently-matching specialty once a
  // filter is applied (which would trap the user in their own filter).
  const [knownSpecialties, setKnownSpecialties] = React.useState<string[]>([]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = React.useCallback(
    async (filters: DoctorDiscoveryFilters, signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<DoctorPublic[]>(buildDiscoveryQuery(filters), { signal });
        setDoctors(data);
        // Only widen the option list from a result set that itself had no
        // filters — otherwise a filtered fetch would re-seed it with a subset.
        if (!filters.search?.trim() && !filters.specialization?.trim()) {
          setKnownSpecialties((prev) => {
            const next = new Set(prev);
            for (const d of data) next.add(d.specialization);
            return [...next].sort((a, b) => a.localeCompare(b));
          });
        }
      } catch (err: unknown) {
        // Abort is intentional cleanup (debounce superseded / unmount), not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.isUnauthorized) {
          setError(parseDiscoveryError(err));
          setDoctors([]);
          return;
        }
        setError(parseDiscoveryError(err));
        setDoctors([]);
      } finally {
        // A superseded request must not clear the newest one's spinner.
        if (!signal?.aborted) setLoading(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load({ search, specialization }, controller.signal);
    return () => controller.abort();
  }, [load, search, specialization]);

  const hasFilters = Boolean(search.trim() || specialization.trim());

  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setSpecialization(ALL_SPECIALTIES);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover doctors"
        description="Browse our approved doctors, or search by name and specialty."
      />

      <Card>
        <CardContent className="grid gap-4 p-6 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="doctor-search">Search</Label>
            <Input
              id="doctor-search"
              name="search"
              type="search"
              placeholder="Search by doctor name or biography…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2 sm:w-64">
            <Label htmlFor="specialty-filter">Specialty</Label>
            <select
              id="specialty-filter"
              name="specialization"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm text-ink shadow-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <option value={ALL_SPECIALTIES}>All specialties</option>
              {knownSpecialties.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Couldn&apos;t load doctors</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
            {error.retryable && (
              <Button
                type="button"
                onClick={() => void load({ search, specialization })}
              >
                Try again
              </Button>
            )}
          </CardContent>
        </Card>
      ) : loading ? (
        <DoctorListSkeleton />
      ) : doctors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="space-y-1">
              <p className="font-heading text-base font-semibold text-ink">
                {hasFilters ? 'No doctors match your filters' : 'No doctors available yet'}
              </p>
              <p className="text-sm text-muted-foreground">
                {hasFilters
                  ? 'Try a different name or specialty, or clear your filters.'
                  : 'Approved doctors will appear here once they are added.'}
              </p>
            </div>
            {hasFilters && (
              <Button type="button" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <section className="space-y-4" aria-live="polite">
          <p className="text-sm text-muted-foreground">
            {doctors.length} {doctors.length === 1 ? 'doctor' : 'doctors'}
            {hasFilters ? ' found' : ' available'}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {doctors.map((doctor) => (
              <li key={doctor.id}>
                <DoctorCard doctor={doctor} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
