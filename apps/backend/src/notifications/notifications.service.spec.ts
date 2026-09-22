import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

describe('NotificationsService (sub-item 8)', () => {
  it('listMine: scopes to the caller userId and orders most-recent-first', async () => {
    const prisma: any = {
      notification: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new NotificationsService(prisma);
    await svc.listMine('user-1');

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('markRead: own notification -> sets read=true', async () => {
    const prisma: any = {
      notification: {
        findUnique: jest.fn().mockResolvedValue({ id: 'n-1', userId: 'user-1', read: false }),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'n-1', userId: 'user-1', ...data })),
      },
    };
    const svc = new NotificationsService(prisma);
    const res = await svc.markRead('user-1', 'n-1');
    expect(res.read).toBe(true);
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { read: true },
    });
  });

  it('markRead: another user\'s notification -> 403, no write', async () => {
    const prisma: any = {
      notification: {
        findUnique: jest.fn().mockResolvedValue({ id: 'n-1', userId: 'user-OWNER', read: false }),
        update: jest.fn(),
      },
    };
    const svc = new NotificationsService(prisma);
    await expect(svc.markRead('user-INTRUDER', 'n-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('markRead: missing notification -> 404', async () => {
    const prisma: any = {
      notification: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };
    const svc = new NotificationsService(prisma);
    await expect(svc.markRead('user-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});
