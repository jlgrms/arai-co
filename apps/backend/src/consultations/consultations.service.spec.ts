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
