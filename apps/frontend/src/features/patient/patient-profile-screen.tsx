import * as React from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  hasProfileFieldErrors,
  parseProfileError,
  type ParsedProfileError,
  type ProfileFieldErrors,
} from './profile-api-errors';
import type { PatientProfile, UpdatePatientProfileInput } from './types';

/** Editable form state — every value is a string because inputs are strings. */
interface FormState {
  name: string;
  birthday: string;
  weight: string;
  height: string;
  contactDetails: string;
  basicMedicalHistory: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  birthday: '',
  weight: '',
  height: '',
  contactDetails: '',
  basicMedicalHistory: '',
};

/**
 * Birthday is a date-only value. The backend stores `@db.Date` and returns an
 * ISO string; we slice the `YYYY-MM-DD` prefix rather than constructing a Date,
 * which would shift the day for users in negative-UTC offsets.
 */
function toDateOnly(value: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function profileToForm(profile: PatientProfile): FormState {
  return {
    name: profile.name ?? '',
    birthday: toDateOnly(profile.birthday),
    weight: profile.weight === null ? '' : String(profile.weight),
    height: profile.height === null ? '' : String(profile.height),
    contactDetails: profile.contactDetails ?? '',
    basicMedicalHistory: profile.basicMedicalHistory ?? '',
  };
}

/**
 * Coerce a numeric input to a number, or null when blank.
 * Blank must NOT become 0 — the PATCH is a partial update, so a cleared field
 * has to be omitted rather than silently written as zero.
 */
function parseNumeric(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/**
 * Diff the form against the loaded profile so PATCH carries ONLY changed fields.
 * Untouched fields are omitted entirely, so a partial update can never clobber
 * a value the user never edited.
 */
function buildPatch(
  form: FormState,
  original: PatientProfile,
): { patch: UpdatePatientProfileInput; invalidFields: ProfileFieldErrors } {
  const patch: UpdatePatientProfileInput = {};
  const invalidFields: ProfileFieldErrors = {};

  const trimmedName = form.name.trim();
  if (trimmedName !== (original.name ?? '')) patch.name = trimmedName;

  const birthday = toDateOnly(form.birthday);
  if (birthday !== toDateOnly(original.birthday)) patch.birthday = birthday;

  const weight = parseNumeric(form.weight);
  if (!weight.ok) {
    invalidFields.weight = 'Enter a number.';
  } else if (weight.value !== original.weight) {
    // A cleared field is represented as null in the DB, but the DTO is
    // @IsNumber() with no @IsOptional-null allowance, so omit instead of
    // sending null (sending null would fail validation).
    if (weight.value !== null) patch.weight = weight.value;
  }

  const height = parseNumeric(form.height);
  if (!height.ok) {
    invalidFields.height = 'Enter a number.';
  } else if (height.value !== original.height) {
    if (height.value !== null) patch.height = height.value;
  }

  const contactDetails = form.contactDetails.trim();
  if (contactDetails !== (original.contactDetails ?? '')) patch.contactDetails = contactDetails;

  const history = form.basicMedicalHistory.trim();
  if (history !== (original.basicMedicalHistory ?? '')) patch.basicMedicalHistory = history;

  return { patch, invalidFields };
}

/** Read-only presentational field — used for server-owned values. */
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

/** Loading state — mirrors the loaded layout so there is no jump on arrival. */
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
          {Array.from({ length: 6 }).map((_, i) => (
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
 * Layer 6 sub-item 1 — Patient profile creation/edit.
 *
 * Fetches the authenticated patient's own profile on mount (GET /patients/me)
 * and saves changed fields (PATCH /patients/me, partial). The avatar is
 * server-generated initials only — no upload UI, per the no-external-storage
 * ground rule.
 */
export function PatientProfileScreen() {
  const [profile, setProfile] = React.useState<PatientProfile | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<ProfileFieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<PatientProfile>('/patients/me', { signal });
      setProfile(data);
      setForm(profileToForm(data));
    } catch (err: unknown) {
      // Abort is an intentional unmount/unload, not a failure to report.
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
    // Clear this field's server error as soon as the user edits it.
    setFieldErrors((prev) => {
      if (!prev[key as keyof UpdatePatientProfileInput]) return prev;
      const next = { ...prev };
      delete next[key as keyof UpdatePatientProfileInput];
      return next;
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || saving) return;

    setFormError(null);
    setFieldErrors({});

    const { patch, invalidFields } = buildPatch(form, profile);

    if (hasProfileFieldErrors(invalidFields)) {
      setFieldErrors(invalidFields);
      return;
    }

    // Nothing changed — no request, no false success toast.
    if (Object.keys(patch).length === 0) {
      toast('No changes to save', { description: 'Your profile is already up to date.' });
      return;
    }

    setSaving(true);
    try {
      const updated = await api.patch<PatientProfile>('/patients/me', patch);
      setProfile(updated);
      setForm(profileToForm(updated));
      toast.success('Profile saved', { description: 'Your changes have been saved.' });
    } catch (err: unknown) {
      const parsed: ParsedProfileError = parseProfileError(err);
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
        <PageHeader title="Profile" description="Your personal and medical details." />
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

  const initials = profile.avatarInitialsOrRef ?? '—';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Keep your personal and medical details up to date so your doctor has what they need."
      />

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
            <CardDescription>
              Your name and contact information. Your avatar initials are generated from your name.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                <AvatarFallback className="text-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink">{profile.name || 'Unnamed patient'}</p>
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
                <Label htmlFor="birthday">Birthday</Label>
                <Input
                  id="birthday"
                  name="birthday"
                  type="date"
                  value={form.birthday}
                  onChange={(e) => setField('birthday', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.birthday)}
                  aria-describedby={fieldErrors.birthday ? 'birthday-error' : undefined}
                />
                <FieldError id="birthday-error" message={fieldErrors.birthday} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contactDetails">Contact details</Label>
                <Input
                  id="contactDetails"
                  name="contactDetails"
                  autoComplete="tel"
                  placeholder="Mobile number or email"
                  value={form.contactDetails}
                  onChange={(e) => setField('contactDetails', e.target.value)}
                  aria-invalid={Boolean(fieldErrors.contactDetails)}
                  aria-describedby={
                    fieldErrors.contactDetails ? 'contactDetails-error' : undefined
                  }
                />
                <FieldError id="contactDetails-error" message={fieldErrors.contactDetails} />
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="weight">Weight (kg)</Label>
                  <Input
                    id="weight"
                    name="weight"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min={0}
                    value={form.weight}
                    onChange={(e) => setField('weight', e.target.value)}
                    aria-invalid={Boolean(fieldErrors.weight)}
                    aria-describedby={fieldErrors.weight ? 'weight-error' : undefined}
                  />
                  <FieldError id="weight-error" message={fieldErrors.weight} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="height">Height (cm)</Label>
                  <Input
                    id="height"
                    name="height"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min={0}
                    value={form.height}
                    onChange={(e) => setField('height', e.target.value)}
                    aria-invalid={Boolean(fieldErrors.height)}
                    aria-describedby={fieldErrors.height ? 'height-error' : undefined}
                  />
                  <FieldError id="height-error" message={fieldErrors.height} />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="basicMedicalHistory">Basic medical history</Label>
              <textarea
                id="basicMedicalHistory"
                name="basicMedicalHistory"
                rows={4}
                value={form.basicMedicalHistory}
                onChange={(e) => setField('basicMedicalHistory', e.target.value)}
                aria-invalid={Boolean(fieldErrors.basicMedicalHistory)}
                aria-describedby={
                  fieldErrors.basicMedicalHistory ? 'basicMedicalHistory-error' : undefined
                }
                placeholder="Allergies, ongoing conditions, regular medication…"
                className={cn(
                  'flex w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-ink shadow-sm transition-colors',
                  'placeholder:text-muted-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  'aria-[invalid=true]:border-danger-text aria-[invalid=true]:ring-danger-text/30',
                )}
              />
              <FieldError id="basicMedicalHistory-error" message={fieldErrors.basicMedicalHistory} />
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
            <CardDescription>Managed by your sign-in details.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <ReadOnlyField label="Email" value="Managed by your sign-in" />
            <ReadOnlyField
              label="Avatar"
              value={`${initials} — generated from your name`}
            />
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
