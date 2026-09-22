import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { DoctorsService } from './doctors.service';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';

// NOTE ON GUARD PLACEMENT:
// Discovery + matching are readable by any authenticated role, while the
// /me/* management routes are DOCTOR-only. Per-method guards express that.
// ROUTE ORDER MATTERS: GET /doctors/match and GET /doctors/me* must be declared
// before GET /doctors/:id, or "match"/"me" would be captured as an :id.
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  // ---- Own profile (DOCTOR only) ----

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.doctorsService.getOwnProfile(user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDoctorProfileDto,
  ) {
    return this.doctorsService.updateOwnProfile(user.id, dto);
  }

  // ---- Own availability management (DOCTOR only) ----

  @Get('me/availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
  listAvailability(@CurrentUser() user: AuthenticatedUser) {
    return this.doctorsService.listOwnAvailability(user.id);
  }

  @Post('me/availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
  createAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAvailabilityDto,
  ) {
    return this.doctorsService.createAvailability(user.id, dto);
  }

  @Patch('me/availability/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
  updateAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.doctorsService.updateAvailability(user.id, id, dto);
  }

  @Delete('me/availability/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
  deleteAvailability(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.doctorsService.deleteAvailability(user.id, id);
  }

  // ---- Deterministic matching (any authenticated role) ----

  @Get('match')
  @UseGuards(JwtAuthGuard)
  match(@Query('symptom') symptom: string) {
    return this.doctorsService.match(symptom ?? '');
  }

  // ---- Discovery (any authenticated role) ----

  @Get()
  @UseGuards(JwtAuthGuard)
  discover(
    @Query('specialization') specialization?: string,
    @Query('available') available?: string,
    @Query('search') search?: string,
  ) {
    return this.doctorsService.discover({
      specialization,
      available: available === 'true',
      search,
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getPublicDoctor(@Param('id') id: string) {
    return this.doctorsService.getPublicDoctor(id);
  }
}
