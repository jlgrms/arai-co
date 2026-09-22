
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountState, ApprovalStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AdminService } from './admin.service';
import { UpdateUserStateDto } from './dto/update-user-state.dto';
import { ReviewDoctorDto } from './dto/review-doctor.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';

// Layer 4 sub-item 9 — admin services (S5.4).
// Whole controller is ADMIN-only via the guard chain; every mutating route
// writes an AuditLog row through the shared AuditService.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ---- 1. User management ----------------------------------------------------

  @Get('users')
  listUsers(
    @Query('role') role?: Role,
    @Query('accountState') accountState?: AccountState,
    @Query('q') q?: string,
  ) {
    return this.admin.listUsers({ role, accountState, q });
  }

  @Patch('users/:id/state')
  updateUserState(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserStateDto,
  ) {
    return this.admin.updateUserState(user.id, id, dto);
  }

  // ---- 2. Doctor profile review ---------------------------------------------

  @Get('doctors')
  listDoctors(
    @Query('approvalStatus') approvalStatus?: ApprovalStatus,
    @Query('q') q?: string,
  ) {
    return this.admin.listDoctors({ approvalStatus, q });
  }

  // Same DTO constraints as the doctor's own PATCH /doctors/me — no bypass.
  @Patch('doctors/:id/review')
  reviewDoctor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewDoctorDto,
  ) {
    return this.admin.reviewDoctor(user.id, id, dto);
  }

  // ---- 3. Appointment oversight ---------------------------------------------

  @Get('appointments')
  listAppointments() {
    return this.admin.listAppointments();
  }

  // Separate admin-scoped cancel path; the patient cancel route is untouched.
  // HttpCode(200): cancel is idempotent (re-cancel on CANCELLED returns as-is),
  // so it reads as a plain action result rather than a resource creation.
  @Post('appointments/:id/cancel')
  @HttpCode(200)
  cancelAppointment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelAppointmentDto,
  ) {
    return this.admin.cancelAppointment(user.id, id, dto);
  }

  // ---- 4. Operational dashboard ---------------------------------------------

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  // ---- 5. Audit log read ----------------------------------------------------

  @Get('audit-logs')
  listAuditLogs() {
    return this.admin.listAuditLogs();
  }
}
