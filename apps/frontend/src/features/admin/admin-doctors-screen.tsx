import * as React from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { SPECIALIZATIONS, isKnownSpecialization } from '@/features/doctor/doctor-types';
import { fetchDoctors, reviewDoctor } from './admin-api';
import { parseAdminError, type ParsedAdminError } from './admin-api-errors';
import {
  accountStateNote,
  approvalStatusLabel,
  approvalStatusVariant,
  APPROVAL_STATUSES,
  availableReviewActions,
  buildReviewPatch,
  confirmCopy,
  displayName,
  doctorToForm,
  EMPTY_FILTERS,
  hasActiveFilters,
  initials,
  resultSummary,
  reviewPatchIsEmpty,
  summarizeApproval,
  validateReviewForm,
  type AdminDoctor,
  type DoctorFilters,
  type ReviewAction,
  type ReviewForm,
} from './admin-doctor-types';

/**
 * Layer 8 sub-item 2 — Admin doctor profile review.
 *
 * `GET /admin/doctors` + `PATCH /admin/doctors/:id/review`, ADMIN-only. Both
 * routes pre-exist from Layer 4 sub-item 9; this screen adds no backend code.
 *
 * ONE ENDPOINT, TWO JOBS. The review endpoint gatekeeps (approvalStatus) AND
 * direct-edits (name/biography/specialization) in a single call, and the DTO
 * mirrors the doctor's own PATCH /doctors/me exactly — so there is no admin
 * validation bypass. The UI keeps them as two affordances in one dialog (a
 * decision button, and an "Edit details" form) because they are two different
 * intents, but they may ship in the same request when the admin does both.
 *
 * SEARCH IS SERVER-SIDE, matching the sub-item 1 decision: `q` is matched by the
 * backend against name and specialization, so this sends the query rather than
 * filtering the loaded array. Client-side filtering would appear to work while
 * only ever searching the rows already fetched.
 *
 * NO PAGINATION. The endpoint returns the whole result set, ordered by name asc.
 * The doctor count is small enough (the seed baseline is 6); inventing client
 * pagination over a full fetch would be fake. If it grows, the fix is
 * server-side paging.
 *
 * THE REASON FIELD IS OPTIONAL and is hidden behind the confirm dialog rather
 * than shown per-row: unlike user management there is no always-visible reason
 * column, because the DoctorProfile carries no stateReason field — the reason
 * lives only in the AuditLog.
 */
