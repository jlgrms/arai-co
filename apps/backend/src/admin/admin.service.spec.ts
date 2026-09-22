import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditedRecordType } from '../audit/audit.types';

// Sub-item 9 unit tests (mocked Prisma). Focus per the brief:
//  - the audit-log WRITE PATH fires on EACH action type
//  - the appointment-oversight CANCEL PATH works regardless of ownership /
//    patient-only restriction, and releases the slot (availabilityId -> null)

function makeService(prismaOverrides: any = {}) {
  const prisma: any = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    doctorProfile: { findUnique: jest.fn(), update: jest.fn() },
    appointment: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    ...prismaOverrides,
  };
  const audit = new AuditService(prisma);
  const svc = new AdminService(prisma, audit);
  return { svc, prisma, audit };
}

describe('AdminService — audit write path fires on each action type', () => {
  it('USER_STATE_CHANGE: suspend writes an AuditLog row (reason optional)', async () => {
    const { svc, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', role: 'PATIENT' });
    prisma.user.update.mockResolvedValue({ id: 'u-1', accountState: 'SUSPENDED' });

    await svc.updateUserState('admin-1', 'u-1', { accountState: 'SUSPENDED', reason: 'abuse' } as any);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminUserId: 'admin-1',
        action: AuditAction.USER_STATE_CHANGE,
        affectedRecordType: AuditedRecordType.USER,
        affectedRecordId: 'u-1',
        reason: 'abuse',
      }),
    });
  });

  it('USER_STATE_CHANGE: reason omitted -> audit row still written with reason null', async () => {
    const { svc, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', role: 'PATIENT' });
    prisma.user.update.mockResolvedValue({ id: 'u-1' });

    await svc.updateUserState('admin-1', 'u-1', { accountState: 'DEACTIVATED' } as any);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reason: null, action: AuditAction.USER_STATE_CHANGE }),
    });
  });

  it('USER_STATE_CHANGE: refuses to change an ADMIN account (no audit)', async () => {
    const { svc, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', role: 'ADMIN' });
    await expect(
      svc.updateUserState('admin-1', 'u-1', { accountState: 'SUSPENDED' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('DOCTOR_APPROVAL_UPDATE: approve writes AuditLog keyed to DoctorProfile id', async () => {
    const { svc, prisma } = makeService();
    prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doc-1' });
    prisma.doctorProfile.update.mockResolvedValue({ id: 'doc-1', approvalStatus: 'APPROVED' });

    await svc.reviewDoctor('admin-1', 'doc-1', { approvalStatus: 'APPROVED' } as any);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AuditAction.DOCTOR_APPROVAL_UPDATE,
        affectedRecordType: AuditedRecordType.DOCTOR_PROFILE,
        affectedRecordId: 'doc-1',
      }),
    });
  });

  it('DOCTOR_APPROVAL_UPDATE: applies direct-edit profile fields too (Flag 2)', async () => {
    const { svc, prisma } = makeService();
    prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doc-1' });
    prisma.doctorProfile.update.mockResolvedValue({ id: 'doc-1' });

    await svc.reviewDoctor('admin-1', 'doc-1', { specialization: 'Neurology' } as any);

    expect(prisma.doctorProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { specialization: 'Neurology' } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('DOCTOR_APPROVAL_UPDATE: empty review payload -> 400, no audit', async () => {
    const { svc, prisma } = makeService();
    prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doc-1' });
    await expect(svc.reviewDoctor('admin-1', 'doc-1', {} as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('APPOINTMENT_CANCEL: writes AuditLog keyed to Appointment id', async () => {
    const { svc, prisma } = makeService();
    prisma.appointment.findUnique.mockResolvedValue({
      id: 'appt-1',
      status: 'BOOKED',
      scheduledAt: new Date('2027-01-01T09:00:00Z'),
      patientProfile: { userId: 'pu-1' },
      doctorProfile: { userId: 'du-1', name: 'Dr. X' },
    });
    prisma.appointment.update.mockResolvedValue({ id: 'appt-1', status: 'CANCELLED' });

    await svc.cancelAppointment('admin-1', 'appt-1', { reason: 'invalid booking' } as any);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AuditAction.APPOINTMENT_CANCEL,
        affectedRecordType: AuditedRecordType.APPOINTMENT,
        affectedRecordId: 'appt-1',
        reason: 'invalid booking',
      }),
    });
  });
});

describe('AdminService — appointment oversight cancel path', () => {
  it('cancels regardless of owner (no patient-ownership gate) and releases the slot', async () => {
    const { svc, prisma } = makeService();
    // Appointment owned by a DIFFERENT patient than any caller — admin override.
    prisma.appointment.findUnique.mockResolvedValue({
      id: 'appt-1',
      status: 'BOOKED',
      scheduledAt: new Date('2027-01-01T09:00:00Z'),
      patientProfileId: 'some-other-patient-profile',
      availabilityId: 'slot-1',
      patientProfile: { userId: 'pu-9' },
      doctorProfile: { userId: 'du-1', name: 'Dr. X' },
    });
    prisma.appointment.update.mockResolvedValue({ id: 'appt-1', status: 'CANCELLED', availabilityId: null });

    const res = await svc.cancelAppointment('admin-1', 'appt-1', {} as any);

    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      // Slot released (-> null) so it is re-bookable AND re-editable (sub-item 5 + 8).
      data: { status: 'CANCELLED', availabilityId: null },
    });
    expect((res as any).availabilityId).toBeNull();
  });

  it('is idempotent on an already-CANCELLED appointment (no double audit)', async () => {
    const { svc, prisma } = makeService();
    prisma.appointment.findUnique.mockResolvedValue({
      id: 'appt-1',
      status: 'CANCELLED',
      patientProfile: { userId: 'pu-1' },
      doctorProfile: { userId: 'du-1', name: 'Dr. X' },
    });

    await svc.cancelAppointment('admin-1', 'appt-1', {} as any);

    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('missing appointment -> 404, no audit', async () => {
    const { svc, prisma } = makeService();
    prisma.appointment.findUnique.mockResolvedValue(null);
    await expect(svc.cancelAppointment('admin-1', 'nope', {} as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});