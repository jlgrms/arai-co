import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountState,
  ApprovalStatus,
  AppointmentStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditedRecordType } from '../audit/audit.types';
import { NotificationType } from '../notifications/notification-types';
import { UpdateUserStateDto } from './dto/update-user-state.dto';
import { ReviewDoctorDto } from './dto/review-doctor.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';

// Projections exclude passwordHash / auth internals (same discipline as
// DoctorsService.DOCTOR_PUBLIC_SELECT).
const USER_ADMIN_SELECT = {
  id: true,
  email: true,
  role: true,
  accountState: true,
  stateReason: true,
  createdAt: true,
} as const;

const DOCTOR_ADMIN_SELECT = {
  id: true,
  userId: true,
  name: true,
  biography: true,
  specialization: true,
  approvalStatus: true,
  user: { select: { id: true, email: true, accountState: true } },
} as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- 1. User management ------------------------------------------------------

  /**
   * List/search patient + doctor accounts (S5.4). Optional role / accountState
   * filters and a free-text q matched against email or profile name.
   * Admin accounts are excluded — this module manages patient/doctor accounts.
   */
  async listUsers(opts: { role?: Role; accountState?: AccountState; q?: string }) {
    const where: any = { role: { in: [Role.PATIENT, Role.DOCTOR] } };
    if (opts.role) where.role = opts.role;
    if (opts.accountState) where.accountState = opts.accountState;
    if (opts.q) {
      where.OR = [
        { email: { contains: opts.q, mode: 'insensitive' } },
        { patientProfile: { name: { contains: opts.q, mode: 'insensitive' } } },
        { doctorProfile: { name: { contains: opts.q, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.user.findMany({
      where,
      select: {
        ...USER_ADMIN_SELECT,
        patientProfile: { select: { id: true, name: true } },
        doctorProfile: { select: { id: true, name: true, specialization: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Activate / suspend / deactivate a user (S5.4). Persists accountState and the
   * (optional) reason on User.stateReason, then records an AuditLog row.
   * Guarded against targeting admin accounts. Idempotent-safe: re-applying the
   * same state is allowed and still audited (each admin action is logged).
   */
  async updateUserState(adminUserId: string, userId: string, dto: UpdateUserStateDto) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === Role.ADMIN) {
      throw new BadRequestException('Cannot change the state of an admin account');
    }

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: {
        accountState: dto.accountState,
        stateReason: dto.reason ?? null,
      },
      select: USER_ADMIN_SELECT,
    });

    await this.audit.record({
      adminUserId,
      action: AuditAction.USER_STATE_CHANGE,
      affectedRecordType: AuditedRecordType.USER,
      affectedRecordId: target.id,
      reason: dto.reason ?? null,
    });

    return updated;
  }

  // ---- 2. Doctor profile review ------------------------------------------------

  async listDoctors(opts: { approvalStatus?: ApprovalStatus; q?: string }) {
    const where: any = {};
    if (opts.approvalStatus) where.approvalStatus = opts.approvalStatus;
    if (opts.q) {
      where.OR = [
        { name: { contains: opts.q, mode: 'insensitive' } },
        { specialization: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.doctorProfile.findMany({
      where,
      select: DOCTOR_ADMIN_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Approve / reject / update a doctor profile (S5.4, Flag 2).
   * Applies whichever of approvalStatus / name / biography / specialization were
   * provided (validation mirrors the self-service DTO). Writes AuditLog, with
   * affectedRecordType = DOCTOR_PROFILE and affectedRecordId = the DoctorProfile id.
   */
  async reviewDoctor(adminUserId: string, doctorProfileId: string, dto: ReviewDoctorDto) {
    const existing = await this.prisma.doctorProfile.findUnique({
      where: { id: doctorProfileId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Doctor profile not found');

    const data: any = {};
    if (dto.approvalStatus !== undefined) data.approvalStatus = dto.approvalStatus;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.biography !== undefined) data.biography = dto.biography;
    if (dto.specialization !== undefined) data.specialization = dto.specialization;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No review fields provided');
    }

    const updated = await this.prisma.doctorProfile.update({
      where: { id: existing.id },
      data,
      select: DOCTOR_ADMIN_SELECT,
    });

    await this.audit.record({
      adminUserId,
      action: AuditAction.DOCTOR_APPROVAL_UPDATE,
      affectedRecordType: AuditedRecordType.DOCTOR_PROFILE,
      affectedRecordId: existing.id,
      reason: dto.reason ?? null,
    });

    return updated;
  }

  // ---- 3. Appointment oversight ------------------------------------------------

  /** View ALL appointments + consultation state (S5.4). */
  async listAppointments() {
    return this.prisma.appointment.findMany({
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        availabilityId: true,
        patientProfile: { select: { id: true, name: true } },
        doctorProfile: { select: { id: true, name: true, specialization: true } },
        consultationSession: { select: { id: true, state: true } },
      },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  /**
   * Admin cancel (S5.4, Flag 3) — the separate admin-scoped override path. NOT
   * the patient route: this has NO patient-ownership gate, so it works on any
   * appointment regardless of owner or current status (idempotent on CANCELLED).
   *
   * Applies sub-item 5's slot-release semantics (availabilityId -> null) so the
   * slot is immediately re-bookable. Nulling the FK also satisfies sub-item 8's
   * Flag 1 guard (assertSlotNotConsumed sees no live consumer), so the slot is
   * immediately editable again — both regression paths asserted in evidence.
   */
  async cancelAppointment(adminUserId: string, appointmentId: string, dto: CancelAppointmentDto) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patientProfile: { select: { userId: true } },
        doctorProfile: { select: { userId: true, name: true } },
      },
    });
    if (!appt) throw new NotFoundException('Appointment not found');

    // Idempotent: already cancelled -> return as-is, no duplicate audit.
    if (appt.status === AppointmentStatus.CANCELLED) {
      return this.prisma.appointment.findUnique({ where: { id: appt.id } });
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: AppointmentStatus.CANCELLED, availabilityId: null },
    });

    // Reuse the sub-item 8 notification pattern (cancel notifies both parties).
    const when = appt.scheduledAt.toISOString();
    const build = (name: string) => `Appointment with ${name} on ${when} was cancelled by an administrator`;
    await this.prisma.notification.createMany({
      data: [
        { userId: appt.doctorProfile.userId, type: NotificationType.APPOINTMENT_CANCELLED, message: build('the patient') },
        { userId: appt.patientProfile.userId, type: NotificationType.APPOINTMENT_CANCELLED, message: build(appt.doctorProfile.name) },
      ],
    });

    await this.audit.record({
      adminUserId,
      action: AuditAction.APPOINTMENT_CANCEL,
      affectedRecordType: AuditedRecordType.APPOINTMENT,
      affectedRecordId: appt.id,
      reason: dto.reason ?? null,
    });

    return updated;
  }

  // ---- 4. Operational dashboard ------------------------------------------------

  /**
   * DB-derived counts, computed at request time via Prisma groupBy/count (S5.4).
   * No external analytics.
   */
  async dashboard() {
    const [usersByRole, usersByState, doctorsByApproval, apptsByStatus, sessionsByState] =
      await Promise.all([
        this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
        this.prisma.user.groupBy({ by: ['accountState'], _count: { _all: true } }),
        this.prisma.doctorProfile.groupBy({ by: ['approvalStatus'], _count: { _all: true } }),
        this.prisma.appointment.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.consultationSession.groupBy({ by: ['state'], _count: { _all: true } }),
      ]);

    const toMap = (rows: any[], key: string) =>
      rows.reduce((acc, r) => ({ ...acc, [r[key]]: r._count._all }), {});

    return {
      users: {
        total: await this.prisma.user.count(),
        byRole: toMap(usersByRole, 'role'),
        byAccountState: toMap(usersByState, 'accountState'),
      },
      doctors: {
        total: await this.prisma.doctorProfile.count(),
        byApprovalStatus: toMap(doctorsByApproval, 'approvalStatus'),
      },
      appointments: {
        total: await this.prisma.appointment.count(),
        byStatus: toMap(apptsByStatus, 'status'),
      },
      consultationSessions: {
        total: await this.prisma.consultationSession.count(),
        byState: toMap(sessionsByState, 'state'),
      },
    };
  }

  // ---- 5. Audit log read -------------------------------------------------------

  async listAuditLogs() {
    return this.prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      include: { adminUser: { select: { id: true, email: true } } },
    });
  }
}