import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConsultationState as PrismaConsultationState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyComplete,
  applyJoin,
  ConsultationState,
  InvalidTransitionError,
  ParticipantRole,
  Presence,
} from '../common/domain/consultation-state-machine';
import { canAccessRecords, recordGateMessage } from '../common/domain/records-visibility';
import { CreateNoteDto } from './dto/create-note.dto';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';

// Maps state-machine rejection reasons to human-readable 409 messages (S5.5
// pattern: state-conflict -> 409, same envelope as booking conflicts).
const TRANSITION_MESSAGE: Record<string, string> = {
  TERMINAL: 'This consultation session is already completed',
  NOT_JOINED: 'Cannot complete a session that has not been joined',
  INVALID_TRANSITION: 'This transition is not permitted from the current state',
  ALREADY_IN_PROGRESS: 'Session is already in progress',
};

// Every consultation-session response carries the appointment it belongs to.
//
// This matters because `join` has TWO return paths — the write on a real
// transition and the idempotent early-return that hands back the already-loaded
// session. Without a shared include the two disagree: the early-return had
// `appointment` (it comes from loadParticipantSession) while the update did not.
// A client could then only render the response safely by not trusting it, and a
// patient workspace crashed on its first join for exactly that reason. One
// include keeps every branch shaped identically.
const WITH_APPOINTMENT = { appointment: true } as const;

