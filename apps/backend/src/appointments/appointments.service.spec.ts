import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { AppointmentsService } from './appointments.service';

const slot = (id: string, h: number) => ({
  id,
  doctorProfileId: 'doc-1',
  startTime: new Date(`2026-05-01T${String(h).padStart(2, '0')}:00:00.000Z`),
  endTime: new Date(`2026-05-01T${String(h + 1).padStart(2, '0')}:00:00.000Z`),
  isBlocked: false,
});

describe('AppointmentsService (sub-item 5)', () => {
  it('book: derives doctor/patient/scheduledAt from slot + JWT (no spoofing)', async () => {
    const prisma: any = {
      patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'pat-1', name: 'Pat' }) },
      doctorProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'doc-1', userId: 'user-doc', name: 'Dr. D' }) },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      availability: { findUnique: jest.fn().mockResolvedValue(slot('slot-1', 9)) },
      appointment: {
        findMany: jest.fn().mockResolvedValue([]), // no conflicts
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'appt-1', ...data })),
      },
    };
    const svc = new AppointmentsService(prisma);
    const res = await svc.book('user-1', { availabilityId: 'slot-1' });
    expect(res.patientProfileId).toBe('pat-1');
    expect(res.doctorProfileId).toBe('doc-1');
    expect(res.status).toBe(AppointmentStatus.BOOKED);
  });

  it('book: conflict on an already-consumed slot -> 409', async () => {
    const prisma: any = {
      patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'pat-1' }) },
      availability: { findUnique: jest.fn().mockResolvedValue(slot('slot-1', 9)) },
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          { availabilityId: 'slot-1', scheduledAt: slot('slot-1', 9).startTime, status: 'BOOKED', availability: { startTime: slot('slot-1', 9).startTime, endTime: slot('slot-1', 9).endTime } },
        ]),
        create: jest.fn(),
      },
    };
    const svc = new AppointmentsService(prisma);
    await expect(svc.book('user-1', { availabilityId: 'slot-1' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('reschedule: updates SAME row to new slot and excludes itself from conflicts', async () => {
    const oldSlot = slot('slot-old', 9);
    const newSlot = slot('slot-new', 11);
    const prisma: any = {
      patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: "pat-1", name: "Pat" }) },
      doctorProfile: { findUnique: jest.fn().mockResolvedValue({ id: "doc-1", userId: "user-doc", name: "Dr. D" }) },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      availability: { findUnique: jest.fn().mockResolvedValue(newSlot) },
      appointment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'appt-1', patientProfileId: 'pat-1', doctorProfileId: 'doc-1', availabilityId: 'slot-old', status: 'BOOKED', scheduledAt: oldSlot.startTime,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'appt-1', ...data })),
      },
    };
    const svc = new AppointmentsService(prisma);
    const res = await svc.reschedule('user-1', 'appt-1', { availabilityId: 'slot-new' });
    expect(res.availabilityId).toBe('slot-new');
    expect(res.status).toBe(AppointmentStatus.RESCHEDULED);
    // the conflict query excluded the moving appointment by id
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'appt-1' } }) }),
    );
  });

  it('cancel: sets status CANCELLED AND releases the slot link (availabilityId -> null)', async () => {
    const prisma: any = {
      patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'pat-1', name: 'Pat' }) },
      doctorProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'doc-1', userId: 'user-doc', name: 'Dr. D' }) },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      appointment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'appt-1', patientProfileId: 'pat-1', doctorProfileId: 'doc-1', availabilityId: 'slot-1', status: 'BOOKED', scheduledAt: slot('slot-1', 9).startTime }),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'appt-1', ...data })),
      },
    };
    const svc = new AppointmentsService(prisma);
    const res = await svc.cancel('user-1', 'appt-1');
    expect(res.status).toBe(AppointmentStatus.CANCELLED);
    // The DB @unique constraint on availabilityId is what frees the slot; status
    // alone is insufficient. Nulling the FK releases it for re-booking.
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: AppointmentStatus.CANCELLED, availabilityId: null } }),
    );
  });

  it('re-book after cancel: freed slot has no active consumer -> create succeeds', async () => {
    // Reproduces the previously-failing scenario: an appointment was cancelled
    // (availabilityId released to null), so the slot is free and booking it again
    // must not hit the unique constraint.
    const prisma: any = {

      patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'pat-2', name: 'Pat 2' }) },
      doctorProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'doc-1', userId: 'user-doc', name: 'Dr. D' }) },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      availability: { findUnique: jest.fn().mockResolvedValue(slot('slot-1', 9)) },
      appointment: {
        // The cancelled appointment still exists for the doctor, but with
        // availabilityId = null -> it is not a consumer of slot-1.
        findMany: jest.fn().mockResolvedValue([
          { availabilityId: null, scheduledAt: slot('slot-1', 9).startTime, status: 'CANCELLED', availability: null },
        ]),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'appt-2', ...data })),
      },
    };
    const svc = new AppointmentsService(prisma);
    const res = await svc.book('user-2', { availabilityId: 'slot-1' });
    expect(res.availabilityId).toBe('slot-1');
    expect(res.status).toBe(AppointmentStatus.BOOKED);
    expect(prisma.appointment.create).toHaveBeenCalledTimes(1);
  });

  it('cancel: another patient cannot cancel -> 403', async () => {
    const prisma: any = {
      patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'pat-OTHER' }) },
      appointment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'appt-1', patientProfileId: 'pat-1', status: 'BOOKED' }),
        update: jest.fn(),
      },
    };
    const svc = new AppointmentsService(prisma);
    await expect(svc.cancel('user-2', 'appt-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sub-item 8 — Notification generation on book/reschedule/cancel.
// A Notification row must be written for BOTH affected parties each time.
// ---------------------------------------------------------------------------
describe('AppointmentsService notification generation (sub-item 8)', () => {
  // Factory for a prisma mock that records notification.createMany payloads.
  const makePrisma = (appt: any, extra: any = {}) => {
    const notification = { createMany: jest.fn().mockResolvedValue({ count: 2 }) };
    return {
      notification,
      patientProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 'pat-1', name: 'Pat Patient' }),
      },
      doctorProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 'doc-1', userId: 'user-doc', name: 'Dr. Dana' }),
      },
      availability: { findUnique: jest.fn().mockResolvedValue(slot('slot-1', 9)) },
      appointment: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(appt),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'appt-1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'appt-1', ...appt, ...data })),
        ...extra,
      },
    };
  };

  it('book: notifies BOTH patient and doctor with type BOOKING_CONFIRMED', async () => {
    const prisma: any = makePrisma(null);
    const svc = new AppointmentsService(prisma);
    await svc.book('user-pat', { availabilityId: 'slot-1' });

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.notification.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    const recipients = rows.map((r: any) => r.userId).sort();
    expect(recipients).toEqual(['user-doc', 'user-pat']); // both parties
    expect(rows.every((r: any) => r.type === 'BOOKING_CONFIRMED')).toBe(true);
  });

  it('reschedule: notifies BOTH parties with type APPOINTMENT_RESCHEDULED', async () => {
    const prisma: any = makePrisma({
      id: 'appt-1',
      patientProfileId: 'pat-1',
      doctorProfileId: 'doc-1',
      availabilityId: 'slot-old',
      status: 'BOOKED',
      scheduledAt: slot('slot-old', 9).startTime,
    });
    prisma.availability.findUnique = jest.fn().mockResolvedValue(slot('slot-new', 11));
    const svc = new AppointmentsService(prisma);
    await svc.reschedule('user-pat', 'appt-1', { availabilityId: 'slot-new' });

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.notification.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.userId).sort()).toEqual(['user-doc', 'user-pat']);
    expect(rows.every((r: any) => r.type === 'APPOINTMENT_RESCHEDULED')).toBe(true);
  });

  it('cancel: notifies BOTH parties with type APPOINTMENT_CANCELLED', async () => {
    const prisma: any = makePrisma({
      id: 'appt-1',
      patientProfileId: 'pat-1',
      doctorProfileId: 'doc-1',
      availabilityId: 'slot-1',
      status: 'BOOKED',
      scheduledAt: slot('slot-1', 9).startTime,
    });
    const svc = new AppointmentsService(prisma);
    await svc.cancel('user-pat', 'appt-1');

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.notification.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.userId).sort()).toEqual(['user-doc', 'user-pat']);
    expect(rows.every((r: any) => r.type === 'APPOINTMENT_CANCELLED')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sub-item 4 — every appointment read carries the doctor's identity.
//
// The appointment row only stores doctorProfileId, but the UI must show who the
// appointment is with. These assert the join is actually requested on each read
// path — a silently missing include would render as "unknown doctor" in the UI
// while every other test still passed.
// ---------------------------------------------------------------------------
describe('AppointmentsService doctor projection (sub-item 4)', () => {
  // Every read must ask Prisma for the doctor relation under `doctorProfile`
  // with exactly this field set (no passwordHash, no user internals).
  const EXPECTED_INCLUDE = {
    doctorProfile: {
      select: { id: true, name: true, specialization: true, approvalStatus: true },
    },
  };

  const baseAppt = {
    id: 'appt-1',
    patientProfileId: 'pat-1',
    doctorProfileId: 'doc-1',
    availabilityId: 'slot-1',
    status: 'BOOKED',
    scheduledAt: slot('slot-1', 9).startTime,
  };

  const makePrisma = (over: any = {}) => ({
    patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'pat-1', name: 'Pat' }) },
    doctorProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: 'doc-1', userId: 'user-doc', name: 'Dr. D' }),
    },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    availability: { findUnique: jest.fn().mockResolvedValue(slot('slot-1', 9)) },
    appointment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(baseAppt),
      findUniqueOrThrow: jest.fn().mockResolvedValue(baseAppt),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'appt-1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...baseAppt, ...data })),
      ...over,
    },
  });

  it('book: requests the doctor projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).book('user-pat', { availabilityId: 'slot-1' });
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_INCLUDE) }),
    );
  });

  it('reschedule: requests the doctor projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).reschedule('user-pat', 'appt-1', {
      availabilityId: 'slot-1',
    });
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_INCLUDE) }),
    );
  });

  it('cancel: requests the doctor projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).cancel('user-pat', 'appt-1');
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_INCLUDE) }),
    );
  });

  it('cancel (already cancelled): still returns the doctor projection, not a bare row', async () => {
    // The idempotent early-return used to hand back the raw row with NO doctor.
    // Since it is consumed by the same client code as the normal path, its shape
    // must match or the UI would lose the doctor name on a double-cancel.
    const prisma: any = makePrisma({
      findUnique: jest.fn().mockResolvedValue({ ...baseAppt, status: 'CANCELLED', availabilityId: null }),
    });
    const svc = new AppointmentsService(prisma);
    await svc.cancel('user-pat', 'appt-1');

    // No write happens; the doctor-joined re-read is what is returned.
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(prisma.appointment.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_INCLUDE) }),
    );
  });

  it('listMine (PATIENT): requests the doctor projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).listMine('user-pat', 'PATIENT');
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_INCLUDE) }),
    );
  });

  it('listMine (DOCTOR): requests the doctor projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).listMine('user-doc', 'DOCTOR');
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_INCLUDE) }),
    );
  });

  it('getOne: requests the doctor projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).getOne('user-pat', 'PATIENT', 'appt-1');
    expect(prisma.appointment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_INCLUDE) }),
    );
  });

  it('never projects user internals (no passwordHash on the doctor)', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).getOne('user-pat', 'PATIENT', 'appt-1');
    const select = prisma.appointment.findUnique.mock.calls[0][0].include.doctorProfile.select;
    expect(select).not.toHaveProperty('passwordHash');
    expect(select).not.toHaveProperty('userId');
  });
});

