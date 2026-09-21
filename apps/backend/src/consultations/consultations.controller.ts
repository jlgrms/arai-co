import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ConsultationsService } from './consultations.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';

// Consultation session state machine + clinical records (S5.2/S5.3).
// Both PATIENT and DOCTOR hit the session routes; participant scoping is
// enforced in the service (403 for non-participants). Records write routes are
// DOCTOR-only (@Roles) AND participant-scoped; invalid state -> 409; invalid
// payload -> 400. Invalid transitions -> 409 via the global filter.
//
// ROUTE ORDER MATTERS: static-segment routes (records/me, records/patient/:id)
// are declared BEFORE the GET :id wildcard, or "records" would be captured as
// an :id (same ordering rule as DoctorsController).
@Controller('consultations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  // ---- Records reads (participant-scoped) ----

  // Patient's own medical records (S5.2). PATIENT-only; only COMPLETED sessions.
  @Get('records/me')
  @Roles(Role.PATIENT)
  getMyRecords(@CurrentUser() user: AuthenticatedUser) {
    return this.consultationsService.getMyRecords(user.id);
  }

  // Doctor views a patient's records (S5.3), scoped to the doctor-patient
  // appointment relation (403 when no such appointment exists).
  @Get('records/patient/:patientProfileId')
  @Roles(Role.DOCTOR)
  getPatientRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientProfileId') patientProfileId: string,
  ) {
    return this.consultationsService.getPatientRecordsForDoctor(user.id, patientProfileId);
  }

  // ---- Records writes (DOCTOR-only + participant-scoped + state-gated) ----

  @Post(':id/notes')
  @Roles(Role.DOCTOR)
  addNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.consultationsService.addNote(user.id, user.role, id, dto);
  }

  @Post(':id/prescriptions')
  @Roles(Role.DOCTOR)
  addPrescription(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return this.consultationsService.addPrescription(user.id, user.role, id, dto);
  }

  // Records for one session (participant-scoped; state-gated read).
  @Get(':id/records')
  getSessionRecords(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.consultationsService.getSessionRecords(user.id, user.role, id);
  }

  // ---- Session state machine ----

  // SCHEDULED -> JOINED (first participant), JOINED -> IN_PROGRESS (both present).
  @Post(':id/join')
  join(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.consultationsService.join(user.id, user.role, id);
  }

  // Doctor-only completion; idempotent rejection of a re-complete (409).
  @Post(':id/complete')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.consultationsService.complete(user.id, user.role, id);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.consultationsService.getOne(user.id, user.role, id);
  }
}
