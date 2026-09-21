import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ConsultationsService } from './consultations.service';

// Consultation session state machine (S5.2/S5.3). Both PATIENT and DOCTOR hit
// these routes; participant scoping is enforced in the service (403 for
// non-participants). Invalid transitions -> 409 via the global filter.
@Controller('consultations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

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