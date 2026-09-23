import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { BrandLogo } from '@/components/brand/logo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HOME_BY_ROLE } from '@/app/nav';
import { useAuth } from './auth-context';
import { parseAuthError, type FieldErrors, type ParsedAuthError } from './auth-api-errors';
import { SignInForm, useRedirectAfterAuth } from './sign-in-form';
import type { Role } from './types';

/**
 * Shared, standalone frame for the public auth surfaces (login + both
 * registration forms). No shell, no bell — matches the public marketing frame
 * but with an auth-specific header (no nav; you are already at the gate).
 */
function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-16 items-center border-b border-border bg-surface px-6">
        <Link to="/" aria-label="ARAI.co home">
          <BrandLogo />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <div className="mb-6 space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-ink">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
        <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
      </main>
      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        ARAI.co — prototype for demonstration only. Not for real medical use.
      </footer>
    </div>
  );
}

/** Form-level error alert, driven by the parsed backend envelope. */
function FormAlert({ error }: { error: ParsedAuthError | null }) {
  if (!error || !error.form) return null;
  const title =
    error.statusCode === 403
      ? 'Account unavailable'
      : error.statusCode === 401
        ? 'Sign-in failed'
        : error.statusCode === 409
          ? 'Email already registered'
          : 'Please check the form';
  return (
    <Alert variant="destructive" aria-live="assertive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error.form}</AlertDescription>
    </Alert>
  );
}

/** Inline, per-field error text under an input. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-danger-text">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export function LoginScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const redirectTo = useRedirectAfterAuth();

  // If already signed in, this screen has nothing to do — send the user home.
  React.useEffect(() => {
    if (user) navigate(redirectTo ?? HOME_BY_ROLE[user.role], { replace: true });
  }, [user, navigate, redirectTo]);

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Welcome back to ARAI.co."
      footer={
        <>
          New here?{' '}
          <Link className="font-medium text-ink underline underline-offset-4" to="/register">
            Create an account
          </Link>
        </>
      }
    >
      {/* The form itself (state, login call, error mapping, redirect) lives in
          sign-in-form.tsx and is shared with the landing page's hero panel, so
          the two sign-in surfaces cannot drift apart. */}
      <SignInForm idPrefix="login" />
    </AuthFrame>
  );
}

// ---------------------------------------------------------------------------
// Registration (patient + doctor)
// ---------------------------------------------------------------------------

interface RegisterScreenProps {
  role: Extract<Role, 'PATIENT' | 'DOCTOR'>;
}

