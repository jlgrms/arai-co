/**
 * Evidence — a CANCELLED appointment can no longer be joined.
 *
 * Reproduces the exact defect found during the Layer 6/7 harness sweep:
 *   book -> cancel -> the appointment still shows "View summary" -> the
 *   consultation room offered Join -> POST /consultations/:id/join returned 201
 *   and moved the session SCHEDULED -> JOINED.
 *
 * This harness drives the REAL HTTP API (no direct DB writes) and asserts:
 *   J1  booking a slot creates a session
 *   J2  the session is SCHEDULED and the appointment BOOKED
 *   J3  joining a LIVE appointment still works (201) — the guard is specific
 *   J4  cancelling the appointment succeeds, and leaves the session SCHEDULED
 *   J5  joining a CANCELLED appointment is refused (409)  <- the fix
 *   J6  the refusal explains the cancellation
 *   J7  a second join attempt is still refused (not one-shot)
 *   J8  the session is still VIEWABLE (the guard is not in the shared loader)
 *   J9  the session state is unchanged at SCHEDULED
 *   J10 the DOCTOR is refused too (the refusal is bilateral)
 *
 * Two live slots are booked so the live-join proof (J3) and the cancelled proof
 * (J5) cannot contaminate each other: a session already JOINED would be refused
 * for a different reason, which would not distinguish the two cases.
 *
 * THE HARNESS MAKES ITS OWN SLOTS. An earlier version booked slots the doctor
 * already had and then DELETED them during cleanup, which quietly ate the
 * doctor's schedule: four runs took Dr. Silva from 5 slots to 1, and the fifth
 * could not run at all ("need 2 free slots"). Deleting a pre-existing fixture is
 * not cleanup. This version creates two private far-future slots tagged with
 * its own prefix, then cancels the appointments and deletes exactly those two,
 * so the doctor's own schedule is returned untouched and runs are repeatable.
 * Reports per-item reclaim success, not attempt counts.
 *
 * Usage: node scripts/evidence-cancelled-join.mjs
 */

import { createReclaimer } from './lib/reclaim.mjs';

const API = process.env.API_BASE ?? 'http://localhost:3000';
const PATIENT = { email: 'jordan.lee@example.com', password: 'PatientPass123!' };
const DOCTOR = { email: 'dr.silva@example.com', password: 'DoctorPass123!' };

// Fixture reclamation (DEFERRED items 1 and 2). This harness books against
// SEEDED accounts, so nothing it creates cascades: deleting a user is not even
// possible here (both are seed data). The appointments, their consultation
// sessions and the notifications the cancel generates are tracked by id and
// removed outright.
const reclaim = createReclaimer({ label: 'cancelled-join' });

// Notification has no Appointment FK (see scripts/lib/reclaim.mjs), and both
// parties here are seeded accounts, so the cancel's notifications do not cascade
// either. Snapshot a token's feed so newly-added rows can be identified.
async function feedIds(token) {
  const res = await request('GET', '/notifications/me', { token });
  const rows = Array.isArray(res.body) ? res.body : [];
  return new Set(rows.map((n) => n.id));
}
async function trackNewNotifications(token, before) {
  const res = await request('GET', '/notifications/me', { token });
  const rows = Array.isArray(res.body) ? res.body : [];
  for (const n of rows) if (!before.has(n.id)) reclaim.trackNotification(n.id);
}

let pass = 0;
let fail = 0;
const results = [];

