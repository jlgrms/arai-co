import { ConsultationsService } from './consultations.service';

// ---------------------------------------------------------------------------
// Sub-item 5 — `join` must return ONE shape on every branch.
//
// `join` has two successful return paths:
//   1. the write, when the call actually changes state (changed === true)
//   2. the idempotent early-return of the already-loaded session (changed === false)
//
// These used to disagree: the early-return carried `appointment` (it comes from
// loadParticipantSession, which always includes it) while the update did not.
// A client therefore could not render the response safely — the patient
// consultation workspace crashed on the FIRST join for exactly this reason.
//
// These tests pin the invariant so the two branches can never drift again.
// ---------------------------------------------------------------------------
describe('ConsultationsService join response shape (sub-item 5)', () => {
  const baseSession = {
    id: 'sess-1',
    appointmentId: 'appt-1',
    state: 'SCHEDULED',
    joinedAt: null,
    patientJoinedAt: null,
    doctorJoinedAt: null,
    completedAt: null,
    appointment: {
      id: 'appt-1',
      patientProfileId: 'pat-1',
      doctorProfileId: 'doc-1',
      availabilityId: 'slot-1',
      status: 'BOOKED',
      scheduledAt: new Date('2026-09-24T14:00:00.000Z'),
    },
  };

  const makePrisma = (sessionOver: any = {}) => ({
    patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'pat-1' }) },
    doctorProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    consultationSession: {
      findUnique: jest.fn().mockResolvedValue({ ...baseSession, ...sessionOver }),
      update: jest
        .fn()
        .mockImplementation(({ data }) => ({ ...baseSession, ...sessionOver, ...data })),
    },
  });

  it('WRITE path asks Prisma for the appointment join', async () => {
    const prisma: any = makePrisma();
    await new ConsultationsService(prisma).join('user-pat', 'PATIENT', 'sess-1');

    const updated = prisma.consultationSession.update.mock.calls[0][0];
    expect(updated.include).toEqual({ appointment: true });
  });

  it('WRITE path advances SCHEDULED -> JOINED and records patient presence', async () => {
    const prisma: any = makePrisma();
    const result = await new ConsultationsService(prisma).join('user-pat', 'PATIENT', 'sess-1');

    expect(result.state).toBe('JOINED');
    const data = prisma.consultationSession.update.mock.calls[0][0].data;
    expect(data.patientJoinedAt).toBeInstanceOf(Date);
    expect(data.doctorJoinedAt).toBeUndefined();
  });

  it('IDEMPOTENT path carries the appointment too', async () => {
    // Already JOINED with the patient present -> applyJoin returns changed:false.
    const prisma: any = makePrisma({
      state: 'JOINED',
      joinedAt: new Date('2026-09-24T13:59:00.000Z'),
      patientJoinedAt: new Date('2026-09-24T13:59:00.000Z'),
    });
    const result = await new ConsultationsService(prisma).join('user-pat', 'PATIENT', 'sess-1');

    // No write happened...
    expect(prisma.consultationSession.update).not.toHaveBeenCalled();
    // ...and the returned object still satisfies the same shape contract.
    expect(result.appointment).toBeDefined();
    expect((result.appointment as any).scheduledAt).toBeInstanceOf(Date);
  });

  it('both branches expose the identical set of top-level keys', async () => {
    // The real invariant: a client can render either response with one code path.
    // Compared as sorted key sets so the assertion states the contract rather
    // than a particular field list.
    const writePrisma: any = makePrisma();
    const written = await new ConsultationsService(writePrisma).join(
      'user-pat',
      'PATIENT',
      'sess-1',
    );

    const idlePrisma: any = makePrisma({
      state: 'JOINED',
      patientJoinedAt: new Date('2026-09-24T13:59:00.000Z'),
    });
    const idle = await new ConsultationsService(idlePrisma).join('user-pat', 'PATIENT', 'sess-1');

    expect(Object.keys(written).sort()).toEqual(Object.keys(idle).sort());
    expect(Object.keys(written)).toContain('appointment');
  });

  it('complete also returns the appointment join (same shape contract)', async () => {
    const prisma: any = makePrisma({ state: 'IN_PROGRESS' });
    await new ConsultationsService(prisma).complete('user-doc', 'DOCTOR', 'sess-1');

    const updated = prisma.consultationSession.update.mock.calls[0][0];
    expect(updated.include).toEqual({ appointment: true });
  });

  it('a completed session rejects a re-join with 409 rather than returning a narrow shape', async () => {
    const prisma: any = makePrisma({ state: 'COMPLETED' });
    await expect(
      new ConsultationsService(prisma).join('user-pat', 'PATIENT', 'sess-1'),
    ).rejects.toThrow(/already completed/i);
    expect(prisma.consultationSession.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cancelled appointments must not be joinable.
//
// Found while sweeping the Layer 6/7 harnesses: POST /consultations/:id/join
// returned 201 for an appointment the patient had cancelled, moving a SCHEDULED
// session to JOINED. Two independent causes, both fixed here:
//   - the state machine is appointment-agnostic by design (pure, no Prisma), so
//     nothing in applyJoin can know the appointment was cancelled;
//   - a cancellation does not touch the session, which therefore stays SCHEDULED
//     and looks perfectly joinable.
//
// The guard lives in `join` alone. `loadParticipantSession` is shared by view /
// complete / records / notes, and gating there would break reading the records
// of a cancelled consultation -- the one thing a cancelled appointment SHOULD
// still allow.
// ---------------------------------------------------------------------------
describe('ConsultationsService join refuses a cancelled appointment', () => {
  const baseSession = {
    id: 'sess-1',
    appointmentId: 'appt-1',
    state: 'SCHEDULED',
    joinedAt: null,
    patientJoinedAt: null,
    doctorJoinedAt: null,
    completedAt: null,
    appointment: {
      id: 'appt-1',
      patientProfileId: 'pat-1',
      doctorProfileId: 'doc-1',
      availabilityId: 'slot-1',
      status: 'BOOKED',
      scheduledAt: new Date('2026-09-24T14:00:00.000Z'),
    },
  };

  const makePrisma = (sessionOver: any = {}, appointmentOver: any = {}) => ({
    patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'pat-1' }) },
    doctorProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    consultationSession: {
      findUnique: jest.fn().mockResolvedValue({
        ...baseSession,
        ...sessionOver,
        appointment: { ...baseSession.appointment, ...appointmentOver },
      }),
      update: jest.fn().mockImplementation(({ data }) => ({ ...baseSession, ...data })),
    },
  });

  it('the reported defect: a cancelled appointment is no longer joinable', async () => {
    // Exactly the state the live probe hit: appointment CANCELLED, session
    // still SCHEDULED. This used to return 201 and move the session to JOINED.
    const prisma: any = makePrisma({}, { status: 'CANCELLED' });
    await expect(
      new ConsultationsService(prisma).join('user-pat', 'PATIENT', 'sess-1'),
    ).rejects.toThrow(/cancelled/i);
    expect(prisma.consultationSession.update).not.toHaveBeenCalled();
  });

  it('rejects the doctor on a cancelled appointment too, not just the patient', async () => {
    // Cancellation is bilateral: the doctor must not be able to open a live
    // consultation for an appointment that no longer exists either.
    const prisma: any = makePrisma({}, { status: 'CANCELLED' });
    await expect(
      new ConsultationsService(prisma).join('user-doc', 'DOCTOR', 'sess-1'),
    ).rejects.toThrow(/cancelled/i);
    expect(prisma.consultationSession.update).not.toHaveBeenCalled();
  });

  it('uses a 409 (state conflict), matching the other join refusals', async () => {
    const prisma: any = makePrisma({}, { status: 'CANCELLED' });
    await expect(
      new ConsultationsService(prisma).join('user-pat', 'PATIENT', 'sess-1'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('a BOOKED appointment still joins normally', async () => {
    // The guard must be a cancellation check, not a blanket refusal.
    const prisma: any = makePrisma();
    const result = await new ConsultationsService(prisma).join('user-pat', 'PATIENT', 'sess-1');
    expect(result.state).toBe('JOINED');
  });

  it('a RESCHEDULED appointment still joins normally', async () => {
    // Rescheduling replaces the slot and re-uses the session; it is a live
    // appointment and must keep working.
    const prisma: any = makePrisma({}, { status: 'RESCHEDULED' });
    const result = await new ConsultationsService(prisma).join('user-pat', 'PATIENT', 'sess-1');
    expect(result.state).toBe('JOINED');
  });

  it('records for a cancelled appointment stay readable', async () => {
    // The reason the guard is NOT in loadParticipantSession: a patient whose
    // appointment was cancelled after the consultation still has a right to
    // that consultation's records.
    const prisma: any = makePrisma(
      { state: 'COMPLETED', completedAt: new Date('2026-09-01T10:30:00.000Z') },
      { status: 'CANCELLED' },
    );
    prisma.consultationNote = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.prescription = { findMany: jest.fn().mockResolvedValue([]) };

    const records = await new ConsultationsService(prisma).getSessionRecords(
      'user-pat',
      'PATIENT',
      'sess-1',
    );
    expect(records.sessionId).toBe('sess-1');
  });
});

// ---------------------------------------------------------------------------
// Layer 7 sub-item 3 — the doctor's records view must carry the SAME identity
// fields the patient's does.
//
// `getMyRecords` (records/me) returned completedAt/doctorName/specialization,
// while `getPatientRecordsForDoctor` (records/patient/:id) returned none of
// them. A doctor's records list therefore rendered with no clinician named and
// no completion date, and the two endpoints could not share a client type.
//
// The doctor endpoint additionally returns NON-completed sessions (READ_DOCTOR
// allows IN_PROGRESS), so it must also expose `state` and `scheduledAt`, and the
// counterparty is the patient rather than the doctor.
// ---------------------------------------------------------------------------
describe('ConsultationsService doctor records shape (Layer 7 sub-item 3)', () => {
  const completedSession = {
    id: 'sess-done',
    state: 'COMPLETED',
    completedAt: new Date('2026-09-01T10:30:00.000Z'),
    consultationNotes: [{ id: 'note-1', content: 'Patient improving' }],
    prescriptions: [{ id: 'rx-1', medication: 'Amoxicillin' }],
    appointment: {
      scheduledAt: new Date('2026-09-01T10:00:00.000Z'),
      doctorProfile: { name: 'Dr. Rohan Patel', specialization: 'General Medicine' },
      patientProfile: { name: 'Jordan Lee' },
    },
  };

  const upcomingSession = {
    id: 'sess-upcoming',
    state: 'JOINED',
    completedAt: null,
    consultationNotes: [{ id: 'note-should-not-leak', content: 'not visible yet' }],
    prescriptions: [{ id: 'rx-should-not-leak', medication: 'Nope' }],
    appointment: {
      scheduledAt: new Date('2026-09-24T14:00:00.000Z'),
      doctorProfile: { name: 'Dr. Rohan Patel', specialization: 'General Medicine' },
      patientProfile: { name: 'Jordan Lee' },
    },
  };

  const makePrisma = (sessions: any[], appointmentCount = sessions.length) => ({
    doctorProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    appointment: { count: jest.fn().mockResolvedValue(appointmentCount) },
    consultationSession: { findMany: jest.fn().mockResolvedValue(sessions) },
  });

  it('exposes the identity fields the patient endpoint exposes', async () => {
    const prisma: any = makePrisma([completedSession]);
    const [record] = await new ConsultationsService(prisma).getPatientRecordsForDoctor(
      'user-doc',
      'pat-1',
    );

    // The exact fields that were missing before this fix.
    expect(record.doctorName).toBe('Dr. Rohan Patel');
    expect(record.specialization).toBe('General Medicine');
    expect(record.completedAt).toEqual(completedSession.completedAt);
    // The doctor-side counterparty.
    expect(record.patientName).toBe('Jordan Lee');
    // Plus the doctor-only fields that let upcoming sessions render.
    expect(record.state).toBe('COMPLETED');
    expect(record.scheduledAt).toEqual(completedSession.appointment.scheduledAt);
  });

  it('still returns clinical content for a COMPLETED session', async () => {
    const prisma: any = makePrisma([completedSession]);
    const [record] = await new ConsultationsService(prisma).getPatientRecordsForDoctor(
      'user-doc',
      'pat-1',
    );
    expect(record.notes).toHaveLength(1);
    expect(record.prescriptions).toHaveLength(1);
  });

  it('withholds clinical content on a non-COMPLETED session but still describes it', async () => {
    // READ_DOCTOR permits IN_PROGRESS/COMPLETED only. A JOINED session is
    // listed (so the doctor sees the upcoming consultation) with empty content.
    const prisma: any = makePrisma([upcomingSession]);
    const [record] = await new ConsultationsService(prisma).getPatientRecordsForDoctor(
      'user-doc',
      'pat-1',
    );

    expect(record.notes).toEqual([]);
    expect(record.prescriptions).toEqual([]);
    expect(record.state).toBe('JOINED');
    expect(record.completedAt).toBeNull();
    expect(record.patientName).toBe('Jordan Lee');
  });

  it('joins the patient profile so patientName is never undefined', async () => {
    const prisma: any = makePrisma([completedSession]);
    await new ConsultationsService(prisma).getPatientRecordsForDoctor('user-doc', 'pat-1');

    const include = prisma.consultationSession.findMany.mock.calls[0][0].include;
    expect(include.appointment.include.patientProfile).toBe(true);
    expect(include.appointment.include.doctorProfile).toBe(true);
  });

  it('refuses when the doctor has no appointment with the patient', async () => {
    const prisma: any = makePrisma([], 0);
    await expect(
      new ConsultationsService(prisma).getPatientRecordsForDoctor('user-doc', 'stranger'),
    ).rejects.toThrow(/no appointments with this patient/i);
  });

  it('returns the same top-level key set for both endpoints', async () => {
    // The contract that lets one client type serve both screens.
    const prisma: any = makePrisma([completedSession]);
    const svc = new ConsultationsService(prisma);
    const [doctorRecord] = await svc.getPatientRecordsForDoctor('user-doc', 'pat-1');

    // records/me path, mocked against the same session.
    prisma.patientProfile = { findUnique: jest.fn().mockResolvedValue({ id: 'pat-1' }) };
    prisma.consultationSession.findMany = jest.fn().mockResolvedValue([completedSession]);
    const [patientRecord] = await svc.getMyRecords('user-pat');

    const doctorKeys = Object.keys(doctorRecord).sort();
    const patientKeys = Object.keys(patientRecord).sort();
    // Doctor-only extras are state/scheduledAt/patientName; everything the
    // patient sees must be present on the doctor's row too.
    for (const key of patientKeys) {
      expect(doctorKeys).toContain(key);
    }
  });
});
