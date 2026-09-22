import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_STATUSES,
  appointmentStatusLabel,
  appointmentStatusVariant,
  buildCancelBody,
  canAdminCancel,
  cancelConfirmCopy,
  countIncoherent,
  EMPTY_FILTERS,
  filterAppointments,
  hasActiveFilters,
  isIncoherent,
  mergeCancelledAppointment,
  profileName,
  resultSummary,
  sessionStateLabel,
  sessionStateVariant,
  slotReleased,
  summarizeStatus,
  type AdminAppointment,
  type AppointmentStatus,
  type CancelledAppointmentRow,
  type ConsultationState,
} from './admin-appointment-types';

function appointment(overrides: Partial<AdminAppointment> = {}): AdminAppointment {
  return {
    id: 'a1',
    status: 'BOOKED',
    scheduledAt: '2026-09-24T09:00:00.000Z',
    availabilityId: 'av1',
    patientProfile: { id: 'pp1', name: 'Sam Rivera' },
    doctorProfile: { id: 'dp1', name: 'Dr. Amara Okafor', specialization: 'Cardiology' },
    consultationSession: { id: 's1', state: 'SCHEDULED' },
    ...overrides,
  };
}

describe('status labels and variants', () => {
  it('renders appointment states in plain language, never the raw enum', () => {
    expect(appointmentStatusLabel('BOOKED')).toBe('Scheduled');
    expect(appointmentStatusLabel('RESCHEDULED')).toBe('Rescheduled');
    expect(appointmentStatusLabel('CANCELLED')).toBe('Cancelled');
    expect(appointmentStatusLabel('COMPLETED')).toBe('Completed');
  });

  it('uses the same colour language as the patient screen', () => {
    // success = will happen, danger = will not, muted = history.
    expect(appointmentStatusVariant('BOOKED')).toBe('success');
    expect(appointmentStatusVariant('RESCHEDULED')).toBe('success');
    expect(appointmentStatusVariant('CANCELLED')).toBe('danger');
    expect(appointmentStatusVariant('COMPLETED')).toBe('muted');
  });

  it('lists all four statuses for the filter', () => {
    expect(APPOINTMENT_STATUSES).toEqual([
      'BOOKED',
      'RESCHEDULED',
      'CANCELLED',
      'COMPLETED',
    ]);
  });

  it('renders session states distinctly from appointment states', () => {
    expect(sessionStateLabel('SCHEDULED')).toBe('Not started');
    expect(sessionStateLabel('JOINED')).toBe('Waiting');
    expect(sessionStateLabel('IN_PROGRESS')).toBe('In progress');
    expect(sessionStateLabel('COMPLETED')).toBe('Completed');
  });

  it('treats a not-yet-started session as the quietest badge', () => {
    expect(sessionStateVariant('SCHEDULED')).toBe('outline');
    expect(sessionStateVariant('JOINED')).toBe('default');
    expect(sessionStateVariant('IN_PROGRESS')).toBe('default');
    expect(sessionStateVariant('COMPLETED')).toBe('muted');
  });
});

describe('isIncoherent', () => {
  it('flags a live session left on a cancelled or completed appointment', () => {
    expect(isIncoherent('CANCELLED', 'JOINED')).toBe(true);
    expect(isIncoherent('CANCELLED', 'IN_PROGRESS')).toBe(true);
    expect(isIncoherent('COMPLETED', 'JOINED')).toBe(true);
    expect(isIncoherent('COMPLETED', 'IN_PROGRESS')).toBe(true);
  });

  it('flags a finished consultation on an appointment that is still live', () => {
    expect(isIncoherent('BOOKED', 'COMPLETED')).toBe(true);
    expect(isIncoherent('RESCHEDULED', 'COMPLETED')).toBe(true);
  });

  it('flags a finished consultation on a cancelled appointment', () => {
    // Both are "the end", but they cannot both be true.
    expect(isIncoherent('CANCELLED', 'COMPLETED')).toBe(true);
  });

  it('does NOT flag a merely stale SCHEDULED session on an over appointment', () => {
    // A session that never started need not have been cleaned up when the
    // appointment ended; flagging this would light up ordinary rows.
    expect(isIncoherent('CANCELLED', 'SCHEDULED')).toBe(false);
    expect(isIncoherent('COMPLETED', 'SCHEDULED')).toBe(false);
  });

  it('accepts a matching terminal pair', () => {
    expect(isIncoherent('COMPLETED', 'COMPLETED')).toBe(false);
  });

  it('accepts a live session on a live appointment', () => {
    expect(isIncoherent('BOOKED', 'SCHEDULED')).toBe(false);
    expect(isIncoherent('BOOKED', 'JOINED')).toBe(false);
    expect(isIncoherent('BOOKED', 'IN_PROGRESS')).toBe(false);
  });

  it('never flags a missing session', () => {
    expect(isIncoherent('CANCELLED', null)).toBe(false);
    expect(isIncoherent('BOOKED', null)).toBe(false);
  });
});

