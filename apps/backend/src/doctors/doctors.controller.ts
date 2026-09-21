import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

// TEMPORARY Layer 3 verification route — proves the guard chain end to end.
// NOT a product feature; replaced by real doctor endpoints in Layer 4.
@Controller('doctors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DoctorsController {
  @Get('ping')
  @Roles(Role.DOCTOR)
  ping(@CurrentUser() user: AuthenticatedUser): { id: string; role: Role } {
    return { id: user.id, role: user.role };
  }
}
