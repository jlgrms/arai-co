import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePatientProfileDto } from './dto/update-patient-profile.dto';

// Explicit field selection guarantees passwordHash (a User column) is never
// included when we read a patient's profile.
const PATIENT_PROFILE_SELECT = {
  id: true,
  userId: true,
  name: true,
  birthday: true,
  weight: true,
  height: true,
  contactDetails: true,
  basicMedicalHistory: true,
  avatarInitialsOrRef: true,
} as const;

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Read the authenticated patient's own profile. */
  async getOwnProfile(userId: string) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
      select: PATIENT_PROFILE_SELECT,
    });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }

  /** Partial update of the authenticated patient's own profile. */
  async updateOwnProfile(userId: string, dto: UpdatePatientProfileDto) {
    const existing = await this.prisma.patientProfile.findUnique({ where: { userId } });
    if (!existing) {
      throw new NotFoundException('Patient profile not found');
    }

    // Regenerate initials whenever the name changes (no external file storage).
    const avatarInitialsOrRef =
      dto.name !== undefined ? this.initials(dto.name) : undefined;

    return this.prisma.patientProfile.update({
      where: { userId },
      data: {
        name: dto.name,
        birthday: dto.birthday ? new Date(dto.birthday) : undefined,
        weight: dto.weight,
        height: dto.height,
        contactDetails: dto.contactDetails,
        basicMedicalHistory: dto.basicMedicalHistory,
        avatarInitialsOrRef,
      },
      select: PATIENT_PROFILE_SELECT,
    });
  }

  private initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();
  }
}
