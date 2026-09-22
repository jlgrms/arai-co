import {
  adminCancelledMessage,
  appointmentCancelledMessage,
  appointmentRescheduledMessage,
  bookingConfirmedMessage,
  formatInstantForNotification,
} from './notification-message';

describe('formatInstantForNotification', () => {
  it('renders a readable date and time instead of a machine string', () => {
    // The defect this exists to prevent: users were shown
    // "2026-09-23T09:00:00.000Z", which is a wire format.
    expect(formatInstantForNotification(new Date('2026-09-23T09:00:00.000Z'))).toBe(
      '23 Sep 2026, 09:00 UTC',
    );
  });

  it('never emits ISO-8601 or a trailing Z', () => {
    const out = formatInstantForNotification(new Date('2026-09-23T09:00:00.000Z'));
    expect(out).not.toMatch(/T\d{2}:\d{2}:\d{2}/);
    expect(out).not.toMatch(/\.\d{3}/);
    expect(out).not.toMatch(/Z\b/);
  });

  it('states the timezone zone explicitly, since it is UTC not local', () => {
    // `Z` is meaningless to most readers, so the assumption is spelled out.
    expect(formatInstantForNotification(new Date('2026-01-02T03:04:00.000Z'))).toContain('UTC');
  });

  it('renders UTC fields, not host-local ones', () => {
    // 23:30 UTC is the previous day in any negative offset. Reading the UTC
    // getters is what keeps this stable regardless of the machine's timezone,
    // and is the reason toLocaleString was rejected.
    expect(formatInstantForNotification(new Date('2026-09-23T23:30:00.000Z'))).toBe(
      '23 Sep 2026, 23:30 UTC',
    );
  });

  it('pads hours and minutes to two digits', () => {
    expect(formatInstantForNotification(new Date('2026-09-23T04:05:00.000Z'))).toBe(
      '23 Sep 2026, 04:05 UTC',
    );
  });

  it('uses a 24-hour clock with midnight as 00:00', () => {
    expect(formatInstantForNotification(new Date('2026-09-23T00:00:00.000Z'))).toBe(
      '23 Sep 2026, 00:00 UTC',
    );
  });

  it('does not zero-pad the day (matches the client formatter)', () => {
    expect(formatInstantForNotification(new Date('2026-09-03T09:00:00.000Z'))).toBe(
      '3 Sep 2026, 09:00 UTC',
    );
  });

  it('covers month boundaries so the month table cannot drift', () => {
    const at = (iso: string) => formatInstantForNotification(new Date(iso));
    expect(at('2026-01-15T12:00:00.000Z')).toContain('Jan');
    expect(at('2026-06-15T12:00:00.000Z')).toContain('Jun');
    expect(at('2026-12-15T12:00:00.000Z')).toContain('Dec');
    // December is index 11 — an off-by-one here would render 'undefined'.
    expect(at('2026-12-15T12:00:00.000Z')).not.toContain('undefined');
  });

  it('handles a leap day', () => {
    expect(formatInstantForNotification(new Date('2028-02-29T09:00:00.000Z'))).toBe(
      '29 Feb 2028, 09:00 UTC',
    );
  });
});

describe('appointment message builders', () => {
  const at = new Date('2026-09-23T09:00:00.000Z');

  it('names the counterparty and a readable time (booking)', () => {
    const msg = bookingConfirmedMessage('Dr. Camila Reyes', at);
    expect(msg).toBe('Appointment booked with Dr. Camila Reyes on 23 Sep 2026, 09:00 UTC');
  });

  it('names the counterparty and the NEW time (reschedule)', () => {
    const msg = appointmentRescheduledMessage('Jordan Lee', at);
    expect(msg).toBe('Appointment with Jordan Lee rescheduled to 23 Sep 2026, 09:00 UTC');
  });

  it('names the counterparty and the original time (cancel)', () => {
    const msg = appointmentCancelledMessage('Dr. Camila Reyes', at);
    expect(msg).toBe(
      'Appointment with Dr. Camila Reyes on 23 Sep 2026, 09:00 UTC was cancelled',
    );
  });

  it('keeps the counterparty name positional so either role reads correctly', () => {
    // The same builder serves both recipients: the patient sees the doctor's
    // name, the doctor sees the patient's. Nothing about the sentence assumes
    // which one it is.
    expect(bookingConfirmedMessage('Dr. Camila Reyes', at)).toContain('Dr. Camila Reyes');
    expect(bookingConfirmedMessage('Jordan Lee', at)).toContain('Jordan Lee');
  });

  it('emits no machine-readable timestamp in any builder', () => {
    for (const msg of [
      bookingConfirmedMessage('X', at),
      appointmentRescheduledMessage('X', at),
      appointmentCancelledMessage('X', at),
      adminCancelledMessage(at),
    ]) {
      expect(msg).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    }
  });
});

describe('adminCancelledMessage', () => {
  it('says who cancelled, since neither recipient did', () => {
    // In the patient-initiated flow the recipient is the other party and the
    // actor is implied. Here an administrator acted, so both recipients need to
    // be told that — the message must not read as though the counterparty did it.
    const msg = adminCancelledMessage(new Date('2026-09-23T09:00:00.000Z'));
    expect(msg).toContain('cancelled by an administrator');
  });

  it('does not name a counterparty, because both parties receive it', () => {
    const msg = adminCancelledMessage(new Date('2026-09-23T09:00:00.000Z'));
    expect(msg).not.toMatch(/with /);
  });

  it('still renders a readable time', () => {
    expect(adminCancelledMessage(new Date('2026-09-23T09:00:00.000Z'))).toBe(
      'Appointment on 23 Sep 2026, 09:00 UTC was cancelled by an administrator',
    );
  });
});
