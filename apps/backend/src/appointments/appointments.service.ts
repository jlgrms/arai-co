import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import {
  detectBookingConflict,
  ConflictReason,
  ExistingBooking,
} from '../common/domain/booking-conflict';
import { NotificationType } from '../notifications/notification-types';

// Human-readable conflict messages, surfaced as 409 (S5.5).
const CONFLICT_MESSAGE: Record<ConflictReason, string> = {
  INVALID_WINDOW: 'Invalid booking window',
  SLOT_BLOCKED: 'This slot is blocked by the doctor',
  SLOT_ALREADY_CONSUMED: 'This slot has already been booked',
  OVERLAP: 'This slot overlaps an existing booking',
};

/**
 * Doctor identity projected onto every appointment read.
 *
 * The appointment row itself only carries `doctorProfileId`, but the UI must
 * show WHO an appointment is with. Resolving the name client-side (by fetching
 * the discoverable-doctor list and matching ids) was rejected: that list only
 * contains APPROVED doctors, so an appointment with a doctor who is later
 * un-approved would render as "unknown" even though the appointment is real and
 * still stands. Joining here keeps the appointment self-describing at any
 * approval state.
 *
 * NOTE: the relation on Appointment is `doctorProfile`, and the payload carries
 * that same key — no renaming layer, so what the client reads matches the schema
 * exactly. Prisma's `AppointmentInclude` rejects readonly nested object types,
 * hence `satisfies` rather than `as const` on the wrapper.
 */
const APPOINTMENT_DOCTOR_SELECT = {
  id: true,
  name: true,
  specialization: true,
  approvalStatus: true,
} as const;

/**
 * Every appointment read includes:
 *   - the consulting doctor under `doctorProfile` (sub-item 4), and
 *   - the consultation session id under `consultationSession` (sub-item 5).
 *
 * The session id matters because the consultation workspace is addressed by
 * SESSION id, and session ids are distinct from appointment ids — a patient
 * cannot derive one from the other. Without this projection the only way into a
 * consultation room would be to already know its UUID, so the workspace would be
 * unreachable from the UI. `book` has always returned the session; the read
 * paths now match it.
 */
const WITH_DOCTOR = {
  doctorProfile: {
    select: APPOINTMENT_DOCTOR_SELECT,
  },
  consultationSession: {
    select: { id: true, state: true },
  },
} satisfies Prisma.AppointmentInclude;

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
    const appointment = await this.prisma.appointment.create({
      data: {
        patientProfileId: patient.id,
        doctorProfileId: slot.doctorProfileId,
        availabilityId: slot.id,
        scheduledAt: slot.startTime,
        status: AppointmentStatus.BOOKED,
        consultationSession: { create: { state: 'SCHEDULED' } },
      },
      // WITH_DOCTOR now supplies the consultationSession projection too, so it
      // must not also be listed here — a duplicate key would silently overwrite
      // the projection (TS2783) and shrink the returned session.
      include: { ...WITH_DOCTOR },
    });

    // Sub-item 8: notify BOTH affected parties (S5.2/S5.3). Synchronous writes
    // through the already-injected PrismaService — no queue/async (Flag 2).
    const when = slot.startTime.toISOString();
    await this.notifyBothParties(
      slot.doctorProfileId,
      patientUserId,
      NotificationType.BOOKING_CONFIRMED,
      (name) => `Appointment booked with ${name} on ${when}`,
    );

    return appointment;
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
    const updated = await this.prisma.appointment.update({
      where: { id: appt.id },
      data: {
        availabilityId: newSlot.id,
        scheduledAt: newSlot.startTime,
        status: AppointmentStatus.RESCHEDULED,
      },
      include: { ...WITH_DOCTOR },
    });

    // Sub-item 8: notify both parties of the new time.
    const when = newSlot.startTime.toISOString();
    await this.notifyBothParties(
      appt.doctorProfileId,
      patientUserId,
      NotificationType.APPOINTMENT_RESCHEDULED,
      (name) => `Appointment with ${name} rescheduled to ${when}`,
    );

    return updated;
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
      // Idempotent: already cancelled. Re-read with the doctor joined so the
      // response shape matches the normal path (both are consumed by the same
      // client code).
      return this.prisma.appointment.findUniqueOrThrow({
        where: { id: appt.id },
        include: { ...WITH_DOCTOR },
      });
    }

    // Release the slot link on cancel (availabilityId -> null). The conflict fn
    // treats CANCELLED as non-blocking, but the DB's @unique constraint on
    // Appointment.availabilityId would still hold the old FK and block re-booking
    // (Prisma P2002). Nulling it frees the slot. scheduledAt + doctorProfileId are
    // preserved so audit history keeps the original slot time (C4: ||--o| optional).
    const updated = await this.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: AppointmentStatus.CANCELLED, availabilityId: null },
      include: { ...WITH_DOCTOR },
    });

    // Sub-item 8: notify both parties of the cancellation. scheduledAt survives
    // the cancel on the row, so it still carries the original appt time.
    const when = appt.scheduledAt.toISOString();
    await this.notifyBothParties(
      appt.doctorProfileId,
      patientUserId,
      NotificationType.APPOINTMENT_CANCELLED,
      (name) => `Appointment with ${name} on ${when} was cancelled`,
    );

    return updated;
  }

  // ---- Reads (participant-scoped) ----------------------------------------------

  async listMine(userId: string, role: string) {
    if (role === 'PATIENT') {
      const p = await this.requirePatientProfile(userId);
      return this.prisma.appointment.findMany({
        where: { patientProfileId: p.id },
        orderBy: { scheduledAt: 'asc' },
        include: { ...WITH_DOCTOR },
      });
    }
    if (role === 'DOCTOR') {
      const d = await this.requireDoctorProfile(userId);
      return this.prisma.appointment.findMany({
        where: { doctorProfileId: d.id },
        orderBy: { scheduledAt: 'asc' },
        include: { ...WITH_DOCTOR },
      });
    }
    throw new ForbiddenException('Unsupported role for this endpoint');
  }

  async getOne(userId: string, role: string, appointmentId: string) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { ...WITH_DOCTOR },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    await this.assertParticipant(userId, role, appt.patientProfileId, appt.doctorProfileId);
    return appt;
  }

  // ---- Helpers ------------------------------------------------------------------

  /**
   * Sub-item 8 — create one Notification row per affected party (patient + the
   * treating doctor) for a booking/reschedule/cancel event. The recipient is a
   * User id (Notification.userId -> User), so the doctor's User id is resolved
   * from the DoctorProfile. Two plain prisma writes, fully in-process (Flag 2).
   * Messages are built per-recipient so each names the counterparty.
   */
  private async notifyBothParties(
    doctorProfileId: string,
    patientUserId: string,
    type: string,
    buildMessage: (counterpartyName: string) => string,
  ): Promise<void> {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { id: doctorProfileId },
      select: { userId: true, name: true },
    });
    // Defensive: without a resolvable doctor there is no second recipient.
    if (!doctorProfile) return;

    const patientProfile = await this.prisma.patientProfile.findUnique({
      where: { userId: patientUserId },
      select: { name: true },
    });
    const patientName = patientProfile?.name ?? 'your patient';

    await this.prisma.notification.createMany({
      data: [
        // Doctor's notification names the patient.
        { userId: doctorProfile.userId, type, message: buildMessage(patientName) },
        // Patient's notification names the doctor.
        { userId: patientUserId, type, message: buildMessage(doctorProfile.name) },
      ],
    });
  }

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