// ---------------------------------------------------------------------------
// Sub-item 5 — every appointment read carries the consultation session id.
//
// The consultation workspace is addressed by SESSION id, which is a distinct
// UUID from the appointment id and cannot be derived from it. If the read paths
// omit the session projection, a patient has no way to discover their session
// and the workspace becomes unreachable except by typing a UUID by hand.
// ---------------------------------------------------------------------------
describe('AppointmentsService consultation session projection (sub-item 5)', () => {
  const EXPECTED_SESSION = {
    consultationSession: { select: { id: true, state: true } },
  };

  const baseAppt = {
    id: 'appt-1',
    patientProfileId: 'pat-1',
    doctorProfileId: 'doc-1',
    availabilityId: 'slot-1',
    status: 'BOOKED',
    scheduledAt: slot('slot-1', 9).startTime,
  };

  const makePrisma = (over: any = {}) => ({
    patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'pat-1', name: 'Pat' }) },
    doctorProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: 'doc-1', userId: 'user-doc', name: 'Dr. D' }),
    },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    availability: { findUnique: jest.fn().mockResolvedValue(slot('slot-1', 9)) },
    appointment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(baseAppt),
      findUniqueOrThrow: jest.fn().mockResolvedValue(baseAppt),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'appt-1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...baseAppt, ...data })),
      ...over,
    },
  });

  it('book: returns the session projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).book('user-pat', { availabilityId: 'slot-1' });
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_SESSION) }),
    );
  });

  it('book: does NOT duplicate the session key in the include', async () => {
    // `book` previously listed `consultationSession: true` alongside the shared
    // include. Since the shared include now defines the same key, a duplicate
    // would silently overwrite the projection (TS2783) and shrink the payload.
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).book('user-pat', { availabilityId: 'slot-1' });
    const include = prisma.appointment.create.mock.calls[0][0].include;
    expect(include.consultationSession).toEqual({ select: { id: true, state: true } });
  });

  it('reschedule: returns the session projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).reschedule('user-pat', 'appt-1', {
      availabilityId: 'slot-1',
    });
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_SESSION) }),
    );
  });

  it('cancel: returns the session projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).cancel('user-pat', 'appt-1');
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_SESSION) }),
    );
  });

  it('cancel (already cancelled): returns the session projection on the re-read', async () => {
    const prisma: any = makePrisma({
      findUnique: jest
        .fn()
        .mockResolvedValue({ ...baseAppt, status: 'CANCELLED', availabilityId: null }),
    });
    await new AppointmentsService(prisma).cancel('user-pat', 'appt-1');
    expect(prisma.appointment.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_SESSION) }),
    );
  });

  it('listMine (PATIENT): returns the session projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).listMine('user-pat', 'PATIENT');
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_SESSION) }),
    );
  });

  it('listMine (DOCTOR): returns the session projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).listMine('user-doc', 'DOCTOR');
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_SESSION) }),
    );
  });

  it('getOne: returns the session projection', async () => {
    const prisma: any = makePrisma();
    await new AppointmentsService(prisma).getOne('user-pat', 'PATIENT', 'appt-1');
    expect(prisma.appointment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining(EXPECTED_SESSION) }),
    );
  });
});
