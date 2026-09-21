import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';

// Appointments module. Book/reschedule/cancel are PATIENT-only (S5.7 correction:
// doctors have availability management, not booking authority; admin oversight
// handles non-patient cancellations in sub-item 9).
@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @Roles(Role.PATIENT)
  book(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAppointmentDto) {
    return this.appointmentsService.book(user.id, dto);
  }

  @Patch(':id/reschedule')
  @Roles(Role.PATIENT)
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointmentsService.reschedule(user.id, id, dto);
  }

  @Patch(':id/cancel')
  @Roles(Role.PATIENT)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.appointmentsService.cancel(user.id, id);
  }

  // Reads are participant-scoped (patient sees own; doctor sees own).
  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.appointmentsService.listMine(user.id, user.role);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.appointmentsService.getOne(user.id, user.role, id);
  }
}
