// Smoke tests for the Layer 5 notification bell. These exist to prove the
// vitest + @testing-library/react harness is wired up correctly, and to lock in
// the two most important render branches of the bell: the empty state and a
// populated list. They mock the API client so no network/backend is needed.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the REST client the bell reads from. vi.mock is hoisted, so the factory
// defines its own mock and we grab it via the imported `api` below.
vi.mock('@/lib/api-client', () => {
  return {
    ApiError: class ApiError extends Error {},
    api: { get: vi.fn(), patch: vi.fn() },
  };
});

import { api } from '@/lib/api-client';
import { NotificationBell } from './notification-bell';

const mockedApi = vi.mocked(api, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotificationBell', () => {
  it('renders the empty state when the user has no notifications', async () => {
    mockedApi.get.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<NotificationBell />);

    // Open the dropdown (Radix responds to real pointer events).
    await user.click(screen.getByRole('button', { name: /notifications/i }));

    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  it('renders unread notifications and the unread count when rows exist', async () => {
    mockedApi.get.mockResolvedValueOnce([
      {
        id: 'n1',
        userId: 'u1',
        type: 'BOOKING_CONFIRMED',
        message: 'Appointment booked with Dr. Chen',
        read: false,
        createdAt: new Date().toISOString(),
      },
    ]);
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: /notifications/i }));

    expect(await screen.findByText(/appointment booked with dr\. chen/i)).toBeInTheDocument();
    expect(await screen.findByText(/1 unread/i)).toBeInTheDocument();
  });

  it('marks a notification read when its row is clicked', async () => {
    mockedApi.get.mockResolvedValueOnce([
      {
        id: 'n1',
        userId: 'u1',
        type: 'BOOKING_CONFIRMED',
        message: 'Appointment booked with Dr. Chen',
        read: false,
        createdAt: new Date().toISOString(),
      },
    ]);
    mockedApi.patch.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: /notifications/i }));
    const row = await screen.findByText(/appointment booked with dr\. chen/i);
    await user.click(row);

    await waitFor(() => expect(mockedApi.patch).toHaveBeenCalledWith('/notifications/n1/read'));
    // Unread count clears optimistically once marked read.
    await waitFor(() => expect(screen.queryByText(/1 unread/i)).not.toBeInTheDocument());
  });
});