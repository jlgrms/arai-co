import {
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

// Maps state-machine rejection reasons to human-readable 409 messages (S5.5
// pattern: state-conflict -> 409, same envelope as booking conflicts).
const TRANSITION_MESSAGE: Record<string, string> = {
  TERMINAL: 'This consultation session is already completed',
  NOT_JOINED: 'Cannot complete a session that has not been joined',
  INVALID_TRANSITION: 'This transition is not permitted from the current state',
  ALREADY_IN_PROGRESS: 'Session is already in progress',
};

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
      // Idempotent: return current session untouched.
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
    });
  }

  // ---- Read (participant-scoped) -----------------------------------------------

  async getOne(userId: string, role: string, sessionId: string) {
    const { session } = await this.loadParticipantSession(userId, role, sessionId);
    return session;
  }

  // ---- Helpers ------------------------------------------------------------------

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