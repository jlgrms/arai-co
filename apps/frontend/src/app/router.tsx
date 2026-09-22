import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';

import { AppShell } from '@/components/layout/app-shell';
import { PlaceholderPage } from '@/components/layout/placeholder-page';
import StyleGuidePage from '@/dev/style-guide';
import {
  LoginScreen,
  PatientRegisterScreen,
  DoctorRegisterScreen,
  RegisterChooserScreen,
} from '@/features/auth/auth-screens';
import {
  NotFoundPlaceholder,
  PublicHomePlaceholder,
} from '@/features/public/public-screens';
import { PatientProfileScreen } from '@/features/patient/patient-profile-screen';
import { DoctorProfileScreen } from '@/features/doctor/doctor-profile-screen';
import { DiscoverDoctorsScreen } from '@/features/patient/discover-doctors-screen';
import { GuidedMatchingScreen } from '@/features/patient/guided-matching-screen';
import { BookAppointmentScreen } from '@/features/patient/book-appointment-screen';
import { MyAppointmentsScreen } from '@/features/patient/my-appointments-screen';
import { ConsultationWorkspaceScreen } from '@/features/patient/consultation-workspace-screen';
import { MedicalRecordsScreen } from '@/features/patient/medical-records-screen';
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
  { path: '/login', element: <LoginScreen /> },
  { path: '/register', element: <RegisterChooserScreen /> },
  { path: '/register/patient', element: <PatientRegisterScreen /> },
  { path: '/register/doctor', element: <DoctorRegisterScreen /> },

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
            element: <DiscoverDoctorsScreen />,
          },
          {
            path: '/patient/book',
            element: <GuidedMatchingScreen />,
          },
          {
            // Slot picker + book for one specific doctor. The id is in the URL so
            // the screen is linkable and survives a refresh.
            path: '/patient/book/:doctorId',
            element: <BookAppointmentScreen />,
          },
          {
            path: '/patient/appointments',
            element: <MyAppointmentsScreen />,
          },
          {
            // The consultation room for one session. Keyed by SESSION id (not
            // appointment id) — the two are different UUIDs, which is why the
            // appointment payload carries the session id alongside it.
            path: '/patient/consultations/:sessionId',
            element: <ConsultationWorkspaceScreen />,
          },
          {
            path: '/patient/records',
            element: <MedicalRecordsScreen />,
          },
          {
            path: '/patient/profile',
            element: <PatientProfileScreen />,
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
            element: <DoctorProfileScreen />,
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