function RegisterScreen({ role }: RegisterScreenProps) {
  const { registerPatient, registerDoctor, user } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [specialization, setSpecialization] = React.useState('');
  const [contactDetails, setContactDetails] = React.useState('');
  const [biography, setBiography] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<ParsedAuthError | null>(null);

  const isDoctor = role === 'DOCTOR';

  React.useEffect(() => {
    if (user) navigate(HOME_BY_ROLE[user.role], { replace: true });
  }, [user, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const next =
        role === 'PATIENT'
          ? await registerPatient({
              email: email.trim(),
              password,
              name: name.trim(),
              ...(contactDetails.trim() ? { contactDetails: contactDetails.trim() } : {}),
            })
          : await registerDoctor({
              email: email.trim(),
              password,
              name: name.trim(),
              specialization: specialization.trim(),
              ...(biography.trim() ? { biography: biography.trim() } : {}),
            });
      navigate(HOME_BY_ROLE[next.role], { replace: true });
    } catch (err) {
      setError(parseAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldErrs: FieldErrors = error?.fields ?? {};
  const otherRole = isDoctor ? 'patient' : 'doctor';
  const otherHref = isDoctor ? '/register/patient' : '/register/doctor';

  return (
    <AuthFrame
      title={isDoctor ? 'Create a doctor account' : 'Create a patient account'}
      subtitle={
        isDoctor
          ? 'Doctor profiles are reviewed by an administrator before they appear in search.'
          : 'Find the right doctor and book in minutes.'
      }
      footer={
        <>
          {isDoctor ? 'Looking for a patient account? ' : 'Are you a doctor? '}
          <Link className="font-medium text-ink underline underline-offset-4" to={otherHref}>
            Register as a {otherRole}
          </Link>
          <span className="mx-2">·</span>
          <Link className="font-medium text-ink underline underline-offset-4" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormAlert error={error} />

        <div className="space-y-1.5">
          <Label htmlFor="reg-name">Full name</Label>
          <Input
            id="reg-name"
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(fieldErrs.name)}
            aria-describedby={fieldErrs.name ? 'reg-name-error' : undefined}
            required
          />
          <FieldError id="reg-name-error" message={fieldErrs.name} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reg-email">Email</Label>
          <Input
            id="reg-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrs.email)}
            aria-describedby={fieldErrs.email ? 'reg-email-error' : undefined}
            required
          />
          <FieldError id="reg-email-error" message={fieldErrs.email} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reg-password">Password</Label>
          <Input
            id="reg-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(fieldErrs.password)}
            aria-describedby={
              fieldErrs.password ? 'reg-password-help reg-password-error' : 'reg-password-help'
            }
            required
          />
          <p id="reg-password-help" className="text-xs text-muted-foreground">
            At least 8 characters.
          </p>
          <FieldError id="reg-password-error" message={fieldErrs.password} />
        </div>

        {isDoctor ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="reg-specialization">Specialization</Label>
              <Input
                id="reg-specialization"
                name="specialization"
                type="text"
                placeholder="e.g. Cardiology"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                aria-invalid={Boolean(fieldErrs.specialization)}
                aria-describedby={fieldErrs.specialization ? 'reg-specialization-error' : undefined}
                required
              />
              <FieldError id="reg-specialization-error" message={fieldErrs.specialization} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reg-biography">Biography (optional)</Label>
              <textarea
                id="reg-biography"
                name="biography"
                rows={3}
                className="flex w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-ink shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 aria-[invalid=true]:border-danger-text"
                value={biography}
                onChange={(e) => setBiography(e.target.value)}
                aria-invalid={Boolean(fieldErrs.biography)}
                aria-describedby={fieldErrs.biography ? 'reg-biography-error' : undefined}
              />
              <FieldError id="reg-biography-error" message={fieldErrs.biography} />
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="reg-contact">Contact details (optional)</Label>
            <Input
              id="reg-contact"
              name="contactDetails"
              type="text"
              placeholder="Phone or email"
              value={contactDetails}
              onChange={(e) => setContactDetails(e.target.value)}
              aria-invalid={Boolean(fieldErrs.contactDetails)}
              aria-describedby={fieldErrs.contactDetails ? 'reg-contact-error' : undefined}
            />
            <FieldError id="reg-contact-error" message={fieldErrs.contactDetails} />
          </div>
        )}

        <Button
          type="submit"
          variant="cta"
          size="xl"
          className="w-full"
          disabled={submitting}
        >
          {submitting
            ? 'Creating account…'
            : isDoctor
              ? 'Create doctor account'
              : 'Create patient account'}
        </Button>
      </form>
    </AuthFrame>
  );
}

export function PatientRegisterScreen() {
  return <RegisterScreen role="PATIENT" />;
}

export function DoctorRegisterScreen() {
  return <RegisterScreen role="DOCTOR" />;
}

// ---------------------------------------------------------------------------
// Role chooser (/register)
// ---------------------------------------------------------------------------

export function RegisterChooserScreen() {
  return (
    <AuthFrame
      title="Create an account"
      subtitle="Choose the account type that fits you."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-ink underline underline-offset-4" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-3">
        <Button asChild variant="cta" size="xl" className="w-full">
          <Link to="/register/patient">I&apos;m a patient</Link>
        </Button>
        <Button asChild variant="outline" size="xl" className="w-full">
          <Link to="/register/doctor">I&apos;m a doctor</Link>
        </Button>
      </div>
    </AuthFrame>
  );
}