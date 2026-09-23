import * as React from 'react';
import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { JourneyProgress } from '@/components/ui/journey-progress';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { consumePendingConcern } from '@/features/public/concern-handoff';
import { parseMatchError, type ParsedMatchError } from './match-api-errors';
import { BOOKING_STEPS, MATCHING_STEP } from './booking-types';
import {
  buildMatchPath,
  groupDoctorsBySpecialty,
  isEmptyMatch,
  MATCH_AI_PATH,
  type MatchOption,
  type MatchOptionsResponse,
  type MatchResult,
} from './match-types';
import type { DoctorPublic } from './discover-types';

/** Initials for the avatar fallback — mirrors the discovery screen's rule. */
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

/**
 * A doctor inside a specialty group. Links to the slot picker for that doctor
 * (sub-item 4) — this is the hand-off from "who should I see" to "when".
 */
function MatchDoctorCard({ doctor }: { doctor: DoctorPublic }) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <Avatar className="size-11">
            <AvatarFallback>{initialsFor(doctor.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate font-heading text-base font-semibold text-ink">{doctor.name}</p>
            <p className="truncate text-xs text-muted-foreground">{doctor.specialization}</p>
          </div>
        </div>

        <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">
          {doctor.biography ?? 'No biography provided yet.'}
        </p>

        <Button type="button" variant="outline" size="sm" className="w-full" asChild>
          <Link to={`/patient/book/${doctor.id}`}>Select doctor</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function MatchSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g} className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-11 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-8 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Layer 6 sub-item 3 — Guided matching ("tell us how you feel").
 *
 * Two ways in, per the agreed design:
 *   1. A free-text field, which is the real path and accepts any wording.
 *   2. Quick-pick chips for common concerns, which fill the field and submit
 *      immediately (one tap instead of typing).
 *
 * The chips are loaded from GET /doctors/match/options, which derives them from
 * the seeded symptom→specialty table. They are NOT a hardcoded frontend list:
 * a chip that maps to no specialty would be a dead end, and hardcoding them
 * would silently drift from the matching table the backend actually uses.
 *
 * Results are grouped by matched specialty so it is clear why each doctor is
 * being shown. A successful match with no doctors renders a distinct,
 * non-error empty state pointing at discovery — an unmatchable symptom is a
 * normal outcome, not a failure.
 */
export function GuidedMatchingScreen() {
  const [symptom, setSymptom] = React.useState('');
  const [result, setResult] = React.useState<MatchResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<ParsedMatchError | null>(null);

  const [options, setOptions] = React.useState<MatchOption[]>([]);
  const [optionsLoading, setOptionsLoading] = React.useState(true);
  const [useAi, setUseAi] = React.useState(false);

  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  // Guards against a slow earlier match overwriting a newer one's results.
  const requestIdRef = React.useRef(0);

  // Load the suggestion chips once. Their failure is non-fatal: the free-text
  // path still works, so we degrade silently rather than blocking the screen.
  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await api.get<MatchOptionsResponse>('/doctors/match/options', {
          signal: controller.signal,
        });
        setOptions(data.options);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setOptions([]);
      } finally {
        if (!controller.signal.aborted) setOptionsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const runMatch = React.useCallback(async (raw: string, ai = false) => {
    const trimmed = raw.trim();
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      // POC: `ai` swaps the backend engine. Both return the same MatchResult
      // shape, so everything downstream (skeleton, error card, grouping,
      // empty state) is shared — there is no separate AI result UI.
      const data = ai
        ? await api.post<MatchResult>(MATCH_AI_PATH, { symptom: trimmed })
        : await api.get<MatchResult>(buildMatchPath(trimmed));
      if (requestId !== requestIdRef.current) return;
      setResult(data);
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;
      setError(parseMatchError(err));
      setResult(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  /**
   * Layer 9 handoff: if the user arrived from the public landing page's
   * quick-book widget, their concern is waiting in sessionStorage. Fire the REAL
   * match for it, once, and show the same result UI as a manually-typed query.
   *
   * `consumePendingConcern()` clears the key as it reads, which is what makes
   * this safe against re-entry: a remount, a back-navigation, or a refresh will
   * not silently re-run a stale query the user has already seen.
   *
   * This runs after mount rather than during it because `runMatch` is a
   * `useCallback` that writes state; calling it in the render body would be a
   * side effect during render.
   */
  React.useEffect(() => {
    const pending = consumePendingConcern();
    if (!pending) return;
    setSymptom(pending);
    void runMatch(pending);
  }, [runMatch]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!symptom.trim()) return;
    void runMatch(symptom, useAi);
  }

  /** One-tap path: fill the visible field, then match the chip's own phrase. */
  function handleChip(option: MatchOption) {
    setSymptom(option.symptom);
    void runMatch(option.symptom, useAi);
  }

  /**
   * POC: run the same typed symptom through the AI engine.
   *
   * Only offered once there is text to send. This is additive — the
   * deterministic "Match me with a doctor" path is unchanged and remains the
   * default, so a DeepSeek outage can never take the screen down.
   */
  function handleAiMatch() {
    if (!symptom.trim()) return;
    setUseAi(true);
    void runMatch(symptom, true);
  }

  /**
   * "Edit my symptom" — refocus and select the input, preserving the text.
   * Deliberately NOT labelled "try again": re-running the identical query
   * returns the identical empty result, so that would be a no-op dressed up as
   * an action. The patient's next move has to be changing the words.
   */
  function handleEditSymptom() {
    setResult(null);
    setError(null);
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  const groups = result ? groupDoctorsBySpecialty(result) : [];
  const noMatch = result !== null && isEmptyMatch(result);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Find the right doctor"
        description="Tell us how you're feeling and we'll match you with the right specialty."
      />

      {/* Step 1 of 3: the concern. The doctor and the time come next, and the
          same track carries through both of those screens. */}
      <JourneyProgress steps={[...BOOKING_STEPS]} current={MATCHING_STEP} />

      <Card>
        <CardContent className="space-y-5 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="symptom-input">What brings you in?</Label>
              <textarea
                id="symptom-input"
                name="symptom"
                ref={inputRef}
                rows={3}
                value={symptom}
                onChange={(e) => {
                  setSymptom(e.target.value);
                  // Any edit invalidates the AI/deterministic label on screen.
                  setUseAi(false);
                }}
                placeholder="Describe your symptom or concern, e.g. “persistent cough”…"
                className="flex w-full resize-y rounded-md border border-input bg-surface px-3 py-2 text-sm text-ink shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                autoComplete="off"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="cta" disabled={loading || !symptom.trim()}>
                {loading && !useAi ? 'Matching…' : 'Match me with a doctor'}
              </Button>
              {/* POC AI matching — additive; the deterministic path above is untouched. */}
              <Button
                type="button"
                variant="outline"
                onClick={handleAiMatch}
                disabled={loading || !symptom.trim()}
              >
                {loading && useAi ? 'Asking AI…' : 'Try AI matching'}
              </Button>
            </div>
          </form>

          {!optionsLoading && options.length > 0 && (
            <div className="space-y-2 border-t border-border pt-5">
              <p className="text-sm font-medium text-ink">Common concerns</p>
              <p className="text-xs text-muted-foreground">
                Pick one to match instantly, or describe it in your own words above.
              </p>
              <ul className="flex flex-wrap gap-2">
                {options.map((option) => (
                  <li key={option.symptom}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleChip(option)}
                      disabled={loading}
                    >
                      {option.symptom}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Couldn&apos;t complete the match</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
            {error.retryable && (
              <Button type="button" onClick={() => void runMatch(symptom)}>
                Try again
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!error && loading && <MatchSkeleton />}

      {!error && !loading && noMatch && result && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="space-y-1">
              <p className="font-heading text-base font-semibold text-ink">
                We couldn&apos;t match “{result.symptom}” to a specialty
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                That doesn&apos;t mean nothing&apos;s available — we just don&apos;t have a
                match for those exact words yet. Try describing it differently, or browse
                all our doctors by specialty.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button type="button" onClick={handleEditSymptom}>
                Edit my symptom
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/patient/discover">Browse all doctors</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!error && !loading && !noMatch && groups.length > 0 && (
        <section className="space-y-6" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {result!.doctors.length === 1
                ? '1 doctor matches your concern.'
                : `${result!.doctors.length} doctors match your concern.`}
            </span>
            {/* Only present when the AI engine answered; the deterministic
                endpoint omits `engine` and shows no badge. */}
            {result!.engine === 'ai' && <Badge variant="secondary">AI match</Badge>}
          </p>
          {groups.map((group) => (
            <div key={group.specialization} className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-base font-semibold text-ink">
                  {group.specialization}
                </h2>
                <Badge variant="secondary">
                  {group.doctors.length} {group.doctors.length === 1 ? 'doctor' : 'doctors'}
                </Badge>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.doctors.map((doctor) => (
                  <li key={doctor.id}>
                    <MatchDoctorCard doctor={doctor} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {!error && !loading && !result && (
        <Card>
          <CardContent className="px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Describe how you feel above, or pick a common concern, and we&apos;ll suggest
              the right specialty.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
