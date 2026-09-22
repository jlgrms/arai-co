import * as React from 'react';
import { toast } from 'sonner';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { parseAvailabilityError, type AvailabilityField } from './doctor-api-errors';
import type { Appointment } from '../patient/booking-types';
import {
  buildSchedule,
  formatTimeRange,
  isPastSlot,
  isSlotSealed,
  slotSealedReason,
  summarizeSchedule,
  toAvailabilityPayload,
  toLocalInputValue,
  type AvailabilitySlot,
  type CreateAvailabilityInput,
  type ScheduleSlot,
} from './doctor-types';

interface SlotFormState {
  start: string;
  end: string;
  isBlocked: boolean;
}

const EMPTY_SLOT_FORM: SlotFormState = { start: '', end: '', isBlocked: false };

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-medium text-danger-text">
      {message}
    </p>
  );
}

/** Badge for a slot's state. Booked is the strongest signal — it is sealed. */
function SlotBadge({ slot }: { slot: ScheduleSlot }) {
  if (slot.bookedBy) return <Badge variant="default">Booked</Badge>;
  if (slot.isBlocked) return <Badge variant="muted">Blocked</Badge>;
  return <Badge variant="success">Open</Badge>;
}

/**
 * One slot row.
 *
 * Edit and Delete are DISABLED (not hidden) when the slot is sealed by a live
 * appointment, with the reason shown inline. Hiding them would leave the doctor
 * wondering where the controls went; disabling them with an explanation tells
 * them exactly what to do — cancel or reschedule the appointment.
 */