describe('canAdminCancel', () => {
  it('offers cancel only where it is meaningful', () => {
    expect(canAdminCancel('BOOKED')).toBe(true);
    expect(canAdminCancel('RESCHEDULED')).toBe(true);
  });

  it('omits cancel on terminal states', () => {
    // Re-cancelling a CANCELLED row is a silent no-op server-side (no second
    // audit entry), so offering it would suggest an action that leaves no trace.
    expect(canAdminCancel('CANCELLED')).toBe(false);
    expect(canAdminCancel('COMPLETED')).toBe(false);
  });

  it('agrees with the patient screen about which states are live', () => {
    // Both derive from isActionable, so they cannot drift. Asserted here as a
    // regression guard on that shared dependency.
    const statuses: AppointmentStatus[] = ['BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED'];
    for (const s of statuses) {
      expect(canAdminCancel(s)).toBe(s === 'BOOKED' || s === 'RESCHEDULED');
    }
  });
});

describe('profileName', () => {
  it('prefers the profile name', () => {
    expect(profileName({ name: 'Sam Rivera' }, 'the patient')).toBe('Sam Rivera');
  });

  it('falls back to the role label when the name is null', () => {
    expect(profileName({ name: null }, 'the patient')).toBe('the patient');
  });

  it('treats a whitespace-only name as absent', () => {
    expect(profileName({ name: '   ' }, 'the patient')).toBe('the patient');
  });

  it('treats a missing profile as absent', () => {
    expect(profileName(null, 'the doctor')).toBe('the doctor');
  });
});

describe('slotReleased', () => {
  it('reports a released slot when the FK is null', () => {
    expect(slotReleased(appointment({ availabilityId: null }))).toBe(true);
  });

  it('reports a held slot when the FK is set', () => {
    expect(slotReleased(appointment({ availabilityId: 'av1' }))).toBe(false);
  });
});

