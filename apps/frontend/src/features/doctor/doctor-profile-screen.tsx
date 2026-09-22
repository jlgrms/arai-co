import * as React from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  parseDoctorProfileError,
  type DoctorProfileFieldErrors,
} from './doctor-api-errors';
import {
  isKnownSpecialization,
  SPECIALIZATIONS,
  type DoctorPublic,
  type UpdateDoctorProfileInput,
} from './doctor-types';

interface FormState {
  name: string;
  specialization: string;
  biography: string;
}

const EMPTY_FORM: FormState = { name: '', specialization: '', biography: '' };

function profileToForm(profile: DoctorPublic): FormState {
  return {
    name: profile.name ?? '',
    specialization: profile.specialization ?? '',
    biography: profile.biography ?? '',
  };
}

/**
 * Diff the form against the loaded profile so PATCH carries ONLY changed fields.
 * An untouched field is omitted entirely, so a partial update can never clobber
 * a value the doctor never edited.
 *
 * `approvalStatus` is deliberately absent — it is admin-owned (Layer 8), and
 * UpdateDoctorProfileDto does not accept it. Sending it would be a 400.
 */
function buildPatch(form: FormState, original: DoctorPublic): UpdateDoctorProfileInput {
  const patch: UpdateDoctorProfileInput = {};
  const name = form.name.trim();
  if (name !== (original.name ?? '')) patch.name = name;

  const specialization = form.specialization.trim();
  if (specialization !== (original.specialization ?? '')) patch.specialization = specialization;

  const biography = form.biography.trim();
  if (biography !== (original.biography ?? '')) patch.biography = biography;

  return patch;
}

function ReadOnlyField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label asChild>
        <span>{label}</span>
      </Label>
      <div className="text-sm text-muted-foreground">{value}</div>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-medium text-danger-text">
      {message}
    </p>
  );
}

/**
 * Approval status is server-owned and has three distinct meanings to the doctor,
 * so it is explained rather than shown as a bare enum. Only APPROVED doctors
 * appear in discovery — a PENDING or REJECTED doctor needs to know why they are
 * not being found. Badge variants: success/danger are semantic and already
 * exist in the design system.
 */
