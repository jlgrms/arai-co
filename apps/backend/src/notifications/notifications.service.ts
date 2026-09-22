import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Sub-item 8 — Notifications Module (C4 3a).
// Database-backed in-app notifications only. No email/SMS/push (S5.2/S5.3),
// no queue/broker — reads and writes go straight through Prisma.
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /notifications/me — the caller's own notifications, most recent first.
   * Ordering: createdAt DESC, tie-broken by id DESC (Flag 4).
   * Scope is ALWAYS the caller's own userId — never a client-supplied id.
   */
  async listMine(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * PATCH /notifications/:id/read — mark one of the caller's OWN notifications
   * read. Participant-scoped (Flag 5): a user may only mark their own row.
   *  - missing row        -> 404
   *  - someone else's row -> 403
   */
  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.userId !== userId) {
      throw new ForbiddenException('You can only mark your own notifications read');
    }
    return this.prisma.notification.update({
      where: { id: notification.id },
      data: { read: true },
    });
  }
}