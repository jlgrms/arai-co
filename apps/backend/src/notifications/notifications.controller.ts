import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { NotificationsService } from './notifications.service';

// Notifications are shared by both PATIENT and DOCTOR (S5.2/S5.3) — any
// authenticated role may read its own feed. No role guard beyond JWT: scoping
// is enforced per-user inside the service, not by role.
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listMine(user.id);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notificationsService.markRead(user.id, id);
  }
}