function SlotRow({
  slot,
  onEdit,
  onToggleBlock,
  onDelete,
  busy,
}: {
  slot: ScheduleSlot;
  onEdit: (slot: ScheduleSlot) => void;
  onToggleBlock: (slot: ScheduleSlot) => void;
  onDelete: (slot: ScheduleSlot) => void;
  busy: boolean;
}) {
  const sealed = isSlotSealed(slot);
  const reason = slotSealedReason(slot);
  const past = isPastSlot(slot);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">
            {formatTimeRange(slot.startTime, slot.endTime)}
          </span>
          <SlotBadge slot={slot} />
          {past && !slot.bookedBy && <Badge variant="outline">Past</Badge>}
        </div>
        {slot.bookedBy && (
          <p className="text-xs text-muted-foreground">
            {slot.bookedBy.patientName}
            {slot.bookedBy.status === 'RESCHEDULED' ? ' · rescheduled' : ''}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {reason && <span className="max-w-[22rem] text-xs text-muted-foreground">{reason}</span>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || sealed}
          title={reason ?? undefined}
          onClick={() => onEdit(slot)}
        >
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || sealed}
          title={reason ?? undefined}
          onClick={() => onToggleBlock(slot)}
        >
          {slot.isBlocked ? 'Unblock' : 'Block'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || sealed}
          title={reason ?? undefined}
          onClick={() => onDelete(slot)}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

function ScheduleSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 py-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Layer 7 sub-item 2 — Doctor schedule/availability management.
 *
 * Reads GET /doctors/me/availability and joins it to GET /appointments/me
 * client-side, so the doctor sees which of their slots are taken and by whom.
 * Create/update/delete go to /doctors/me/availability.
 *
 * The domain rule this screen exists to respect: the backend SEALS a slot
 * consumed by a live appointment (409 on edit or delete). Rather than letting
 * the doctor trip that error, sealed slots are rendered with disabled controls
 * and an explanation. See isSlotSealed.
 */
export function DoctorScheduleScreen() {
  const [slots, setSlots] = React.useState<AvailabilitySlot[]>([]);
  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Add/edit dialog
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ScheduleSlot | null>(null);
  const [form, setForm] = React.useState<SlotFormState>(EMPTY_SLOT_FORM);
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<AvailabilityField, string>>
  >({});
  const [formError, setFormError] = React.useState<string | null>(null);

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = React.useState<ScheduleSlot | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      // Both reads together: the schedule is meaningless without knowing which
      // slots are occupied, and two sequential round-trips would flicker.
      const [slotData, apptData] = await Promise.all([
        api.get<AvailabilitySlot[]>('/doctors/me/availability', { signal }),
        api.get<Appointment[]>('/appointments/me', { signal }),
      ]);
      setSlots(slotData);
      setAppointments(apptData);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load your schedule. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const groups = React.useMemo(
    () =>
      buildSchedule(
        slots,
        appointments.map((a) => ({
          id: a.id,
          availabilityId: a.availabilityId,
          status: a.status,
          patientProfile: a.patientProfile,
        })),
      ),
    [slots, appointments],
  );

  const summary = React.useMemo(() => summarizeSchedule(groups), [groups]);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_SLOT_FORM);
    setFieldErrors({});
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(slot: ScheduleSlot) {
    setEditing(slot);
    setForm({
      start: toLocalInputValue(slot.startTime),
      end: toLocalInputValue(slot.endTime),
      isBlocked: slot.isBlocked,
    });
    setFieldErrors({});
    setFormError(null);
    setDialogOpen(true);
  }

  async function submitSlot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setFieldErrors({});
    setFormError(null);

    const parsed = toAvailabilityPayload(form.start, form.end, form.isBlocked);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }

    setBusy(true);
    try {
      if (editing) {
        // Only send what changed, like the profile form.
        const patch: Partial<CreateAvailabilityInput> = {};
        const nextStart = parsed.value.startTime;
        const nextEnd = parsed.value.endTime;
        if (new Date(nextStart).getTime() !== new Date(editing.startTime).getTime()) {
          patch.startTime = nextStart;
        }
        if (new Date(nextEnd).getTime() !== new Date(editing.endTime).getTime()) {
          patch.endTime = nextEnd;
        }
        if (parsed.value.isBlocked !== editing.isBlocked) patch.isBlocked = parsed.value.isBlocked;

        if (Object.keys(patch).length === 0) {
          toast('No changes to save', { description: 'This slot is unchanged.' });
          setDialogOpen(false);
          return;
        }

        await api.patch<AvailabilitySlot>(`/doctors/me/availability/${editing.id}`, patch);
        toast.success('Slot updated', { description: 'Your schedule has been saved.' });
      } else {
        await api.post<AvailabilitySlot>('/doctors/me/availability', parsed.value);
        toast.success('Slot added', { description: 'Patients can now book this time.' });
      }
      setDialogOpen(false);
      await load();
    } catch (err: unknown) {
      const parsedErr = parseAvailabilityError(err);
      setFieldErrors(parsedErr.fields);
      // A 409 means the slot is sealed by an appointment, which is not a
      // validation problem — it needs the whole-sentence explanation.
      setFormError(parsedErr.form ?? 'Could not save this slot.');
      toast.error('Could not save slot', {
        description: parsedErr.form ?? 'Please check the highlighted fields and try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock(slot: ScheduleSlot) {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch<AvailabilitySlot>(`/doctors/me/availability/${slot.id}`, {
        isBlocked: !slot.isBlocked,
      });
      toast.success(slot.isBlocked ? 'Slot unblocked' : 'Slot blocked', {
        description: slot.isBlocked
          ? 'Patients can book this time again.'
          : 'This time can no longer be booked.',
      });
      await load();
    } catch (err: unknown) {
      const parsedErr = parseAvailabilityError(err);
      toast.error('Could not update slot', {
        description: parsedErr.form ?? 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const slot = pendingDelete;
    if (!slot || busy) return;
    setBusy(true);
    try {
      await api.delete(`/doctors/me/availability/${slot.id}`);
      toast.success('Slot removed', { description: 'This time is no longer offered.' });
      setPendingDelete(null);
      await load();
    } catch (err: unknown) {
      const parsedErr = parseAvailabilityError(err);
      toast.error('Could not remove slot', {
        description: parsedErr.form ?? 'Please try again.',
      });
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <ScheduleSkeleton />;

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Schedule" description="Manage availability and block unavailable slots." />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Couldn&apos;t load your schedule</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
            <Button type="button" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule"
        description="Manage availability and block unavailable slots."
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Your availability</CardTitle>
              <CardDescription>
                {summary.total === 0
                  ? 'No slots yet — add your first availability slot to start taking appointments.'
                  : `${summary.free} open, ${summary.booked} booked, ${summary.blocked} blocked.`}
              </CardDescription>
            </div>
            <Button type="button" onClick={openAdd} disabled={busy}>
              Add slot
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: 'Total slots', value: summary.total },
              { label: 'Open', value: summary.free },
              { label: 'Booked', value: summary.booked },
              { label: 'Blocked', value: summary.blocked },
            ].map((stat) => (
              <div key={stat.label} className="rounded-md border border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-semibold text-ink">{stat.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm font-medium text-ink">No availability set</p>
            <p className="max-w-md text-sm text-muted-foreground">
              You have not published any times yet, so patients cannot book you. Add a slot to
              open up your first appointment.
            </p>
            <Button type="button" onClick={openAdd}>
              Add your first slot
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <Card key={group.key}>
              <CardHeader>
                <CardTitle className="text-base">{group.label}</CardTitle>
                <CardDescription>
                  {group.slots.length} slot{group.slots.length === 1 ? '' : 's'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {group.slots.map((slot) => (
                    <SlotRow
                      key={slot.id}
                      slot={slot}
                      busy={busy}
                      onEdit={openEdit}
                      onToggleBlock={(s) => void toggleBlock(s)}
                      onDelete={setPendingDelete}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit slot' : 'Add availability slot'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitSlot} noValidate className="space-y-5">
            {formError && (
              <Alert variant="destructive">
                <AlertTitle>Couldn&apos;t save this slot</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="slot-start">Start</Label>
                <Input
                  id="slot-start"
                  name="slot-start"
                  type="datetime-local"
                  required
                  value={form.start}
                  onChange={(e) => setForm((p) => ({ ...p, start: e.target.value }))}
                  aria-invalid={Boolean(fieldErrors.startTime)}
                  aria-describedby={fieldErrors.startTime ? 'slot-start-error' : undefined}
                />
                <FieldError id="slot-start-error" message={fieldErrors.startTime} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slot-end">End</Label>
                <Input
                  id="slot-end"
                  name="slot-end"
                  type="datetime-local"
                  required
                  value={form.end}
                  onChange={(e) => setForm((p) => ({ ...p, end: e.target.value }))}
                  aria-invalid={Boolean(fieldErrors.endTime)}
                  aria-describedby={fieldErrors.endTime ? 'slot-end-error' : undefined}
                />
                <FieldError id="slot-end-error" message={fieldErrors.endTime} />
              </div>
            </div>

            <div className="flex items-start gap-3">
              <input
                id="slot-blocked"
                name="slot-blocked"
                type="checkbox"
                className="mt-1 size-4 rounded border-input"
                checked={form.isBlocked}
                onChange={(e) => setForm((p) => ({ ...p, isBlocked: e.target.checked }))}
              />
              <div className="space-y-1">
                <Label htmlFor="slot-blocked">Block this time</Label>
                <p className="text-xs text-muted-foreground">
                  A blocked slot stays in your schedule but cannot be booked — useful for
                  marking time off without deleting the slot.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Add slot'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this slot?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${formatTimeRange(pendingDelete.startTime, pendingDelete.endTime)} will no longer be offered to patients. This cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep slot</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {busy ? 'Removing…' : 'Remove slot'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Separator />
      <p className={cn('text-xs text-muted-foreground')}>
        A slot booked by an appointment cannot be edited or removed. Cancel or reschedule that
        appointment first — the patient is notified either way.
      </p>
    </div>
  );
}
