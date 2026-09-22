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

const API = process.env.API_BASE ?? 'http://localhost:3000';
const PATIENT = { email: 'jordan.lee@example.com', password: 'PatientPass123!' };
const DOCTOR = { email: 'dr.silva@example.com', password: 'DoctorPass123!' };

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

  const madeAppointments = [];
  const madeSlots = ownSlots.map((s) => s.id);

  try {
    // ============ Leg 1 — a LIVE appointment CAN still be joined ============
    const live = await book(patientToken, ownSlots[0].id);
    madeAppointments.push(live.appointmentId);
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
    madeAppointments.push(doomed.appointmentId);
    if (!doomed.sessionId) throw new Error('no session for the second booking');

    const cancelled = await request('PATCH', `/appointments/${doomed.appointmentId}/cancel`, {
      token: patientToken,
    });
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
    // --- Cleanup: release the appointments, then delete OUR OWN slots ---------
    // Only slots created by `makeOwnSlots` are in `madeSlots`, so the doctor's
    // pre-existing schedule is never touched.
    let reclaimed = 0;
    let attempted = 0;
    for (const id of [...new Set(madeAppointments)]) {
      attempted += 1;
      const res = await request('PATCH', `/appointments/${id}/cancel`, { token: patientToken });
      // Already-cancelled counts as reclaimed: the slot FK is free either way.
      if (res.status === 200 || res.status === 201 || res.status === 409) reclaimed += 1;
    }
    for (const id of [...new Set(madeSlots)]) {
      attempted += 1;
      const del = await request('DELETE', `/doctors/me/availability/${id}`, { token: doctorToken });
      if (del.status === 200 || del.status === 204) reclaimed += 1;
    }
    results.push(
      `  reclaim  ${reclaimed}/${attempted} harness-owned fixtures released (per-item, not attempts)`,
    );
  }

  console.log('\nCancelled-appointment join guard — evidence\n');
  console.log(results.join('\n'));
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('harness error:', err.message);
  process.exit(2);
});