export function AdminDoctorsScreen() {
  const [filters, setFilters] = React.useState<DoctorFilters>(EMPTY_FILTERS);
  const [doctors, setDoctors] = React.useState<AdminDoctor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ParsedAdminError | null>(null);

  // Deferred so a keystroke does not fire a request per character (300ms is
  // below the threshold where a search feels laggy). Same as sub-item 1.
  const [debouncedQ, setDebouncedQ] = React.useState('');
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => window.clearTimeout(t);
  }, [filters.q]);

  const effectiveFilters = React.useMemo<DoctorFilters>(
    () => ({ ...filters, q: debouncedQ }),
    [filters, debouncedQ],
  );

  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchDoctors(effectiveFilters, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setDoctors(data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        setError(parseAdminError(err, 'Could not load doctor profiles. Please try again.'));
        setDoctors([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [effectiveFilters, reloadToken]);

  // The profile open in the review dialog, if any.
  const [editing, setEditing] = React.useState<AdminDoctor | null>(null);

  const [pendingDecision, setPendingDecision] = React.useState<{
    doctor: AdminDoctor;
    action: Extract<ReviewAction, 'approve' | 'reject'>;
  } | null>(null);
  const [reason, setReason] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Apply one review request, then patch the single changed row back in. No
  // refetch: the list is ordered by name asc and neither a status change nor a
  // bio edit reorders it, so a refetch would only add latency and risk a
  // flicker. A changed NAME does reorder the list — that case refetches (below).
  const submitReview = React.useCallback(
    async (
      target: AdminDoctor,
      patch: Parameters<typeof reviewDoctor>[1],
      opts: { reorders?: boolean } = {},
    ) => {
      setBusyId(target.id);
      setActionError(null);
      try {
        const updated = await reviewDoctor(target.id, patch);
        if (opts.reorders) {
          setReloadToken((n) => n + 1);
        } else {
          setDoctors((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        }
        toast.success(`${displayName(updated)} — ${approvalStatusLabel(updated.approvalStatus)}`);
        return true;
      } catch (err: unknown) {
        // Kept inline (not only a toast) so the message survives the dismissal
        // of a toast and stays readable next to the row it concerns.
        setActionError(
          parseAdminError(err, 'Could not update this profile. Please try again.').message,
        );
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  const onDecision = React.useCallback(
    (target: AdminDoctor, action: ReviewAction) => {
      const option = availableReviewActions(target.approvalStatus).find(
        (o) => o.action === action,
      );
      if (!option) return;
      if (option.confirm) {
        setReason('');
        setPendingDecision({ doctor: target, action: action as 'approve' | 'reject' });
        return;
      }
      // Reopen: administrative bookkeeping, no confirmation, no reason prompt.
      void submitReview(target, { approvalStatus: option.target });
    },
    [submitReview],
  );

  const summary = React.useMemo(() => summarizeApproval(doctors), [doctors]);
  const filtered = hasActiveFilters(effectiveFilters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Doctor Review"
        description="Approve, reject, or update doctor profiles and their specialization."
      />

      {/* Filters. Kept in a card so they read as one control group. */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="admin-doctor-search">Search</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="admin-doctor-search"
                className="pl-9"
                placeholder="Search by name or specialization"
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2 sm:w-48">
            <Label htmlFor="admin-doctor-status">Review status</Label>
            <select
              id="admin-doctor-status"
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filters.approvalStatus}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  approvalStatus: e.target.value as DoctorFilters['approvalStatus'],
                }))
              }
            >
              <option value="ALL">All statuses</option>
              {APPROVAL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {approvalStatusLabel(status)}
                </option>
              ))}
            </select>
          </div>

          {filtered && (
            <Button type="button" variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <Alert variant="destructive">
          <AlertTitle>Could not update that profile</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>
                {error.isForbidden ? 'Not permitted' : "Couldn't load doctor profiles"}
              </AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
            <Button type="button" variant="outline" onClick={() => setReloadToken((n) => n + 1)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : doctors.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={filtered ? 'No profiles match those filters' : 'Nothing to review'}
          description={
            filtered
              ? 'Try a different search term or review status.'
              : 'Doctor profiles appear here as doctors register. A new profile starts as pending review.'
          }
          action={
            filtered ? (
              <Button type="button" variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Specialization</TableHead>
                  <TableHead>Review status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doctors.map((doctor) => {
                  const busy = busyId === doctor.id;
                  const note = accountStateNote(doctor);
                  return (
                    <TableRow key={doctor.id} data-testid={`admin-doctor-row-${doctor.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-9">
                            <AvatarFallback>
                              {initials(doctor.name, doctor.user.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="space-y-0.5">
                            <div className="font-medium text-ink">{displayName(doctor)}</div>
                            <div className="text-xs text-muted-foreground">
                              {doctor.user.email}
                            </div>
                            {/* A suspended or deactivated doctor is still
                                reviewable, so the row is not hidden — but the
                                admin should not approve a profile without
                                knowing the account cannot currently sign in. */}
                            {note && (
                              <Badge variant="muted" className="mt-0.5">
                                {note}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-ink">{doctor.specialization}</TableCell>
                      <TableCell>
                        <Badge variant={approvalStatusVariant(doctor.approvalStatus)}>
                          {approvalStatusLabel(doctor.approvalStatus)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {availableReviewActions(doctor.approvalStatus).map((option) => (
                            <Button
                              key={option.action}
                              type="button"
                              size="sm"
                              variant={option.variant}
                              disabled={busy}
                              onClick={() => onDecision(doctor, option.action)}
                              data-testid={`admin-doctor-${option.action}-${doctor.id}`}
                            >
                              {busy ? 'Working…' : option.label}
                            </Button>
                          ))}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setEditing(doctor)}
                            data-testid={`admin-doctor-edit-${doctor.id}`}
                          >
                            Edit
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!loading && !error && doctors.length > 0 && (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{resultSummary(doctors.length, effectiveFilters)}</p>
          {/* Counts describe the CURRENT filter, not the whole table, because the
              client only ever sees what it fetched. The wording says so. */}
          {filtered && (
            <p className="text-xs">
              Pending {summary.PENDING} · Approved {summary.APPROVED} · Rejected{' '}
              {summary.REJECTED} (within these results)
            </p>
          )}
        </div>
      )}

      <ReviewDetailsDialog
        doctor={editing}
        busy={busyId !== null}
        onClose={() => setEditing(null)}
        onSave={async (target, form, reasonText) => {
          const patch = buildReviewPatch(form, target, target.approvalStatus, reasonText);
          if (reviewPatchIsEmpty(patch)) {
            toast('No changes to save', { description: 'This profile is already up to date.' });
            return false;
          }
          const nameChanged = patch.name !== undefined;
          const ok = await submitReview(target, patch, { reorders: nameChanged });
          if (ok) setEditing(null);
          return ok;
        }}
      />

      <AlertDialog
        open={pendingDecision !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDecision(null);
        }}
      >
        <AlertDialogContent>
          {pendingDecision && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmCopy(pendingDecision.action, displayName(pendingDecision.doctor)).title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {
                    confirmCopy(pendingDecision.action, displayName(pendingDecision.doctor))
                      .description
                  }
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-2">
                <Label htmlFor="admin-doctor-reason">Reason (optional)</Label>
                <Input
                  id="admin-doctor-reason"
                  placeholder="e.g. Specialization does not match credentials"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Recorded in the audit log against this profile.
                </p>
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const target = pendingDecision;
                    setPendingDecision(null);
                    void submitReview(target.doctor, {
                      approvalStatus:
                        target.action === 'approve' ? 'APPROVED' : 'REJECTED',
                      ...(reason.trim() !== '' ? { reason: reason.trim() } : {}),
                    });
                  }}
                >
                  {
                    confirmCopy(pendingDecision.action, displayName(pendingDecision.doctor))
                      .confirmLabel
                  }
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Direct-edit dialog for one profile's name / specialization / biography.
 *
 * Separate from the approve/reject confirmation on purpose: those are decisions
 * that get communicated, these are corrections. They share an endpoint, so an
 * admin who edits and then decides issues two requests — each audited once,
 * which is more truthful than one merged entry describing two acts.
 *
 * Approving/rejecting is NOT offered here (the row buttons own that), so the
 * dialog never risks an accidental status change from someone fixing a typo.
 */
function ReviewDetailsDialog({
  doctor,
  busy,
  onClose,
  onSave,
}: {
  doctor: AdminDoctor | null;
  busy: boolean;
  onClose: () => void;
  onSave: (
    target: AdminDoctor,
    form: ReviewForm,
    reason: string,
  ) => Promise<boolean>;
}) {
  const [form, setForm] = React.useState<ReviewForm>({
    name: '',
    specialization: '',
    biography: '',
  });
  const [reason, setReason] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<{
    name?: string;
    specialization?: string;
  }>({});

  // Reset the form whenever a different profile is opened, so a half-typed edit
  // can never leak onto another doctor.
  React.useEffect(() => {
    if (doctor) {
      setForm(doctorToForm(doctor));
      setReason('');
      setFieldErrors({});
    }
  }, [doctor]);

  function setField<K extends keyof ReviewForm>(key: K, value: ReviewForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as 'name' | 'specialization'];
      return next;
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!doctor || busy) return;

    const errors = validateReviewForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    await onSave(doctor, form, reason);
  }

  return (
    <Dialog
      open={doctor !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {doctor && (
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <DialogHeader>
              <DialogTitle>Update profile details</DialogTitle>
              <DialogDescription>
                {displayName(doctor)} · {doctor.user.email}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="admin-doctor-name">Full name</Label>
              <Input
                id="admin-doctor-name"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? 'admin-doctor-name-error' : undefined}
              />
              {fieldErrors.name && (
                <p id="admin-doctor-name-error" className="text-xs font-medium text-danger-text">
                  {fieldErrors.name}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-doctor-specialization">Specialization</Label>
              {/* Fixed set, not free text — discovery filters by EXACT match, so
                  a typo would silently make this doctor unfindable. Mirrors the
                  doctor's own profile screen. The endpoint takes any string, so
                  a value outside the set (e.g. seeded legacy data) is preserved
                  as an extra option rather than silently rewritten on save. */}
              <select
                id="admin-doctor-specialization"
                value={form.specialization}
                onChange={(e) => setField('specialization', e.target.value)}
                aria-invalid={Boolean(fieldErrors.specialization)}
                aria-describedby={
                  fieldErrors.specialization ? 'admin-doctor-specialization-error' : undefined
                }
                className={cn(
                  'flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm text-ink shadow-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  'aria-[invalid=true]:border-danger-text aria-[invalid=true]:ring-danger-text/30',
                )}
              >
                <option value="">Select a specialization…</option>
                {SPECIALIZATIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                {form.specialization !== '' && !isKnownSpecialization(form.specialization) && (
                  <option value={form.specialization}>{form.specialization}</option>
                )}
              </select>
              {fieldErrors.specialization && (
                <p
                  id="admin-doctor-specialization-error"
                  className="text-xs font-medium text-danger-text"
                >
                  {fieldErrors.specialization}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-doctor-biography">Biography</Label>
              <textarea
                id="admin-doctor-biography"
                rows={5}
                value={form.biography}
                onChange={(e) => setField('biography', e.target.value)}
                placeholder="Experience, focus areas, and how they work with patients…"
                className={cn(
                  'flex w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-ink shadow-sm transition-colors',
                  'placeholder:text-muted-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                )}
              />
              <p className="text-xs text-muted-foreground">
                Patients can search the biography. Clearing it is allowed and removes it entirely.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-doctor-edit-reason">Reason (optional)</Label>
              <Input
                id="admin-doctor-edit-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Correcting a misspelled name"
              />
              <p className="text-xs text-muted-foreground">
                Recorded in the audit log. Approval status is not changed here.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
