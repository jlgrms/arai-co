import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, ApprovalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { matchSymptomToSpecialties } from '../common/domain/matching';

// Public-facing doctor projection — no passwordHash, no user internals.
const DOCTOR_PUBLIC_SELECT = {
  id: true,
  userId: true,
  name: true,
  biography: true,
  specialization: true,
  approvalStatus: true,
} as const;

@Injectable()
export class DoctorsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Sub-item 1: own profile -------------------------------------------------

  async getOwnProfile(userId: string) {
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: DOCTOR_PUBLIC_SELECT,
    });
    if (!profile) throw new NotFoundException('Doctor profile not found');
    return profile;
  }

  async updateOwnProfile(userId: string, dto: UpdateDoctorProfileDto) {
    const existing = await this.prisma.doctorProfile.findUnique({ where: { userId } });
    if (!existing) throw new NotFoundException('Doctor profile not found');
    // approvalStatus is NOT settable here (admin-only).
    return this.prisma.doctorProfile.update({
      where: { userId },
      data: {
        name: dto.name,
        biography: dto.biography,
        specialization: dto.specialization,
      },
      select: DOCTOR_PUBLIC_SELECT,
    });
  }

  // ---- Sub-item 2: discovery ---------------------------------------------------

  /**
   * Browse APPROVED doctors. Optional filters:
   *  - specialization: exact (case-insensitive) match on DoctorProfile.specialization
   *  - available=true: only doctors with >= 1 free, future, unblocked, unconsumed slot
   */
  async discover(opts: { specialization?: string; available?: boolean }) {
    const now = new Date();
    const where: any = { approvalStatus: ApprovalStatus.APPROVED };
    if (opts.specialization) {
      where.specialization = { equals: opts.specialization, mode: 'insensitive' };
    }
    if (opts.available) {
      where.availabilities = {
        some: {
          isBlocked: false,
          startTime: { gt: now },
          appointment: null, // not yet consumed
        },
      };
    }
    return this.prisma.doctorProfile.findMany({
      where,
      select: DOCTOR_PUBLIC_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  /** Single APPROVED doctor + their free future slots. Non-approved -> 404 (not listed). */
  async getPublicDoctor(id: string) {
    const now = new Date();
    const doctor = await this.prisma.doctorProfile.findFirst({
      where: { id, approvalStatus: ApprovalStatus.APPROVED },
      select: {
        ...DOCTOR_PUBLIC_SELECT,
        availabilities: {
          where: { isBlocked: false, startTime: { gt: now }, appointment: null },
          orderBy: { startTime: 'asc' },
          select: { id: true, startTime: true, endTime: true, isBlocked: true },
        },
      },
    });
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor;
  }

  // ---- Sub-item 3: deterministic matching --------------------------------------

  /**
   * Resolve symptom text -> specialties (pure fn) -> APPROVED doctors in those specialties.
   * No-match returns 200 with empty arrays (a valid "no suggestions" outcome).
   */
  async match(symptom: string) {
    const map = await this.prisma.symptomSpecialtyMap.findMany({
      select: { symptomOrConcern: true, specialty: true },
    });
    const matchedSpecialties = matchSymptomToSpecialties(symptom, map);

    if (matchedSpecialties.length === 0) {
      return { symptom, matchedSpecialties: [], doctors: [] };
    }

    const doctors = await this.prisma.doctorProfile.findMany({
      where: {
        approvalStatus: ApprovalStatus.APPROVED,
        specialization: { in: matchedSpecialties, mode: 'insensitive' },
      },
      select: DOCTOR_PUBLIC_SELECT,
      orderBy: { name: 'asc' },
    });

    return { symptom, matchedSpecialties, doctors };
  }

  // ---- Sub-item 4: availability management (doctor's own slots) -----------------

  async listOwnAvailability(userId: string) {
    const profile = await this.requireOwnProfile(userId);
    return this.prisma.availability.findMany({
      where: { doctorProfileId: profile.id },
      orderBy: { startTime: 'asc' },
      select: { id: true, startTime: true, endTime: true, isBlocked: true },
    });
  }

  async createAvailability(userId: string, dto: CreateAvailabilityDto) {
    const profile = await this.requireOwnProfile(userId);
    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('endTime must be after startTime');
    }
    return this.prisma.availability.create({
      data: {
        doctorProfileId: profile.id,
        startTime: start,
        endTime: end,
        isBlocked: dto.isBlocked ?? false,
      },
      select: { id: true, startTime: true, endTime: true, isBlocked: true },
    });
  }

  async updateAvailability(userId: string, id: string, dto: UpdateAvailabilityDto) {
    const profile = await this.requireOwnProfile(userId);
    const slot = await this.prisma.availability.findFirst({
      where: { id, doctorProfileId: profile.id },
    });
    if (!slot) throw new NotFoundException('Availability slot not found');

    // Flag 1 (sub-item 8 resolution): a slot consumed by a live appointment is
    // sealed. Editing its times or blocking it would invalidate an already-booked
    // appointment out from under the patient — exactly the "invalid booking"
    // S5.3 says the app must prevent. The doctor must cancel/reschedule the
    // appointment first (which fires the existing notification triggers).
    await this.assertSlotNotConsumed(slot.id);

    const start = dto.startTime ? new Date(dto.startTime) : slot.startTime;
    const end = dto.endTime ? new Date(dto.endTime) : slot.endTime;
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('endTime must be after startTime');
    }

    return this.prisma.availability.update({
      where: { id: slot.id },
      data: { startTime: start, endTime: end, isBlocked: dto.isBlocked },
      select: { id: true, startTime: true, endTime: true, isBlocked: true },
    });
  }

  async deleteAvailability(userId: string, id: string) {
    const profile = await this.requireOwnProfile(userId);
    const slot = await this.prisma.availability.findFirst({
      where: { id, doctorProfileId: profile.id },
    });
    if (!slot) throw new NotFoundException('Availability slot not found');
    // Flag 1: deleting a consumed slot would orphan a live appointment.
    await this.assertSlotNotConsumed(slot.id);
    await this.prisma.availability.delete({ where: { id: slot.id } });
    return { deleted: true, id: slot.id };
  }

  /**
   * Flag 1 guard — a slot referenced by any non-CANCELLED appointment is
   * "consumed" and may not be edited, blocked, or deleted. Throws 409 so the
   * doctor resolves via the existing cancel/reschedule flows.
   */
  private async assertSlotNotConsumed(availabilityId: string): Promise<void> {
    const liveConsumer = await this.prisma.appointment.findFirst({
      where: {
        availabilityId,
        status: { not: AppointmentStatus.CANCELLED },
      },
      select: { id: true },
    });
    if (liveConsumer) {
      throw new ConflictException(
        'This slot is booked by an appointment; cancel or reschedule it before editing this slot',
      );
    }
  }

  /** Resolve the caller's own DoctorProfile, or 404 if none. */
  private async requireOwnProfile(userId: string) {
    const profile = await this.prisma.doctorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Doctor profile not found');
    return profile;
  }
}
