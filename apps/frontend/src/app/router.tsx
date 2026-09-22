import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';

import { AppShell } from '@/components/layout/app-shell';
import { PlaceholderPage } from '@/components/layout/placeholder-page';
import StyleGuidePage from '@/dev/style-guide';
import {
  LoginPlaceholder,
  NotFoundPlaceholder,
  PublicHomePlaceholder,
  RegisterPlaceholder,
} from '@/features/public/public-screens';
import { RequireRole } from './route-guard';

/**
 * Wraps the persistent shell around the matched nested route. Defined once and
 * reused by all three role trees so the chrome mounts identically per role.
 */
function AppShellWithOutlet() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

/**
 * Route tree.
 *
 * Public routes render standalone (no shell, no bell). Each role's routes are
 * nested under a single <RequireRole> guard that owns the persistent
 * <AppShell>, so the shell mounts once per role tree and children render into
 * its content area. A wrong-role hit is redirected to that user's own home by
 * the guard. Auth resolution happens inside the guard (loading screen), so no
 * guarded content ever flashes before the session is validated.
 */
export const router = createBrowserRouter([
  // --- Public surface ---
  { path: '/', element: <PublicHomePlaceholder /> },
  { path: '/login', element: <LoginPlaceholder /> },
  { path: '/register', element: <RegisterPlaceholder /> },
  { path: '/register/patient', element: <RegisterPlaceholder /> },
  { path: '/register/doctor', element: <RegisterPlaceholder /> },

  // --- Dev-only style reference ---
  { path: '/dev/style-guide', element: <StyleGuidePage /> },

  // --- Patient surface ---
  {
    element: <RequireRole allow={['PATIENT']} />,
    children: [
      {
        element: <AppShellWithOutlet />,
        children: [
          { path: '/patient', element: <Navigate to="/patient/discover" replace /> },
          {
            path: '/patient/discover',
            element: (
              <PlaceholderPage
                title="Discover Doctors"
                description="Browse and search doctors by specialty."
              />
            ),
          },
          {
            path: '/patient/book',
            element: (
              <PlaceholderPage
                title="Book Appointment"
                description="Guided entry: tell us how you feel and we will match a specialty."
              />
            ),
          },
          {
            path: '/patient/appointments',
            element: (
              <PlaceholderPage
                title="My Appointments"
                description="Upcoming, past, and cancelled consultations."
              />
            ),
          },
          {
            path: '/patient/records',
            element: (
              <PlaceholderPage
                title="Medical Records"
                description="Consultation history, notes, and prescriptions."
              />
            ),
          },
          {
            path: '/patient/profile',
            element: (
              <PlaceholderPage title="Profile" description="Your personal and medical details." />
            ),
          },
        ],
      },
    ],
  },

  // --- Doctor surface ---
  {
    element: <RequireRole allow={['DOCTOR']} />,
    children: [
      {
        element: <AppShellWithOutlet />,
        children: [
          { path: '/doctor', element: <Navigate to="/doctor/schedule" replace /> },
          {
            path: '/doctor/schedule',
            element: (
              <PlaceholderPage
                title="Schedule"
                description="Manage availability and block unavailable slots."
              />
            ),
          },
          {
            path: '/doctor/patients',
            element: (
              <PlaceholderPage title="Patients" description="Your patients and their records." />
            ),
          },
          {
            path: '/doctor/consultations',
            element: (
              <PlaceholderPage
                title="Consultations"
                description="Join sessions and record notes and prescriptions."
              />
            ),
          },
          {
            path: '/doctor/profile',
            element: (
              <PlaceholderPage title="Profile" description="Your biography and specialization." />
            ),
          },
        ],
      },
    ],
  },

  // --- Admin surface (no notification bell) ---
  {
    element: <RequireRole allow={['ADMIN']} />,
    children: [
      {
        element: <AppShellWithOutlet />,
        children: [
          {
            path: '/admin',
            element: (
              <PlaceholderPage
                title="Dashboard"
                description="Operational counts across users, doctors, and appointments."
              />
            ),
          },
          {
            path: '/admin/users',
            element: (
              <PlaceholderPage
                title="Users"
                description="Search and manage patient and doctor accounts."
              />
            ),
          },
          {
            path: '/admin/doctors',
            element: (
              <PlaceholderPage
                title="Doctor Review"
                description="Approve, reject, or update doctor profiles."
              />
            ),
          },
          {
            path: '/admin/appointments',
            element: (
              <PlaceholderPage
                title="Appointments"
                description="Oversee all appointments and consultation states."
              />
            ),
          },
          {
            path: '/admin/audit',
            element: (
              <PlaceholderPage
                title="Audit Log"
                description="Recorded admin actions with timestamps and reasons."
              />
            ),
          },
        ],
      },
    ],
  },

  // --- Fallback ---
  { path: '*', element: <NotFoundPlaceholder /> },
]);
