import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DoctorsService } from './doctors.service';

// Sub-item 8 / Flag 1: a slot consumed by a live appointment is sealed —
// editing or deleting it must 409 until the appointment is cancelled/rescheduled.
describe('DoctorsService availability guard (Flag 1)', () => {
  const ownProfile = { id: 'doc-1', userId: 'user-doc' };
  const availableSlot = {
    id: 'slot-1',
    doctorProfileId: 'doc-1',
    startTime: new Date('2026-05-01T09:00:00.000Z'),
    endTime: new Date('2026-05-01T10:00:00.000Z'),
    isBlocked: false,
  };

  it('updateAvailability: 409 when a non-cancelled appointment consumes the slot', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: { findFirst: jest.fn().mockResolvedValue(availableSlot), update: jest.fn() },
      appointment: { findFirst: jest.fn().mockResolvedValue({ id: 'appt-1' }) },
    };
    const svc = new DoctorsService(prisma);
    await expect(
      svc.updateAvailability('user-doc', 'slot-1', { isBlocked: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.availability.update).not.toHaveBeenCalled();
    // The consumption check excludes CANCELLED appointments.
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ availabilityId: 'slot-1', status: { not: 'CANCELLED' } }),
      }),
    );
  });

  it('updateAvailability: succeeds when the slot has no live consumer', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: {
        findFirst: jest.fn().mockResolvedValue(availableSlot),
        update: jest.fn().mockImplementation(({ data }) => ({ ...availableSlot, ...data })),
      },
      appointment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new DoctorsService(prisma);
    const res = await svc.updateAvailability('user-doc', 'slot-1', {
      startTime: '2026-05-01T11:00:00.000Z',
      endTime: '2026-05-01T12:00:00.000Z',
    });
    expect(prisma.availability.update).toHaveBeenCalledTimes(1);
    expect(res).toBeDefined();
  });

  it('updateAvailability: end-before-start still -> 400 (window validation intact)', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: { findFirst: jest.fn().mockResolvedValue(availableSlot), update: jest.fn() },
      appointment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new DoctorsService(prisma);
    await expect(
      svc.updateAvailability('user-doc', 'slot-1', { endTime: '2026-05-01T08:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deleteAvailability: 409 when consumed', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: { findFirst: jest.fn().mockResolvedValue(availableSlot), delete: jest.fn() },
      appointment: { findFirst: jest.fn().mockResolvedValue({ id: 'appt-1' }) },
    };
    const svc = new DoctorsService(prisma);
    await expect(svc.deleteAvailability('user-doc', 'slot-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.availability.delete).not.toHaveBeenCalled();
  });

  it('deleteAvailability: 200 when free', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: {
        findFirst: jest.fn().mockResolvedValue(availableSlot),
        delete: jest.fn().mockResolvedValue(availableSlot),
      },
      appointment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new DoctorsService(prisma);
    const res = await svc.deleteAvailability('user-doc', 'slot-1');
    expect(res).toEqual({ deleted: true, id: 'slot-1' });
  });

  it('updateAvailability: slot not owned / missing -> 404 before any consume check', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      appointment: { findFirst: jest.fn() },
    };
    const svc = new DoctorsService(prisma);
    await expect(svc.updateAvailability('user-doc', 'slot-x', { isBlocked: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
  });
});
