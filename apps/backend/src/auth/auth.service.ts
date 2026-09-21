import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountState, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterPatientDto } from './dto/register-patient.dto';
import { RegisterDoctorDto } from './dto/register-doctor.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Register a PATIENT: creates User + PatientProfile in one transaction. */
  async registerPatient(dto: RegisterPatientDto) {
    await this.assertEmailAvailable(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          role: Role.PATIENT,
          accountState: AccountState.ACTIVE,
        },
      });
      await tx.patientProfile.create({
        data: {
          userId: created.id,
          name: dto.name,
          contactDetails: dto.contactDetails ?? null,
          // Generated initials avatar — no external file storage (ground rule 4).
          avatarInitialsOrRef: this.initials(dto.name),
        },
      });
      return created;
    });
    return this.issueToken(user.id, user.role);
  }

  /** Register a DOCTOR: creates User + DoctorProfile in one transaction. */
  async registerDoctor(dto: RegisterDoctorDto) {
    await this.assertEmailAvailable(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          role: Role.DOCTOR,
          accountState: AccountState.ACTIVE,
        },
      });
      await tx.doctorProfile.create({
        data: {
          userId: created.id,
          name: dto.name,
          specialization: dto.specialization,
          biography: dto.biography ?? null,
          // New doctor profiles await admin approval (admin flow is Layer 4).
          approvalStatus: 'PENDING',
        },
      });
      return created;
    });
    return this.issueToken(user.id, user.role);
  }

  /** Login for PATIENT/DOCTOR/ADMIN. Rejects non-ACTIVE accounts with 403. */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Same generic 401 whether the email is unknown or the password is wrong
    // (do not leak which emails exist).
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Valid credentials but account not usable: 403 with a clear reason.
    if (user.accountState !== AccountState.ACTIVE) {
      throw new ForbiddenException(`Account is ${user.accountState.toLowerCase()}`);
    }

    return this.issueToken(user.id, user.role);
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
  }

  private async issueToken(userId: string, role: Role) {
    const payload: JwtPayload = { sub: userId, role };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, userId, role };
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