function ApprovalNotice({ status }: { status: DoctorPublic['approvalStatus'] }) {
  if (status === 'APPROVED') {
    return (
      <Alert>
        <AlertTitle className="flex items-center gap-2">
          Profile approved
          <Badge variant="success">Approved</Badge>
        </AlertTitle>
        <AlertDescription>
          Your profile is visible to patients in search and matching.
        </AlertDescription>
      </Alert>
    );
  }
  if (status === 'PENDING') {
    return (
      <Alert>
        <AlertTitle className="flex items-center gap-2">
          Awaiting review
          <Badge variant="muted">Pending</Badge>
        </AlertTitle>
        <AlertDescription>
          An administrator has not approved your profile yet, so patients cannot find you.
          You can keep editing your details in the meantime.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle className="flex items-center gap-2">
        Profile not approved
        <Badge variant="danger">Rejected</Badge>
      </AlertTitle>
      <AlertDescription>
        An administrator did not approve this profile, so patients cannot find you. Contact
        your administrator if you believe this is a mistake.
      </AlertDescription>
    </Alert>
  );
}

function ProfileSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <Separator />
        <div className="grid gap-5 sm:grid-cols-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Layer 7 sub-item 1 — Doctor profile/bio/specialization management.
 *
 * Reads GET /doctors/me and saves changed fields with PATCH /doctors/me. The
 * avatar is server-less initials generated from the name — no upload UI, per the
 * no-external-storage ground rule.
 *
 * Specialization is a SELECT over the fixed product set, not free text:
 * discovery filters by exact match, so a typo would silently make the doctor
 * unfindable.
 */
export function DoctorProfileScreen() {
  const [profile, setProfile] = React.useState<DoctorPublic | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<DoctorProfileFieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<DoctorPublic>('/doctors/me', { signal });
      setProfile(data);
      setForm(profileToForm(data));
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(
        err instanceof ApiError ? err.message : 'Could not load your profile. Please try again.',
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

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key as keyof UpdateDoctorProfileInput]) return prev;
      const next = { ...prev };
      delete next[key as keyof UpdateDoctorProfileInput];
      return next;
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || saving) return;

    setFormError(null);
    setFieldErrors({});

    // Client-side guard for the one rule the backend expresses as a plain 400.
    if (form.name.trim() === '') {
      setFieldErrors({ name: 'Name cannot be empty.' });
      return;
    }
    if (form.specialization === '') {
      setFieldErrors({ specialization: 'Choose a specialization.' });
      return;
    }

    const patch = buildPatch(form, profile);

    if (Object.keys(patch).length === 0) {
      toast('No changes to save', { description: 'Your profile is already up to date.' });
      return;
    }

    setSaving(true);
    try {
      const updated = await api.patch<DoctorPublic>('/doctors/me', patch);
      setProfile(updated);
      setForm(profileToForm(updated));
      toast.success('Profile saved', { description: 'Your changes have been saved.' });
    } catch (err: unknown) {
      const parsed = parseDoctorProfileError(err);
      setFieldErrors(parsed.fields);
      if (parsed.form) setFormError(parsed.form);
      toast.error('Could not save profile', {
        description: parsed.form ?? 'Please check the highlighted fields and try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <ProfileSkeleton />;

  if (loadError || !profile) {
    return (
      <div className="space-y-6">
        <PageHeader title="Profile" description="Your biography and specialization." />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <Alert variant="destructive" className="max-w-md text-left">
              <AlertTitle>Couldn&apos;t load your profile</AlertTitle>
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

  const initials = profile.name
    ? profile.name
        .replace(/^Dr\.?\s+/i, '')
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '—';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="How patients see you in search and matching."
      />

      <ApprovalNotice status={profile.approvalStatus} />

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Professional details</CardTitle>
            <CardDescription>
              Your name, specialty and biography. Patients read this when choosing a doctor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                <AvatarFallback className="text-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink">{profile.name || 'Unnamed doctor'}</p>
                <p className="text-xs text-muted-foreground">
                  Generated from your name — no uploads.
                </p>
              </div>
            </div>

            <Separator />

            {formError && (
              <Alert variant="destructive">
                <AlertTitle>Couldn&apos;t save changes</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  required
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                />
                <FieldError id="name-error" message={fieldErrors.name} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="specialization">Specialization</Label>
                {/* A native select keeps this dependency-free and gives the
                    browser's own keyboard/AT behaviour for free. */}
                <select
                  id="specialization"
                  name="specialization"
                  value={form.specialization}
                  onChange={(e) => setField('specialization', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.specialization)}
                  aria-describedby={
                    fieldErrors.specialization ? 'specialization-error' : undefined
                  }
                  className={cn(
                    'flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm text-ink shadow-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    'aria-[invalid=true]:border-danger-text aria-[invalid=true]:ring-danger-text/30',
                  )}
                >
                  <option value="">Select a specialization…</option>
                  {SPECIALIZATIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  {/* A value outside the offered set (e.g. seeded legacy data)
                      must stay selectable or the form would silently rewrite it
                      on save. Rendering it as an extra option keeps it intact. */}
                  {form.specialization !== '' && !isKnownSpecialization(form.specialization) && (
                    <option value={form.specialization}>{form.specialization}</option>
                  )}
                </select>
                <FieldError id="specialization-error" message={fieldErrors.specialization} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="biography">Biography</Label>
              <textarea
                id="biography"
                name="biography"
                rows={5}
                value={form.biography}
                onChange={(e) => setField('biography', e.target.value)}
                aria-invalid={Boolean(fieldErrors.biography)}
                aria-describedby={fieldErrors.biography ? 'biography-error' : undefined}
                placeholder="Your experience, focus areas, and how you work with patients…"
                className={cn(
                  'flex w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-ink shadow-sm transition-colors',
                  'placeholder:text-muted-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  'aria-[invalid=true]:border-danger-text aria-[invalid=true]:ring-danger-text/30',
                )}
              />
              <FieldError id="biography-error" message={fieldErrors.biography} />
              <p className="text-xs text-muted-foreground">
                Patients can search your biography, so describe the conditions you treat.
              </p>
            </div>
          </CardContent>
          <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setForm(profileToForm(profile));
                setFieldErrors({});
                setFormError(null);
              }}
            >
              Reset
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Managed by your sign-in details and your administrator.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <ReadOnlyField label="Email" value="Managed by your sign-in" />
            <ReadOnlyField
              label="Approval status"
              value={
                <Badge
                  variant={
                    profile.approvalStatus === 'APPROVED'
                      ? 'success'
                      : profile.approvalStatus === 'REJECTED'
                        ? 'danger'
                        : 'muted'
                  }
                >
                  {profile.approvalStatus}
                </Badge>
              }
            />
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
