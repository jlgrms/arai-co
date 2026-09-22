import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Users,
  Stethoscope,
  CalendarCheck,
  ScrollText,
  CalendarDays,
  UserRound,
  FileText,
  Search,
  ClipboardList,
} from 'lucide-react';

import type { Role } from '@/features/auth/types';

export interface NavItem {
  /** Router path this item links to. */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match only this exact path (used for a section root that owns subroutes). */
  end?: boolean;
}

/**
 * Per-role primary navigation. Single source of truth for both the desktop
 * sidebar and the mobile overlay drawer — render from this array only.
 *
 * Structure confirmed with the stakeholder:
 *  Patient: Discover Doctors · Book Appointment · My Appointments · Medical Records · Profile
 *  Doctor:  Schedule · Patients · Consultations · Profile
 *  Admin:   Dashboard · Users · Doctor Review · Appointments · Audit Log
 */
export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  PATIENT: [
    { to: '/patient/discover', label: 'Discover Doctors', icon: Search },
    { to: '/patient/book', label: 'Book Appointment', icon: CalendarCheck },
    { to: '/patient/appointments', label: 'My Appointments', icon: CalendarDays },
    { to: '/patient/records', label: 'Medical Records', icon: FileText },
    { to: '/patient/profile', label: 'Profile', icon: UserRound },
  ],
  DOCTOR: [
    { to: '/doctor/schedule', label: 'Schedule', icon: CalendarDays },
    { to: '/doctor/patients', label: 'Patients', icon: Users },
    { to: '/doctor/consultations', label: 'Consultations', icon: Stethoscope },
    { to: '/doctor/profile', label: 'Profile', icon: UserRound },
  ],
  ADMIN: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/doctors', label: 'Doctor Review', icon: ClipboardList },
    { to: '/admin/appointments', label: 'Appointments', icon: CalendarCheck },
    { to: '/admin/audit', label: 'Audit Log', icon: ScrollText },
  ],
};

/** Landing route after sign-in, by role. */
export const HOME_BY_ROLE: Record<Role, string> = {
  PATIENT: '/patient/discover',
  DOCTOR: '/doctor/schedule',
  ADMIN: '/admin',
};

/** The sign-in route unauthenticated users are redirected to. */
export const LOGIN_PATH = '/login';

/** Public marketing site root. */
export const PUBLIC_HOME_PATH = '/';
