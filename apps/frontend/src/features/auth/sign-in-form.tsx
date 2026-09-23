import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HOME_BY_ROLE } from '@/app/nav';
import { useAuth } from './auth-context';
import { parseAuthError, type FieldErrors, type ParsedAuthError } from './auth-api-errors';

/**
 * The sign-in form, extracted so the dedicated /login route and the landing
 * page's hero panel share ONE implementation rather than two that drift.
 *
 * The form owns the whole auth interaction — field state, the `login()` call,
 * `parseAuthError` mapping, the 401/403 error surfaces, and the post-login
 * redirect to `HOME_BY_ROLE[role]`. Callers supply only presentation: the
 * heading copy and, on the landing page, the surrounding panel chrome.
 *
 * `idPrefix` namespaces the input ids/aria wiring. Both mount points are
 * distinct routes so they never coexist in the DOM, but the prefix keeps the
 * labels correctly associated if that ever changes (and keeps the landing
 * page's field ids from colliding with an embedding page's own).
 */
export interface SignInFormProps {
  /** Namespaces input ids and aria-describedby targets. */
  idPrefix: string;
  /** Label above the email field. */
  submitLabel?: string;
  /** Rendered under the fields — registration links etc. */
  footer?: React.ReactNode;
  /**
   * Button variant for the submit control.
   *
   * Defaults to `cta` — the coral, large-and-bold treatment v3 reserves for the
   * single most prominent action on a screen. The /login route also renders
   * this form, and its submit IS that screen's primary action, so the default
   * is correct in both mount points today. The prop exists so a future caller
   * can opt out rather than being stuck with coral.
   */
  submitVariant?: React.ComponentProps<typeof Button>['variant'];
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

interface LocationState {
  from?: string;
}

/**
 * The intended path a guarded route bounced the user away from, if any.
 * Exported because LoginScreen's already-signed-in redirect reads the same
 * state, and the two must agree on its shape.
 */
export function useRedirectAfterAuth(): string | null {
  const location = useLocation();
  return React.useMemo(() => {
    const state = location.state as LocationState | null;
    return state?.from ?? null;
  }, [location.state]);
}

export function SignInForm({
  idPrefix,
  submitLabel = 'Sign in',
  footer,
  submitVariant = 'cta',
}: SignInFormProps) {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<ParsedAuthError | null>(null);

  // A guarded route bounced here with the intended path in location.state.
  // Absent on the landing page, which routes to the role home instead.
  const redirectTo = useRedirectAfterAuth();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const next = await login({ email: email.trim(), password });
      navigate(redirectTo ?? HOME_BY_ROLE[next.role], { replace: true });
    } catch (err) {
      setError(parseAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldErrs: FieldErrors = error?.fields ?? {};
  const emailId = `${idPrefix}-email`;
  const passwordId = `${idPrefix}-password`;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormAlert error={error} />

      <div className="space-y-1.5">
        <Label htmlFor={emailId}>Email</Label>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(fieldErrs.email)}
          aria-describedby={fieldErrs.email ? `${emailId}-error` : undefined}
          required
        />
        <FieldError id={`${emailId}-error`} message={fieldErrs.email} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={passwordId}>Password</Label>
        <Input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrs.password)}
          aria-describedby={fieldErrs.password ? `${passwordId}-error` : undefined}
          required
        />
        <FieldError id={`${passwordId}-error`} message={fieldErrs.password} />
      </div>

      <Button type="submit" variant={submitVariant} className="w-full" size="lg" disabled={submitting}>
        {submitting ? 'Signing in…' : submitLabel}
      </Button>

      {footer}
    </form>
  );
}