@Injectable()
export class ConsultationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Join (patient or doctor participant) ------------------------------------

  async join(userId: string, role: string, sessionId: string) {
    const { session, presence } = await this.loadParticipantSession(userId, role, sessionId);
    const participant = role as ParticipantRole;

    let result;
    try {
      result = applyJoin(session.state as ConsultationState, presence, participant);
    } catch (e) {
      if (e instanceof InvalidTransitionError) {
        throw new ConflictException(TRANSITION_MESSAGE[e.reason] ?? TRANSITION_MESSAGE.INVALID_TRANSITION);
      }
      throw e;
    }

    if (!result.changed) {
      // Idempotent: return the current session untouched. Already carries the
      // appointment from loadParticipantSession, matching the write path below.
      return session;
    }

    const now = new Date();
    return this.prisma.consultationSession.update({
      where: { id: session.id },
      data: {
        state: result.state as PrismaConsultationState,
        // joinedAt = first join only; per-role columns track WHO is present.
        joinedAt: session.joinedAt ?? now,
        ...(participant === 'PATIENT'
          ? { patientJoinedAt: session.patientJoinedAt ?? now }
          : { doctorJoinedAt: session.doctorJoinedAt ?? now }),
      },
      include: { ...WITH_APPOINTMENT },
    });
  }

  // ---- Complete (doctor-only, participant-scoped) ------------------------------

  async complete(userId: string, role: string, sessionId: string) {
    const { session } = await this.loadParticipantSession(userId, role, sessionId);

    const result = applyComplete(session.state as ConsultationState, role as ParticipantRole);
    if (!result.ok) {
      throw new ConflictException(TRANSITION_MESSAGE[result.reason] ?? TRANSITION_MESSAGE.INVALID_TRANSITION);
    }

    // Completing is idempotent-safe: guards in applyComplete reject a second call
    // on a terminal session, so there is no double-write path here.
    return this.prisma.consultationSession.update({
      where: { id: session.id },
      data: { state: result.state as PrismaConsultationState, completedAt: new Date() },
      include: { ...WITH_APPOINTMENT },
    });
  }

  // ---- Records write path (doctor-only; gated on state) ------------------------

  /**
   * Doctor authors a consultation note (S5.3: findings, recommendations,
   * summaries). Gate: WRITE = {IN_PROGRESS, COMPLETED} (Flag 1). Append-only: a
   * new POST adds another note; no edit or delete of a written record.
   */
  async addNote(userId: string, role: string, sessionId: string, dto: CreateNoteDto) {
    const { session } = await this.loadParticipantSession(userId, role, sessionId);
    await this.assertDoctorOwnsSession(userId, session.appointment.doctorProfileId);
    this.assertWritable(session.state as ConsultationState);

    if (!dto.findings && !dto.recommendations) {
      throw new BadRequestException('A note must include findings, recommendations, or both');
    }

    return this.prisma.consultationNote.create({
      data: {
        sessionId: session.id,
        findings: dto.findings ?? null,
        recommendations: dto.recommendations ?? null,
      },
    });
  }

  /** Doctor issues a prescription (S5.3). Same gate + append-only + scoping. */
  async addPrescription(userId: string, role: string, sessionId: string, dto: CreatePrescriptionDto) {
    const { session } = await this.loadParticipantSession(userId, role, sessionId);
    await this.assertDoctorOwnsSession(userId, session.appointment.doctorProfileId);
    this.assertWritable(session.state as ConsultationState);

    return this.prisma.prescription.create({
      data: { sessionId: session.id, details: dto.details },
    });
  }

  // ---- Records read path --------------------------------------------------------

  /**
   * Records for a single session. Participant-scoped. Visibility is state-gated:
   *   PATIENT -> COMPLETED only; DOCTOR (treating) -> IN_PROGRESS or COMPLETED.
   */
  async getSessionRecords(userId: string, role: string, sessionId: string) {
    const { session } = await this.loadParticipantSession(userId, role, sessionId);
    const state = session.state as ConsultationState;
    const action = role === 'PATIENT' ? 'READ_PATIENT' : 'READ_DOCTOR';
    if (!canAccessRecords(state, action)) {
      throw new ConflictException(recordGateMessage(state, action));
    }
    return this.recordsForSession(session.id);
  }

  /**
   * Patient's own medical records across all their sessions (S5.2). Only
   * COMPLETED sessions are exposed to the patient.
   */
  async getMyRecords(userId: string) {
    const p = await this.prisma.patientProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Patient profile not found');

    const sessions = await this.prisma.consultationSession.findMany({
      where: { state: 'COMPLETED', appointment: { patientProfileId: p.id } },
      include: {
        consultationNotes: true,
        prescriptions: true,
        appointment: { include: { doctorProfile: true } },
      },
      orderBy: { completedAt: 'desc' },
    });

    return sessions.map((s) => ({
      sessionId: s.id,
      completedAt: s.completedAt,
      doctorName: s.appointment.doctorProfile?.name ?? null,
      specialization: s.appointment.doctorProfile?.specialization ?? null,
      notes: s.consultationNotes,
      prescriptions: s.prescriptions,
    }));
  }

  /**
   * Doctor views a patient's records (S5.3 "relevant patient records"). Scoping
   * key (Flag 2): records are relevant iff an appointment exists between THIS
   * doctor and THAT patient -- not all patients, not completed-sessions-only.
   * Notes/prescriptions are only exposed once the session is doctor-readable.
   */
  async getPatientRecordsForDoctor(userId: string, patientProfileId: string) {
    const d = await this.prisma.doctorProfile.findUnique({ where: { userId } });
    if (!d) throw new NotFoundException('Doctor profile not found');

    const appointmentCount = await this.prisma.appointment.count({
      where: { doctorProfileId: d.id, patientProfileId },
    });
    if (appointmentCount === 0) {
      // No doctor-patient appointment relation -> not "relevant" to this doctor.
      throw new ForbiddenException('You have no appointments with this patient');
    }

    const sessions = await this.prisma.consultationSession.findMany({
      where: { appointment: { doctorProfileId: d.id, patientProfileId } },
      include: { consultationNotes: true, prescriptions: true, appointment: true },
      orderBy: { appointment: { scheduledAt: 'desc' } },
    });

    return sessions.map((s) => {
      const readable = canAccessRecords(s.state as ConsultationState, 'READ_DOCTOR');
      return {
        sessionId: s.id,
        state: s.state,
        scheduledAt: s.appointment.scheduledAt,
        // Upcoming/SCHEDULED sessions have no clinical content to expose yet.
        notes: readable ? s.consultationNotes : [],
        prescriptions: readable ? s.prescriptions : [],
      };
    });
  }

  // ---- Read (participant-scoped) -----------------------------------------------

  async getOne(userId: string, role: string, sessionId: string) {
    const { session } = await this.loadParticipantSession(userId, role, sessionId);
    return session;
  }

  // ---- Helpers ------------------------------------------------------------------

  private async recordsForSession(sessionId: string) {
    const [notes, prescriptions] = await Promise.all([
      this.prisma.consultationNote.findMany({ where: { sessionId }, orderBy: { recordedAt: 'asc' } }),
      this.prisma.prescription.findMany({ where: { sessionId }, orderBy: { issuedAt: 'asc' } }),
    ]);
    return { sessionId, notes, prescriptions };
  }

  private assertWritable(state: ConsultationState): void {
    if (!canAccessRecords(state, 'WRITE')) {
      throw new ConflictException(recordGateMessage(state, 'WRITE'));
    }
  }

  private async assertDoctorOwnsSession(userId: string, doctorProfileId: string): Promise<void> {
    const d = await this.prisma.doctorProfile.findUnique({ where: { userId } });
    if (!d) throw new NotFoundException('Doctor profile not found');
    if (d.id !== doctorProfileId) throw new ForbiddenException('Not your consultation session');
  }

  /**
   * Loads a session by id AND enforces participant scoping (same pattern as
   * AppointmentsService sub-item 5): only the appointment's own patient and
   * doctor may view/act on its session. Non-participants get 403.
   * Also derives current presence from the per-role joinedAt columns.
   */
  private async loadParticipantSession(userId: string, role: string, sessionId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
      include: { appointment: true },
    });
    if (!session) throw new NotFoundException('Consultation session not found');

    await this.assertParticipant(userId, role, session.appointment.patientProfileId, session.appointment.doctorProfileId);

    const presence: Presence = {
      patientPresent: session.patientJoinedAt !== null,
      doctorPresent: session.doctorJoinedAt !== null,
    };

    return { session, presence };
  }

  private async assertParticipant(
    userId: string,
    role: string,
    patientProfileId: string,
    doctorProfileId: string,
  ): Promise<void> {
    if (role === 'PATIENT') {
      const p = await this.prisma.patientProfile.findUnique({ where: { userId } });
      if (!p) throw new NotFoundException('Patient profile not found');
      if (p.id !== patientProfileId) throw new ForbiddenException('Not your consultation session');
      return;
    }
    if (role === 'DOCTOR') {
      const d = await this.prisma.doctorProfile.findUnique({ where: { userId } });
      if (!d) throw new NotFoundException('Doctor profile not found');
      if (d.id !== doctorProfileId) throw new ForbiddenException('Not your consultation session');
      return;
    }
    throw new ForbiddenException('Unsupported role');
  }
}