function check(id, ok, detail = '') {
  if (ok) {
    pass += 1;
    results.push(`  PASS  ${id}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    results.push(`  FAIL  ${id}${detail ? ` — ${detail}` : ''}`);
  }
}

async function request(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: res.status, body: payload };
}

async function login(creds) {
  const res = await request('POST', '/auth/login', { body: creds });
  if (res.status >= 300 || !res.body?.accessToken) {
    throw new Error(`login failed for ${creds.email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken;
}

/** Book a slot and return { appointmentId, sessionId }. */
async function book(token, availabilityId) {
  const res = await request('POST', '/appointments', { token, body: { availabilityId } });
  if (res.status !== 201) {
    throw new Error(`booking failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const appointmentId = res.body.id;
  let sessionId = res.body.consultationSession?.id ?? res.body.sessionIds?.[0];
  if (!sessionId) {
    const detail = await request('GET', `/appointments/${appointmentId}`, { token });
    sessionId = detail.body?.consultationSession?.id;
  }
  return { appointmentId, sessionId };
}

/**
 * Create `count` private far-future availability slots for the doctor.
 *
 * Far-future (100+ days out) and uniquely tagged so they can never collide with
 * the doctor's real schedule — the whole point being that cleanup deletes only
 * what this harness made. Consecutive one-hour windows, offset per run so two
 * overlapping runs cannot pick the same window.
 */
async function makeOwnSlots(token, count) {
  const base = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
  base.setUTCMinutes(0, 0, 0);
  // Nudge by an hour per run to keep concurrent invocations off each other.
  base.setUTCHours(base.getUTCHours() + (Date.now() % 12));

  const slots = [];
  for (let i = 0; i < count; i += 1) {
    const start = new Date(base.getTime() + i * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const res = await request('POST', '/doctors/me/availability', {
      token,
      body: { startTime: start.toISOString(), endTime: end.toISOString() },
    });
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(
        `creating harness slot failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    slots.push(res.body.id);
    reclaim.trackSlot(res.body.id);
  }
  // Return in chronological order so J3 uses the earlier slot.
  return slots.sort((a, b) => a.localeCompare(b)).map((id, i) => ({ id, i }));
}

async function main() {
  const patientToken = await login(PATIENT);
  const doctorToken = await login(DOCTOR);

  // --- Create this harness's OWN slots ----------------------------------------
  // Never book slots the doctor already had: cleanup would then have to delete
  // them to free the FK, which silently erodes the doctor's real schedule.
  const ownSlots = await makeOwnSlots(doctorToken, 2);
  if (ownSlots.length < 2) {
    throw new Error(`could only create ${ownSlots.length}/2 harness slots`);
  }

  // Snapshot BOTH parties' notification feeds before ANY booking. Every booking
  // writes a BOOKING_CONFIRMED row to each party, and neither cascades (both are
  // seeded accounts), so both legs have to be covered — not just the cancelled
  // one. Missed on the first pass: tracking only Leg 2 left +4 rows behind.
  const patientFeedAtStart = await feedIds(patientToken);
  const doctorFeedAtStart = await feedIds(doctorToken);

  try {
    // ============ Leg 1 — a LIVE appointment CAN still be joined ============
    const live = await book(patientToken, ownSlots[0].id);
    reclaim.trackAppointment(live.appointmentId);
    await trackNewNotifications(patientToken, patientFeedAtStart);
    await trackNewNotifications(doctorToken, doctorFeedAtStart);
    check('J1  booking a live appointment succeeds', Boolean(live.appointmentId), live.appointmentId);
    check('J1b a consultation session exists for it', Boolean(live.sessionId), live.sessionId ?? 'none');
    if (!live.sessionId) return;

    const pre = await request('GET', `/consultations/${live.sessionId}`, { token: patientToken });
    check(
      'J2  the session is SCHEDULED and the appointment BOOKED',
      pre.status === 200 &&
        pre.body?.state === 'SCHEDULED' &&
        pre.body?.appointment?.status === 'BOOKED',
      `state=${pre.body?.state} status=${pre.body?.appointment?.status}`,
    );

    const liveJoin = await request('POST', `/consultations/${live.sessionId}/join`, {
      token: patientToken,
    });
    check(
      'J3  joining a LIVE appointment still works (201) — the guard is specific',
      liveJoin.status === 201,
      `got ${liveJoin.status} state=${liveJoin.body?.state}`,
    );

    // ============ Leg 2 — a CANCELLED appointment CANNOT ====================
    const doomed = await book(patientToken, ownSlots[1].id);
    reclaim.trackAppointment(doomed.appointmentId);
    if (!doomed.sessionId) throw new Error('no session for the second booking');

    // THIS BOOKING ALSO WRITES NOTIFICATIONS — one BOOKING_CONFIRMED to each
    // party — and they must be captured BEFORE the next snapshot below, because
    // that snapshot is taken to isolate the CANCEL's notifications. Missing this
    // is what left +2 rows behind on the second pass: only the cancel's two rows
    // were tracked, the booking's two were not.
    await trackNewNotifications(patientToken, patientFeedAtStart);
    await trackNewNotifications(doctorToken, doctorFeedAtStart);

    // Snapshot both parties' feeds before the cancel, because the cancel writes a
    // notification to each and neither cascades.
    const patientFeedBefore = await feedIds(patientToken);
    const doctorFeedBefore = await feedIds(doctorToken);

    const cancelled = await request('PATCH', `/appointments/${doomed.appointmentId}/cancel`, {
      token: patientToken,
    });
    await trackNewNotifications(patientToken, patientFeedBefore);
    await trackNewNotifications(doctorToken, doctorFeedBefore);
    check(
      'J4  cancelling the appointment succeeds',
      cancelled.status === 200 || cancelled.status === 201,
      `got ${cancelled.status}`,
    );

    const afterCancel = await request('GET', `/consultations/${doomed.sessionId}`, {
      token: patientToken,
    });
    check(
      'J4b the appointment really is CANCELLED now',
      afterCancel.body?.appointment?.status === 'CANCELLED',
      `status=${afterCancel.body?.appointment?.status}`,
    );
    check(
      'J4c cancellation left the session at SCHEDULED (why this was reachable at all)',
      afterCancel.body?.state === 'SCHEDULED',
      `state=${afterCancel.body?.state}`,
    );

    const joinAfterCancel = await request('POST', `/consultations/${doomed.sessionId}/join`, {
      token: patientToken,
    });
    check(
      'J5  joining a CANCELLED appointment is REFUSED (409)  <- the fix',
      joinAfterCancel.status === 409,
      `got ${joinAfterCancel.status}`,
    );
    check(
      'J6  the refusal explains the cancellation',
      typeof joinAfterCancel.body?.message === 'string' &&
        /cancel/i.test(joinAfterCancel.body.message),
      joinAfterCancel.body?.message ?? 'no message',
    );

    const second = await request('POST', `/consultations/${doomed.sessionId}/join`, {
      token: patientToken,
    });
    check(
      'J7  a second join attempt is still refused (409) — not one-shot',
      second.status === 409,
      `got ${second.status}`,
    );

    const viewable = await request('GET', `/consultations/${doomed.sessionId}`, {
      token: patientToken,
    });
    check(
      'J8  the session stays VIEWABLE after cancellation (guard is not in the shared loader)',
      viewable.status === 200,
      `got ${viewable.status}`,
    );
    check(
      'J9  the session state is unchanged (still SCHEDULED)',
      viewable.body?.state === 'SCHEDULED',
      `state=${viewable.body?.state}`,
    );

    const doctorJoin = await request('POST', `/consultations/${doomed.sessionId}/join`, {
      token: doctorToken,
    });
    check(
      'J10 the DOCTOR is refused as well (the refusal is bilateral)',
      doctorJoin.status === 409,
      `got ${doctorJoin.status}`,
    );
  } finally {
    // --- Cleanup: remove exactly what this run created -----------------------
    // This block used to CANCEL the appointments and count a 409 as reclaimed,
    // on the premise that "the slot FK is free either way". The premise is wrong
    // for this route: the cancel returns 409 when it is REFUSED because the slot
    // is still consumed, and in any case a cancel leaves the appointment row (and
    // its session and notifications) behind. Measured: the old block printed
    // "reclaim 4/4" while the database gained 2 appointments, 2 sessions and 8
    // notifications. The reclaimer deletes rows by id and reports real outcomes.
    //
    // Slots are deleted outright rather than freed by cancelling, so no
    // appointment row survives to hold the FK. Only ids created above are known
    // to the reclaimer, so the doctor's pre-existing schedule is never touched.
  }

  console.log('\nCancelled-appointment join guard — evidence\n');
  console.log(results.join('\n'));
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await reclaim.run('success path');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('harness error:', err.message);
  process.exit(2);
});