describe('filterAppointments', () => {
  it('returns everything when no filter is active', () => {
    const rows = [appointment({ id: 'a' }), appointment({ id: 'b', status: 'COMPLETED' })];
    expect(filterAppointments(rows, EMPTY_FILTERS)).toHaveLength(2);
  });

  it('narrows by status', () => {
    const rows = [
      appointment({ id: 'a', status: 'BOOKED' }),
      appointment({ id: 'b', status: 'COMPLETED' }),
      appointment({ id: 'c', status: 'COMPLETED' }),
    ];
    const result = filterAppointments(rows, { status: 'COMPLETED', q: '' });
    expect(result.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('matches either party name, case-insensitively', () => {
    const rows = [
      appointment({ id: 'a', patientProfile: { id: 'pp1', name: 'Sam Rivera' } }),
      appointment({ id: 'b', patientProfile: { id: 'pp2', name: 'Jordan Lee' } }),
    ];
    expect(filterAppointments(rows, { status: 'ALL', q: 'jordan' }).map((r) => r.id)).toEqual([
      'b',
    ]);
    expect(filterAppointments(rows, { status: 'ALL', q: 'sam' }).map((r) => r.id)).toEqual(['a']);
  });

  it('matches the doctor name and specialization', () => {
    const rows = [
      appointment({
        id: 'a',
        doctorProfile: { id: 'dp1', name: 'Dr. Amara Okafor', specialization: 'Cardiology' },
      }),
      appointment({
        id: 'b',
        doctorProfile: { id: 'dp2', name: 'Dr. Mateo Silva', specialization: 'Dermatology' },
      }),
    ];
    expect(filterAppointments(rows, { status: 'ALL', q: 'okafor' }).map((r) => r.id)).toEqual([
      'a',
    ]);
    expect(filterAppointments(rows, { status: 'ALL', q: 'dermatology' }).map((r) => r.id)).toEqual(
      ['b'],
    );
  });

  it('applies status and text together', () => {
    const rows = [
      appointment({ id: 'a', status: 'BOOKED', patientProfile: { id: 'pp1', name: 'Sam Rivera' } }),
      appointment({
        id: 'b',
        status: 'COMPLETED',
        patientProfile: { id: 'pp1', name: 'Sam Rivera' },
      }),
    ];
    const result = filterAppointments(rows, { status: 'BOOKED', q: 'sam' });
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('tolerates a null profile name without throwing', () => {
    const rows = [appointment({ patientProfile: { id: 'pp1', name: null } })];
    expect(filterAppointments(rows, { status: 'ALL', q: 'sam' })).toHaveLength(0);
    expect(filterAppointments(rows, { status: 'ALL', q: '' })).toHaveLength(1);
  });
});

describe('hasActiveFilters / resultSummary', () => {
  it('reports no active filter for the empty set', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it('detects each kind of active filter', () => {
    expect(hasActiveFilters({ status: 'BOOKED', q: '' })).toBe(true);
    expect(hasActiveFilters({ status: 'ALL', q: 'sam' })).toBe(true);
    expect(hasActiveFilters({ status: 'ALL', q: '   ' })).toBe(false);
  });

  it('returns null for an empty result set', () => {
    expect(resultSummary(0, EMPTY_FILTERS)).toBeNull();
  });

  it('pluralises and reflects whether a filter is active', () => {
    expect(resultSummary(1, EMPTY_FILTERS)).toBe('1 appointment shown');
    expect(resultSummary(7, EMPTY_FILTERS)).toBe('7 appointments shown');
    expect(resultSummary(2, { status: 'BOOKED', q: '' })).toBe('2 matching appointments shown');
  });
});

describe('summarizeStatus', () => {
  it('counts each state', () => {
    const rows = [
      appointment({ status: 'BOOKED' }),
      appointment({ status: 'BOOKED' }),
      appointment({ status: 'CANCELLED' }),
      appointment({ status: 'COMPLETED' }),
    ];
    expect(summarizeStatus(rows)).toEqual({
      BOOKED: 2,
      RESCHEDULED: 0,
      CANCELLED: 1,
      COMPLETED: 1,
    });
  });

  it('returns all-zero for an empty list', () => {
    expect(summarizeStatus([])).toEqual({ BOOKED: 0, RESCHEDULED: 0, CANCELLED: 0, COMPLETED: 0 });
  });
});

describe('countIncoherent', () => {
  it('counts only the impossible pairs', () => {
    const rows = [
      appointment({ status: 'CANCELLED', consultationSession: { id: 's1', state: 'IN_PROGRESS' } }),
      appointment({ status: 'CANCELLED', consultationSession: { id: 's2', state: 'SCHEDULED' } }),
      appointment({ status: 'BOOKED', consultationSession: { id: 's3', state: 'JOINED' } }),
      appointment({ status: 'COMPLETED', consultationSession: { id: 's4', state: 'COMPLETED' } }),
    ];
    expect(countIncoherent(rows)).toBe(1);
  });

  it('ignores rows with no session', () => {
    expect(countIncoherent([appointment({ consultationSession: null })])).toBe(0);
  });
});

describe('buildCancelBody', () => {
  it('omits the reason entirely when blank', () => {
    // An empty audit reason and a missing one should be the same thing — an
    // empty string would put a blank `reason` on the AuditLog row.
    expect(buildCancelBody('')).toEqual({});
    expect(buildCancelBody('   ')).toEqual({});
  });

  it('sends a trimmed reason when provided', () => {
    expect(buildCancelBody('  Patient requested  ')).toEqual({ reason: 'Patient requested' });
  });

  it('is a valid (non-400) body even with no reason', () => {
    // Unlike the doctor-review PATCH, {} is the normal payload here.
    expect(Object.keys(buildCancelBody(''))).toHaveLength(0);
  });
});

describe('cancelConfirmCopy', () => {
  it('names both parties', () => {
    const copy = cancelConfirmCopy(appointment());
    expect(copy.description).toContain('Sam Rivera');
    expect(copy.description).toContain('Dr. Amara Okafor');
  });

  it('states both consequences the admin cannot see from the row', () => {
    const copy = cancelConfirmCopy(appointment());
    expect(copy.description).toMatch(/slot released/i);
    expect(copy.description).toMatch(/notified/i);
  });

  it('degrades gracefully when a name is missing', () => {
    const copy = cancelConfirmCopy(
      appointment({
        patientProfile: { id: 'pp1', name: null },
        doctorProfile: { id: 'dp1', name: null, specialization: 'Cardiology' },
      }),
    );
    expect(copy.description).toContain('the patient');
    expect(copy.description).toContain('the doctor');
  });

  it('labels the confirm action unambiguously', () => {
    expect(cancelConfirmCopy(appointment()).confirmLabel).toBe('Cancel appointment');
  });
});

describe('consultation state coverage', () => {
  it('handles every session state without falling through', () => {
    const states: ConsultationState[] = ['SCHEDULED', 'JOINED', 'IN_PROGRESS', 'COMPLETED'];
    for (const state of states) {
      expect(sessionStateLabel(state)).toBeTruthy();
      expect(sessionStateVariant(state)).toBeTruthy();
    }
  });
});

describe('mergeCancelledAppointment', () => {
  // The cancel endpoint returns the RAW Appointment row with no relations —
  // see CancelledAppointmentRow. Replacing the loaded row with it dropped
  // patientProfile / doctorProfile / consultationSession and crashed the render.
  function cancelResponse(overrides: Partial<CancelledAppointmentRow> = {}): CancelledAppointmentRow {
    return {
      id: 'a1',
      patientProfileId: 'pp1',
      doctorProfileId: 'dp1',
      availabilityId: null,
      status: 'CANCELLED',
      scheduledAt: '2026-09-24T09:00:00.000Z',
      ...overrides,
    };
  }

  it('preserves the relations the cancel response omits', () => {
    const existing = appointment();
    const merged = mergeCancelledAppointment(existing, cancelResponse());
    // These are the three the response does NOT carry — losing any is the crash.
    expect(merged.patientProfile).toEqual(existing.patientProfile);
    expect(merged.doctorProfile).toEqual(existing.doctorProfile);
    expect(merged.consultationSession).toEqual(existing.consultationSession);
  });

  it('does not throw when the screen reads session state after a cancel', () => {
    // The exact expression that blew up in production:
    //   a.consultationSession.state
    const merged = mergeCancelledAppointment(appointment(), cancelResponse());
    expect(() => merged.consultationSession!.state).not.toThrow();
    expect(merged.consultationSession!.state).toBe('SCHEDULED');
  });

  it('takes the fields the endpoint actually changes', () => {
    const merged = mergeCancelledAppointment(appointment(), cancelResponse());
    expect(merged.status).toBe('CANCELLED');
    expect(merged.availabilityId).toBeNull();
  });

  it('keeps the row identifiable and filterable after the merge', () => {
    const existing = appointment({ patientProfile: { id: 'pp1', name: 'Sam Rivera' } });
    const merged = mergeCancelledAppointment(existing, cancelResponse());
    expect(merged.id).toBe(existing.id);
    // Name search must still work on the cancelled row.
    expect(profileName(merged.patientProfile, 'The patient')).toBe('Sam Rivera');
  });

  it('produces a row that still summarizes and counts coherently', () => {
    const existing = appointment();
    const merged = mergeCancelledAppointment(existing, cancelResponse());
    const summary = summarizeStatus([merged]);
    expect(summary.CANCELLED).toBe(1);
    expect(summary.BOOKED).toBe(0);
    // CANCELLED + a merely SCHEDULED session is NOT incoherent.
    expect(countIncoherent([merged])).toBe(0);
  });
});
