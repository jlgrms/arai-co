import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, ApprovalStatus, Prisma } from '@prisma/client';
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
   * Browse APPROVED doctors. Optional filters, all combinable (AND):
   *  - specialization: exact (case-insensitive) match on DoctorProfile.specialization
   *  - available=true: only doctors with >= 1 free, future, unblocked, unconsumed slot
   *  - search: case-insensitive substring over name OR biography
   *
   * Search is server-side so it covers the whole approved set, not just a page.
   * Blank/whitespace-only search is treated as "no search filter" so an empty
   * input box doesn't silently exclude every doctor with a null biography.
   */
  async discover(opts: { specialization?: string; available?: boolean; search?: string }) {
    const now = new Date();
    const where: Prisma.DoctorProfileWhereInput = { approvalStatus: ApprovalStatus.APPROVED };
    if (opts.specialization) {
      where.specialization = { equals: opts.specialization, mode: 'insensitive' };
    }
    const search = opts.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { biography: { contains: search, mode: 'insensitive' } },
      ];
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
   * The known symptom/concern phrases, for the guided-matching screen's quick-pick
   * chips. Served from the DB rather than hardcoded in the frontend so the chips
   * cannot drift from the matching table they are supposed to represent — if the
   * admin-editable map changes, the chips follow automatically.
   *
   * Returns only phrases that actually lead somewhere: each is checked against the
   * map via the same pure matcher `match()` uses, and dropped unless it resolves to
   * at least one specialty. A chip that always lands on the "no match" empty state
   * would be a dead end presented as a suggestion.
   */
  async listMatchOptions() {
    const map = await this.prisma.symptomSpecialtyMap.findMany({
      select: { symptomOrConcern: true, specialty: true },
      orderBy: { symptomOrConcern: 'asc' },
    });

    const options = map
      .map((row) => ({
        symptom: row.symptomOrConcern,
        specialties: matchSymptomToSpecialties(row.symptomOrConcern, map),
      }))
      .filter((option) => option.specialties.length > 0);

    return { options };
  }

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

  // ---- POC: AI-assisted matching (DeepSeek) -------------------------------------

  /**
   * The specialties we actually have APPROVED doctors in.
   *
   * Derived from the DoctorProfile table rather than hardcoded, so the prompt can
   * only ever offer the model a specialty that resolves to a real doctor. A
   * hardcoded list would silently drift the moment a specialization is added or
   * removed, and the model would confidently name a specialty with nobody behind it.
   */
  private async availableSpecialties(): Promise<string[]> {
    const rows = await this.prisma.doctorProfile.findMany({
      where: { approvalStatus: ApprovalStatus.APPROVED },
      select: { specialization: true },
      distinct: ['specialization'],
      orderBy: { specialization: 'asc' },
    });
    return rows.map((r) => r.specialization);
  }

  /**
   * POC AI matching: free-text symptom -> DeepSeek -> one specialty -> doctors.
   *
   * Deliberately minimal, per the POC brief:
   *   - no retries, no rate limiting, no prompt tuning;
   *   - a single 15s AbortController timeout so a hung request cannot pin a
   *     request handler forever;
   *   - the model's answer is validated against the known list and, if it does not
   *     match, we fall back to the first specialty rather than building elaborate
   *     repair logic.
   *
   * The response shape is intentionally IDENTICAL to `match()` (plus an `engine`
   * marker) so the existing guided-matching screen can render it with no new
   * result UI.
   */
  async matchAi(symptom: string) {
    const text = (symptom ?? '').trim();
    const specialties = await this.availableSpecialties();

    if (!text || specialties.length === 0) {
      return { symptom: text, matchedSpecialties: [], doctors: [], engine: 'ai' as const };
    }

    const chosen = await this.askDeepSeekForSpecialty(text, specialties);
    const matchedSpecialties = [chosen ?? specialties[0]];

    const doctors = await this.prisma.doctorProfile.findMany({
      where: {
        approvalStatus: ApprovalStatus.APPROVED,
        specialization: { in: matchedSpecialties, mode: 'insensitive' },
      },
      select: DOCTOR_PUBLIC_SELECT,
      orderBy: { name: 'asc' },
    });

    return { symptom: text, matchedSpecialties, doctors, engine: 'ai' as const };
  }

  /**
   * Ask DeepSeek to name ONE specialty from the supplied list.
   *
   * Returns null when the call fails or the key is unset — the caller then falls
   * back to the first specialty. This is a POC, so a failed API call degrades
   * rather than throwing a 500 at the patient.
   */
  private async askDeepSeekForSpecialty(
    symptom: string,
    specialties: string[],
  ): Promise<string | null> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      // Warned so the failure is diagnosable rather than a silent wrong answer.
      console.warn('  ! DEEPSEEK_API_KEY is not set — AI matching falls back to the first specialty');
      return null;
    }

    const prompt =
      `You are a medical triage assistant. A patient describes their problem as:\n` +
      `"${symptom}"\n\n` +
      `Choose the single most appropriate specialty from this list:\n` +
      specialties.join(', ') +
      `\n\nReply with ONLY the specialty name, exactly as written above. No punctuation, no explanation.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 20,
          temperature: 0,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        console.warn(`  ! DeepSeek returned HTTP ${res.status} — falling back`);
        return null;
      }

      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = body.choices?.[0]?.message?.content?.trim() ?? '';
      // Strip stray quotes/backticks/periods the model may add despite instructions.
      const cleaned = raw.replace(/^["'`]+|["'`.]+$/g, '').trim();
      const hit = specialties.find((s) => s.toLowerCase() === cleaned.toLowerCase());
      if (!hit) {
        console.warn(
          `  ! DeepSeek replied ${JSON.stringify(raw)} — not a known specialty, falling back`,
        );
        return null;
      }
      return hit;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`  ! DeepSeek call failed (${reason}) — falling back`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
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
