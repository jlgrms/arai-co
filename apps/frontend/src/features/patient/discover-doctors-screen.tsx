import * as React from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, Check, SearchX, SlidersHorizontal, Stethoscope } from 'lucide-react';

import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { type IconTone } from '@/components/ui/tinted-icon';
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

/**
 * Tints cycled across the doctor grid.
 *
 * Purely decorative — this is rhythm, not meaning. A screen of six identical
 * white cards with identical grey avatars has no visual entry point, and the
 * v3 supporting tints exist precisely to break that up. Deliberately keyed off
 * the card's position rather than the doctor's name so it never implies
 * anything about the doctor (specialty is already stated explicitly below).
 */
const AVATAR_TONES: IconTone[] = ['mint', 'peach', 'yellow', 'blue'];

/**
 * Tint-fill + matching ink for each avatar. Kept local rather than read from
 * TintedIcon's map because an AvatarFallback needs the tint WITHOUT the fixed
 * circle sizing TintedIcon imposes — same palette, different container.
 */
const TINT_FALLBACK: Record<IconTone, string> = {
  mint: 'bg-green-tint text-green-text',
  peach: 'bg-danger-tint text-danger-text',
  yellow: 'bg-yellow/35 text-ink',
  blue: 'bg-blue/12 text-blue',
};

function DoctorCard({ doctor, index }: { doctor: DoctorPublic; index: number }) {
  const tone = AVATAR_TONES[index % AVATAR_TONES.length];
  return (
    <Card
      // `group/doctor` scopes the child button's hover style to THIS card, so
      // hovering one card never lights up its neighbours' buttons.
      //
      // Hover: a 1px lift plus a deepened shadow, and the border picks up the
      // brand coral. v3 asks for "subtle elevation or 1px hover movement" —
      // both together is the sanctioned amount, not a big scale transform.
      // `motion-reduce` drops the movement but keeps the colour cue, so the
      // affordance survives for reduced-motion users.
      className="group/doctor h-full transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-card motion-reduce:hover:translate-y-0"
    >
      <CardContent className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-start gap-3">
          <Avatar className="size-12">
            <AvatarFallback className={cn(TINT_FALLBACK[tone])}>
              {initialsFor(doctor.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate font-heading text-base font-semibold text-ink">{doctor.name}</p>
            <Badge variant="secondary" className="gap-1.5">
              <Stethoscope className="size-3.5 shrink-0" aria-hidden />
              {doctor.specialization}
            </Badge>
          </div>
        </div>

        <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">
          {doctor.biography ?? 'Wala pang bio si Doc — pero ready mag-alaga.'}
        </p>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full transition-colors group-hover/doctor:border-accent group-hover/doctor:text-accent"
          asChild
        >
          <Link to={`/patient/book/${doctor.id}`}>
            <CalendarCheck className="size-4" aria-hidden />
            View availability
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * One selectable specialty chip.
 *
 * Deliberately NOT the `secondary` Badge variant: this is a control, so it
 * needs hover, focus-visible and a pressed fill. The selected state is a solid
 * ink pill with a check glyph — ink rather than coral because the chip is a
 * filter, and v3 reserves coral for primary actions. A long specialty name is
 * allowed to size the chip (`whitespace-nowrap`) so the row scrolls rather than
 * each chip wrapping to two lines.
 */
function SpecialtyChip({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected
          ? 'border-ink bg-ink text-white'
          : 'border-border bg-surface text-ink hover:border-accent hover:bg-green-tint/40',
      )}
    >
      {selected && <Check className="size-3.5 shrink-0" strokeWidth={3} aria-hidden />}
      {label}
    </button>
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
        {/* The specialty <select> that used to live here has moved out to the
            chip row below. A native select hid the available specialties behind
            a click, which meant a patient could not see that (say) Sleep
            Medicine existed unless they went looking. The chips make the full
            roster visible and the active filter legible at a glance. */}
        <CardContent className="p-6">
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
        </CardContent>
      </Card>

      {/* Specialty filter chips.
          These replace the old <select>. The chips are the SELECTED state the
          design brief called out: an unselected chip is a quiet outline, the
          selected one is a filled ink pill with a check, so "which filter am I
          in" is answerable at a glance rather than by reading a dropdown's
          value. `aria-pressed` carries the same state to assistive tech, so the
          fill is not the only signal.
          Horizontal scroll on narrow screens keeps them on one line instead of
          wrapping into a block that pushes the results down. */}
      {knownSpecialties.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-ink">Specialty</p>
          </div>
          <ul
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
            aria-label="Filter by specialty"
          >
            <li>
              <SpecialtyChip
                label="All"
                selected={specialization === ALL_SPECIALTIES}
                onSelect={() => setSpecialization(ALL_SPECIALTIES)}
              />
            </li>
            {knownSpecialties.map((s) => (
              <li key={s}>
                <SpecialtyChip
                  label={s}
                  selected={specialization === s}
                  onSelect={() => setSpecialization(s)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

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
        /* Two genuinely different empty states, and the copy says so.
           Filtered-out is a dead end the patient created and can undo, so it
           gets the search glyph and an explicit escape hatch. "No doctors yet"
           is an empty roster they did nothing to cause, so it must not read as
           their mistake or as a broken screen. */
        hasFilters ? (
          <EmptyState
            icon={SearchX}
            tone="peach"
            eyebrow="Walang nahanap"
            title="Walang doctor na tumugma sa filters mo"
            description="Try a different name or specialty — or clear the filters to see everyone available."
            action={
              <Button type="button" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Stethoscope}
            eyebrow="Wala pang laman"
            title="No doctors available yet"
            description="Wala pang naipasang doktor sa ngayon. Approved doctors appear here as soon as they're added — balik ka ulit mamaya."
          />
        )
      ) : (
        <section className="space-y-4" aria-live="polite">
          <p className="text-sm text-muted-foreground">
            {doctors.length} {doctors.length === 1 ? 'doctor' : 'doctors'}
            {hasFilters ? ' found' : ' available'}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {doctors.map((doctor, index) => (
              <li key={doctor.id}>
                <DoctorCard doctor={doctor} index={index} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
