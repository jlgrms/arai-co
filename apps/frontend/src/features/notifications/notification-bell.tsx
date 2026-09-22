import * as React from 'react';
import { Bell, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/** Mirrors the Prisma Notification row returned by GET /notifications/me. */
interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * In-app notification affordance (S5.2/S5.3). Shared by patient and doctor
 * surfaces; admin has no bell (confirmed in scope). Database-backed only — no
 * push/email/SMS. Fetches on open rather than polling, which is enough for the
 * prototype and avoids a background network loop.
 */
export function NotificationBell() {
  const [items, setItems] = React.useState<NotificationRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const unread = items?.filter((n) => !n.read).length ?? 0;

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    api
      .get<NotificationRow[]>('/notifications/me')
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not load notifications.');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function markRead(id: string) {
    // Optimistic: flip locally, revert on failure.
    setItems((prev) => (prev ? prev.map((n) => (n.id === id ? { ...n, read: true } : n)) : prev));
    try {
      await api.patch(`/notifications/${id}/read`);
    } catch {
      setItems((prev) =>
        prev ? prev.map((n) => (n.id === id ? { ...n, read: false } : n)) : prev,
      );
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex size-2 items-center justify-center rounded-full bg-accent" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-ink">Notifications</span>
          {unread > 0 && <span className="text-xs text-muted-foreground">{unread} unread</span>}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {error ? (
            <p className="px-3 py-6 text-center text-sm text-danger-text">{error}</p>
          ) : items === null ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => !n.read && markRead(n.id)}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted',
                      !n.read && 'bg-muted/40',
                    )}
                  >
                    <span className="mt-0.5 shrink-0">
                      {!n.read ? (
                        <span className="block size-2 rounded-full bg-accent" />
                      ) : (
                        <Check className="size-3.5 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className="flex-1 space-y-0.5">
                      <span className="block text-ink">{n.message}</span>
                      <span className="block text-xs text-muted-foreground">
                        {relativeTime(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
