import * as React from 'react';
import { api, ApiError, setTokenGetter } from '@/lib/api-client';
import type {
  AuthResponse,
  AuthUser,
  LoginInput,
  RegisterDoctorInput,
  RegisterPatientInput,
} from './types';

/**
 * Token storage: localStorage.
 *
 * PROTOTYPE TRADEOFF (confirmed with stakeholder): the access token is kept in
 * localStorage so a hard reload does not drop the session mid-demo. localStorage
 * is readable by any injected script (XSS), so the production fix is an httpOnly,
 * Secure, SameSite cookie set by the backend — which would require an auth-flow
 * change in Layer 3 (out of scope to alter now). Documented in the README.
 */
const TOKEN_KEY = 'aray.accessToken';
const USER_KEY = 'aray.authUser';

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthUser;
    if (parsed && typeof parsed.userId === 'string' && typeof parsed.role === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function persistSession(res: AuthResponse): AuthUser {
  const user: AuthUser = { userId: res.userId, role: res.role };
  localStorage.setItem(TOKEN_KEY, res.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export interface AuthContextValue {
  user: AuthUser | null;
  /** True while the persisted session is being validated on first load. */
  initializing: boolean;
  /** Set when a session was force-ended (e.g. account suspended) — for a one-line notice. */
  sessionEndedReason: string | null;
  login: (input: LoginInput) => Promise<AuthUser>;
  registerPatient: (input: RegisterPatientInput) => Promise<AuthUser>;
  registerDoctor: (input: RegisterDoctorInput) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

// Wire the api-client's token getter once, at module load, so non-React code
// (loaders, etc.) always sees the current token.
setTokenGetter(() => localStorage.getItem(TOKEN_KEY));

/** Endpoint used to prove a stored token is still valid, per role. */
function meEndpointForRole(role: AuthUser['role']): string {
  if (role === 'PATIENT') return '/patients/me';
  if (role === 'DOCTOR') return '/doctors/me';
  // Admin has no /me route in Layer 4; rely on a guarded admin endpoint later.
  // Until then, trust the stored admin token (bootstrap validation is a no-op).
  return '';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [initializing, setInitializing] = React.useState(true);
  const [sessionEndedReason, setSessionEndedReason] = React.useState<string | null>(null);

  // Bootstrap: if we have a stored token+user, validate it against a guarded
  // endpoint so a stale/revoked/suspended session does not render a shell.
  React.useEffect(() => {
    let cancelled = false;
    const stored = readStoredUser();
    const token = localStorage.getItem(TOKEN_KEY);

    if (!stored || !token) {
      clearSession();
      setInitializing(false);
      return;
    }

    const endpoint = meEndpointForRole(stored.role);
    if (!endpoint) {
      // No validation route for this role; accept the stored session.
      setUser(stored);
      setInitializing(false);
      return;
    }

    api
      .get(endpoint)
      .then(() => {
        if (!cancelled) setUser(stored);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 401 = invalid/expired token; 403 = account no longer ACTIVE.
        // Either way the stored session is unusable — end it cleanly.
        if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
          clearSession();
          setUser(null);
          if (err.isForbidden) setSessionEndedReason(err.message);
        } else {
          // Network/5xx during bootstrap: keep the ephemeral session rather than
          // logging out on a transient error; guarded pages will re-check.
          setUser(stored);
        }
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = React.useCallback(async (input: LoginInput) => {
    const res = await api.post<AuthResponse>('/auth/login', input, { anonymous: true });
    setSessionEndedReason(null);
    const next = persistSession(res);
    setUser(next);
    return next;
  }, []);

  const registerPatient = React.useCallback(async (input: RegisterPatientInput) => {
    const res = await api.post<AuthResponse>('/auth/register/patient', input, {
      anonymous: true,
    });
    setSessionEndedReason(null);
    const next = persistSession(res);
    setUser(next);
    return next;
  }, []);

  const registerDoctor = React.useCallback(async (input: RegisterDoctorInput) => {
    const res = await api.post<AuthResponse>('/auth/register/doctor', input, {
      anonymous: true,
    });
    setSessionEndedReason(null);
    const next = persistSession(res);
    setUser(next);
    return next;
  }, []);

  const logout = React.useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      sessionEndedReason,
      login,
      registerPatient,
      registerDoctor,
      logout,
    }),
    [user, initializing, sessionEndedReason, login, registerPatient, registerDoctor, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
