import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import {
  detectBookingConflict,
  ConflictReason,
  ExistingBooking,
} from '../common/domain/booking-conflict';

// Human-readable conflict messages, surfaced as 409 (S5.5).
const CONFLICT_MESSAGE: Record<ConflictReason, string> = {
  INVALID_WINDOW: 'Invalid booking window',
  SLOT_BLOCKED: 'This slot is blocked by the doctor',
  SLOT_ALREADY_CONSUMED: 'This slot has already been booked',
  OVERLAP: 'This slot overlaps an existing booking',
};

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Book (PATIENT only) -----------------------------------------------------

  async book(patientUserId: string, dto: CreateAppointmentDto) {
    const patient = await this.requirePatientProfile(patientUserId);
    const slot = await this.prisma.availability.findUnique({
      where: { id: dto.availabilityId },
    });
    if (!slot) throw new NotFoundException('Availability slot not found');

    await this.assertNoConflict(slot.doctorProfileId, slot, null);

    // Session is created at BOOKING time (Flag A), atomically with the
    // appointment, starting in SCHEDULED. A join call later operates on an
    // existing, addressable session id (matches the C4 dynamic view).
    return this.prisma.appointment.create({
      data: {
        patientProfileId: patient.id,
        doctorProfileId: slot.doctorProfileId,
        availabilityId: slot.id,
        scheduledAt: slot.startTime,
        status: AppointmentStatus.BOOKED,
        consultationSession: { create: { state: 'SCHEDULED' } },
      },
      include: { consultationSession: true },
    });
  }

  // ---- Reschedule (PATIENT, own appointment) -----------------------------------

  async reschedule(patientUserId: string, appointmentId: string, dto: RescheduleAppointmentDto) {
    const patient = await this.requirePatientProfile(patientUserId);
    const appt = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (appt.patientProfileId !== patient.id) {
      throw new ForbiddenException('You can only reschedule your own appointments');
    }
    if (appt.status === AppointmentStatus.CANCELLED || appt.status === AppointmentStatus.COMPLETED) {
      throw new BadRequestException(`Cannot reschedule a ${appt.status.toLowerCase()} appointment`);
    }

    const newSlot = await this.prisma.availability.findUnique({
      where: { id: dto.availabilityId },
    });
    if (!newSlot) throw new NotFoundException('Target availability slot not found');
    if (newSlot.doctorProfileId !== appt.doctorProfileId) {
      throw new BadRequestException('You can only reschedule with the same doctor');
    }

    // Exclude THIS appointment from the conflict set (it is being moved), so it
    // cannot conflict with itself.
    await this.assertNoConflict(appt.doctorProfileId, newSlot, appt.id);

    // Update-in-place: new availabilityId frees the old slot automatically (S5.3).
    return this.prisma.appointment.update({
      where: { id: appt.id },
      data: {
        availabilityId: newSlot.id,
        scheduledAt: newSlot.startTime,
        status: AppointmentStatus.RESCHEDULED,
      },
    });
  }

  // ---- Cancel (PATIENT-only, own appointment — S5.7) ---------------------------

  async cancel(patientUserId: string, appointmentId: string) {
    const patient = await this.requirePatientProfile(patientUserId);
    const appt = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (appt.patientProfileId !== patient.id) {
      throw new ForbiddenException('You can only cancel your own appointments');
    }
    if (appt.status === AppointmentStatus.CANCELLED) {
      return appt; // idempotent
    }

    // Release the slot link on cancel (availabilityId -> null). The conflict fn
    // treats CANCELLED as non-blocking, but the DB's @unique constraint on
    // Appointment.availabilityId would still hold the old FK and block re-booking
    // (Prisma P2002). Nulling it frees the slot. scheduledAt + doctorProfileId are
    // preserved so audit history keeps the original slot time (C4: ||--o| optional).
    return this.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: AppointmentStatus.CANCELLED, availabilityId: null },
    });
  }

  // ---- Reads (participant-scoped) ----------------------------------------------

  async listMine(userId: string, role: string) {
    if (role === 'PATIENT') {
      const p = await this.requirePatientProfile(userId);
      return this.prisma.appointment.findMany({
        where: { patientProfileId: p.id },
        orderBy: { scheduledAt: 'asc' },
      });
    }
    if (role === 'DOCTOR') {
      const d = await this.requireDoctorProfile(userId);
      return this.prisma.appointment.findMany({
        where: { doctorProfileId: d.id },
        orderBy: { scheduledAt: 'asc' },
      });
    }
    throw new ForbiddenException('Unsupported role for this endpoint');
  }

  async getOne(userId: string, role: string, appointmentId: string) {
    const appt = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appt) throw new NotFoundException('Appointment not found');
    await this.assertParticipant(userId, role, appt.patientProfileId, appt.doctorProfileId);
    return appt;
  }

  // ---- Helpers ------------------------------------------------------------------

  /**
   * Runs the shared pure conflict check against the doctor's OTHER active bookings.
   * excludeAppointmentId is set on reschedule so the moving appointment doesn't
   * conflict with itself (S5.4).
   */
  private async assertNoConflict(
    doctorProfileId: string,
    slot: { id: string; startTime: Date; endTime: Date; isBlocked: boolean },
    excludeAppointmentId: string | null,
  ): Promise<void> {
    const others = await this.prisma.appointment.findMany({
      where: {
        doctorProfileId,
        status: { not: AppointmentStatus.CANCELLED },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: { availabilityId: true, scheduledAt: true, status: true, availability: { select: { startTime: true, endTime: true } } },
    });

    const existingBookings: ExistingBooking[] = others.map((a) => ({
      availabilityId: a.availabilityId,
      startTime: a.availability?.startTime ?? a.scheduledAt,
      endTime: a.availability?.endTime ?? a.scheduledAt,
      status: a.status,
    }));

    const result = detectBookingConflict({
      proposed: { startTime: slot.startTime, endTime: slot.endTime },
      existingBookings,
      targetSlot: { id: slot.id, isBlocked: slot.isBlocked },
    });

    if (result.conflict && result.reason) {
      throw new ConflictException(CONFLICT_MESSAGE[result.reason]);
    }
  }

  private async assertParticipant(
    userId: string,
    role: string,
    patientProfileId: string,
    doctorProfileId: string,
  ): Promise<void> {
    if (role === 'PATIENT') {
      const p = await this.requirePatientProfile(userId);
      if (p.id !== patientProfileId) throw new ForbiddenException('Not your appointment');
      return;
    }
    if (role === 'DOCTOR') {
      const d = await this.requireDoctorProfile(userId);
      if (d.id !== doctorProfileId) throw new ForbiddenException('Not your appointment');
      return;
    }
    throw new ForbiddenException('Unsupported role');
  }

  private async requirePatientProfile(userId: string) {
    const p = await this.prisma.patientProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Patient profile not found');
    return p;
  }

  private async requireDoctorProfile(userId: string) {
    const d = await this.prisma.doctorProfile.findUnique({ where: { userId } });
    if (!d) throw new NotFoundException('Doctor profile not found');
    return d;
  }
}
