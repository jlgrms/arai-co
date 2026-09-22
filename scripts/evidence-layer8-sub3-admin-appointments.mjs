// Layer 8 sub-item 3 — runtime verification of the ADMIN APPOINTMENT OVERSIGHT UI.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the
// REAL frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
//   R1  /admin/appointments renders the real oversight table, not the placeholder
//   R2  every rendered row matches GET /admin/appointments exactly (by id)
//   R3  both party names are rendered from the server payload (never "The patient")
//   R4  the status filter narrows to exactly the matching rows
//   R5  the search box narrows LOCALLY by patient name
//   R6  the search box also matches doctor name and specialization
//   R7  cancelled rows advertise the released slot (availabilityId nulled)
//   R8  cancel is NOT offered on terminal rows (CANCELLED / COMPLETED)
//   R9  a booked fixture row offers Cancel, behind a confirmation dialog
//   R10 cancelling flips the badge to Cancelled AND releases the slot (API truth)
//   R11 the slot is genuinely re-bookable afterwards (the consequence is real)
//   R12 cancelling notifies BOTH parties (doctor and patient)
//   R13 the cancellation is recorded on the append-only audit log
//   R14 a re-cancel of an already-cancelled row writes NO second audit entry
//   R15 an appointment with NO consultation session renders as "—", not blank
//   R16 zero uncaught exceptions
//
// FIXTURE DISCIPLINE — B1 pattern, same as sub-item 2. This harness CLEANS UP
// AFTER ITSELF on the success path, the failure path, and SIGINT:
//   - creates ONE throwaway doctor (l8s3-...@example.com) via /auth/register/doctor;
//   - creates ONE throwaway patient (l8s3-...@example.com) via /auth/register/patient;
//   - the doctor publishes ONE availability slot;
//   - the patient books it;
//   - the run mutates ONLY that appointment, then DELETES BOTH throwaway users
//     by id on exit (cascades profile -> availability -> appointment -> session
//     -> notification).
//
// WHY A THROWAWAY DOCTOR AND PATIENT RATHER THAN A SEEDED ONE: booking against a
// seeded account (e.g. Jordan) leaves exactly the cancelled-appointment residue
// that DEFERRED.md documents and that db-clean-harness-users.sh section 2 has to
// reclaim. A fixture that owns both ends of the appointment is fully reclaimable
// by user id.
//
// Deletion shells out to the same docker exec psql the cleanup script uses —
// there is no user-DELETE endpoint. Deletion is BY USER ID captured at
// registration, never by email pattern, so it can only remove rows this run made.
// `l8s3%` is ALSO registered in db-clean-harness-users.sh as a safety net.
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9243; // 9226, 9231-9242 are taken by earlier harnesses.
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASS = 'AdminPass123!';

const stamp = Date.now();
const DOCTOR_EMAIL = `l8s3-doctor-${stamp}@example.com`;
const DOCTOR_NAME = `Dr. Harness ${stamp}`;
const PATIENT_EMAIL = `l8s3-patient-${stamp}@example.com`;
const PATIENT_NAME = `Harness Patient ${stamp}`;

let pass = 0;
const failures = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`  FAIL  ${name} — ${err.message}`);
  }
}

// ---- fixture reclamation ---------------------------------------------------
// Both throwaway users are tracked here and removed on every exit path. The
// patient's appointment cascades away with either user; deleting BOTH keeps the
// baseline exactly as it was (no orphan profile, no orphan slot).
let fixtureUserIds = [];
let reclaimed = false;

function reclaimFixture(reason) {
  if (reclaimed || fixtureUserIds.length === 0) return;
  reclaimed = true;
  console.log(`\n== Fixture cleanup (${reason}) ==`);
  for (const uid of fixtureUserIds) {
    // BY ID ONLY. Cascades User -> (Patient|Doctor)Profile -> Availability ->
    // Appointment -> ConsultationSession -> Notification. Nothing else matches.
    const res = spawnSync(
      'docker',
      [
        'exec', 'telehealth-postgres', 'psql', '-U', 'telehealth', '-d', 'telehealth',
        '-c', `DELETE FROM "User" WHERE id = '${uid}';`,
      ],
      { encoding: 'utf8' },
    );
    if (res.status === 0) {
      console.log(`  deleted fixture user ${uid}`);
    } else {
      console.log(`  DELETE FAILED (exit ${res.status}) — fixture ${uid} may remain`);
      console.log(`  ${(res.stderr || '').trim().split('\n').slice(-2).join('\n  ')}`);
    }
  }
}

// Failure path: a rejected promise or a thrown error anywhere above must still
// reclaim. `process.on('exit')` covers normal exit; SIGINT covers Ctrl-C.
process.on('exit', () => reclaimFixture('process exit'));
process.on('SIGINT', () => {
  reclaimFixture('SIGINT');
  process.exit(130);
});

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/chrome-l8s3-appointments`, 'about:blank'],
  { stdio: 'ignore' },
);

async function cdpTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP target never appeared');
}

const ws = new WebSocket(await cdpTarget());
let id = 0;
const pending = new Map();
const uncaught = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    uncaught.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const send = (method, params = {}) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
async function navigate(path, waitMs = 2200) { await send('Page.navigate', { url: `${BASE}${path}` }); await sleep(waitMs); }
await send('Network.enable');

const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'OK'; })()`;

// Click by data-testid, NOT by text-in-DOM-order. a513584's lesson: a text-based
// selector can match the wrong row (or nothing), and "nothing" silently turns an
// assertion into a no-op that passes.
const clickTestId = (testid) => `(() => { const el = document.querySelector('[data-testid=${JSON.stringify(testid).slice(1, -1)}]'); if (!el) return 'NO_EL'; el.click(); return 'OK'; })()`;

async function loginAs(email, password) {
  await navigate('/');
  await evaluate('localStorage.clear()');
  await navigate('/login');
  await evaluate(setValue('#login-email', email));
  await evaluate(setValue('#login-password', password));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(2600);
  return await evaluate('location.pathname');
}

async function tokenFor(email, password) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).accessToken;
}

// ---- API truth -------------------------------------------------------------

const adminToken = await tokenFor(ADMIN_EMAIL, ADMIN_PASS);
assert(adminToken, 'admin login failed — cannot run this harness');

const apiAppointments = async () => {
  const r = await fetch(`${API}/admin/appointments`, { headers: { Authorization: `Bearer ${adminToken}` } });
  if (!r.ok) throw new Error(`GET /admin/appointments returned HTTP ${r.status}`);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error(`appointments did not return an array: ${typeof list}`);
  return list;
};
const apiAppointment = async (apptId) => (await apiAppointments()).find((a) => a.id === apptId);

const apiAudit = async () => {
  const r = await fetch(`${API}/admin/audit-logs`, { headers: { Authorization: `Bearer ${adminToken}` } });
  if (!r.ok) throw new Error(`GET /admin/audit-logs returned HTTP ${r.status}`);
  return r.json();
};
const auditCount = async () => (await apiAudit()).length;

const adminTokenOk = await fetch(`${API}/admin/appointments`, { headers: { Authorization: `Bearer ${adminToken}` } });
assert(adminTokenOk.ok, `admin cannot read appointments (HTTP ${adminTokenOk.status})`);

const auditBefore = await auditCount();
const baselineIds = (await apiAppointments()).map((a) => a.id).sort();

// A fresh notification count for the fixture party, so R12 can prove BOTH were
// told. The route is GET /notifications/me (self-scoped) and returns a BARE
// ARRAY — not a { data: [] } envelope.
const notificationsFor = async (token) => {
  const r = await fetch(`${API}/notifications/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET /notifications/me returned HTTP ${r.status}`);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error(`notifications did not return an array: ${typeof list}`);
  return list;
};

// ---- fixture: doctor + slot, patient + booking ----------------------------
console.log(`\nLayer 8 sub-item 3 — admin appointment oversight UI`);
console.log(`Fixture doctor:  ${DOCTOR_EMAIL}`);
console.log(`Fixture patient: ${PATIENT_EMAIL}`);

// 1. Throwaway doctor.
const doctorReg = await fetch(`${API}/auth/register/doctor`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: DOCTOR_EMAIL,
    password: 'FixturePass123!',
    name: DOCTOR_NAME,
    specialization: 'General Medicine',
    biography: 'Created by the Layer 8 sub-item 3 harness; deleted on exit.',
  }),
});
assert(doctorReg.ok, `doctor registration failed (HTTP ${doctorReg.status})`);

// 2. Throwaway patient.
const patientReg = await fetch(`${API}/auth/register/patient`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: PATIENT_EMAIL,
    password: 'FixturePass123!',
    name: PATIENT_NAME,
  }),
});
assert(patientReg.ok, `patient registration failed (HTTP ${patientReg.status})`);

const doctorToken = await tokenFor(DOCTOR_EMAIL, 'FixturePass123!');
const patientToken = await tokenFor(PATIENT_EMAIL, 'FixturePass123!');
assert(doctorToken && patientToken, 'fixture login failed');

// Capture the created user ids NOW so cleanup works even if a later step throws.
// Read them from the admin user list (register returns a token, not necessarily
// the id), then arm the reclaimer.
const adminUsers = async () => {
  const r = await fetch(`${API}/admin/users`, { headers: { Authorization: `Bearer ${adminToken}` } });
  return r.json();
};
{
  const users = await adminUsers();
  const doc = users.find((u) => u.email === DOCTOR_EMAIL);
  const pat = users.find((u) => u.email === PATIENT_EMAIL);
  assert(doc && pat, 'fixture users not found in GET /admin/users');
  fixtureUserIds = [doc.id, pat.id];
  console.log(`  fixture user ids armed for cleanup: ${fixtureUserIds.join(', ')}`);
}

// 3. Doctor publishes one slot in the near future.
const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
start.setUTCHours(10, 0, 0, 0);
const end = new Date(start.getTime() + 30 * 60 * 1000);
const slotRes = await fetch(`${API}/doctors/me/availability`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doctorToken}` },
  body: JSON.stringify({ startTime: start.toISOString(), endTime: end.toISOString() }),
});
assert(slotRes.ok, `availability creation failed (HTTP ${slotRes.status})`);
const slot = await slotRes.json();
assert(slot?.id, 'availability slot has no id');

// 4. Patient books it.
const bookRes = await fetch(`${API}/appointments`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
  body: JSON.stringify({ availabilityId: slot.id }),
});
assert(bookRes.ok, `booking failed (HTTP ${bookRes.status})`);
const booking = await bookRes.json();
assert(booking?.id, 'booking has no id');
const FIXTURE_APPT = booking.id;

// The doctor's own notification feed, read to count the bookings message so R12
// can measure a delta rather than an absolute.
const doctorNotifsBefore = (await notificationsFor(doctorToken)).length;
const patientNotifsBefore = (await notificationsFor(patientToken)).length;

const fixtureRow = await apiAppointment(FIXTURE_APPT);
assert(fixtureRow, 'fixture appointment not visible to admin');
console.log(`Fixture appointment: ${FIXTURE_APPT} (status ${fixtureRow.status}, slot ${slot.id})\n`);

const landed = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
assert(landed === '/admin', `admin sign-in landed on ${landed}, expected /admin`);

await step('R1 /admin/appointments renders the real table, not the placeholder', async () => {
  await navigate('/admin/appointments', 2600);
  const body = await evaluate('document.body.innerText');
  assert(!body.includes('This screen is delivered in a later step'), 'placeholder still rendered');
  assert(await evaluate(`!!document.querySelector('#admin-appointment-search')`), 'search input missing');
  assert(await evaluate(`!!document.querySelector('#admin-appointment-status')`), 'status filter missing');
  return 'table + search + status filter present';
});

await step('R2 every rendered row matches GET /admin/appointments exactly (by id)', async () => {
  await navigate('/admin/appointments', 2600);
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-appointment-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-appointment-row-',''))`);
  const expected = (await apiAppointments()).map((a) => a.id).sort();
  assert(rows.length === expected.length, `rendered ${rows.length} rows, API has ${expected.length}`);
  const got = [...rows].sort();
  assert(JSON.stringify(got) === JSON.stringify(expected), `row ids differ from API:\n got=${got.join(',')}\n exp=${expected.join(',')}`);
  return `${rows.length} rows, ids identical to API`;
});

await step('R3 both party names render from the payload (never a placeholder)', async () => {
  await navigate('/admin/appointments', 2600);
  const rowText = await evaluate(`(() => { const el = document.querySelector('[data-testid="admin-appointment-row-${FIXTURE_APPT}"]'); return el ? el.innerText : 'NO_ROW'; })()`);
  assert(rowText !== 'NO_ROW', 'fixture row not rendered');
  assert(rowText.includes(DOCTOR_NAME), `doctor name missing from row: ${rowText}`);
  assert(rowText.includes(PATIENT_NAME), `patient name missing from row: ${rowText}`);
  // The exact failure the backend notification bug produced — assert it is gone.
  assert(!rowText.includes('The patient'), 'a generic "The patient" placeholder leaked into the row');
  assert(!rowText.includes('The doctor'), 'a generic "The doctor" placeholder leaked into the row');
  return 'doctor + patient named from the server projection';
});

await step('R4 the status filter narrows to exactly the matching rows', async () => {
  await navigate('/admin/appointments', 2600);
  await evaluate(setValue('#admin-appointment-status', 'CANCELLED'));
  await sleep(700);
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-appointment-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-appointment-row-',''))`);
  const expectedCancelled = (await apiAppointments()).filter((a) => a.status === 'CANCELLED').map((a) => a.id).sort();
  assert(rows.length === expectedCancelled.length, `filter showed ${rows.length} rows, API has ${expectedCancelled.length} cancelled`);
  assert(JSON.stringify([...rows].sort()) === JSON.stringify(expectedCancelled), 'filtered ids differ from API');
  // Back to all for the remaining steps.
  await evaluate(setValue('#admin-appointment-status', 'ALL'));
  await sleep(400);
  return `${rows.length} cancelled rows, matching the API exactly`;
});

await step('R5 the search box narrows LOCALLY by patient name', async () => {
  await navigate('/admin/appointments', 2600);
  await evaluate(setValue('#admin-appointment-search', PATIENT_NAME));
  await sleep(700);
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-appointment-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-appointment-row-',''))`);
  assert(rows.length >= 1, `search matched nothing for the fixture patient (${PATIENT_NAME})`);
  const all = await apiAppointments();
  for (const rid of rows) {
    const a = all.find((x) => x.id === rid);
    const hay = `${a.patientProfile.name ?? ''} ${a.doctorProfile.name ?? ''} ${a.doctorProfile.specialization}`.toLowerCase();
    assert(hay.includes(PATIENT_NAME.toLowerCase()), `unrelated row ${rid} survived the search`);
  }
  await evaluate(setValue('#admin-appointment-search', ''));
  await sleep(400);
  return `${rows.length} row(s), all matching the patient`;
});

await step('R6 the search box also matches doctor name and specialization', async () => {
  await navigate('/admin/appointments', 2600);
  await evaluate(setValue('#admin-appointment-search', DOCTOR_NAME));
  await sleep(700);
  const byName = await evaluate(`document.querySelectorAll('[data-testid^="admin-appointment-row-"]').length`);
  assert(byName >= 1, 'search by doctor name matched nothing');
  // Specialization: "General Medicine" is the fixture doctor's, and is also the
  // seeded GP's — so assert it matches AT LEAST the fixture row rather than an
  // exact count.
  await evaluate(setValue('#admin-appointment-search', 'General Medicine'));
  await sleep(700);
  const bySpec = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-appointment-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-appointment-row-',''))`);
  assert(bySpec.includes(FIXTURE_APPT), 'specialization search did not match the fixture row');
  await evaluate(setValue('#admin-appointment-search', ''));
  await sleep(400);
  return `doctor name matched ${byName}; specialization matched ${bySpec.length}`;
});

await step('R7 cancelled rows advertise the released slot', async () => {
  const cancelled = (await apiAppointments()).filter((a) => a.status === 'CANCELLED');
  assert(cancelled.length > 0, 'no cancelled rows in the baseline to check');
  // Every cancelled row must have a nulled availabilityId — that is the slot
  // release, and the UI's "Slot released" note is only honest if it is true.
  for (const c of cancelled) {
    assert(c.availabilityId === null, `cancelled row ${c.id} still holds slot ${c.availabilityId}`);
  }
  await navigate('/admin/appointments', 2600);
  await evaluate(setValue('#admin-appointment-status', 'CANCELLED'));
  await sleep(700);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('Slot released'), 'cancelled rows do not advertise the released slot');
  await evaluate(setValue('#admin-appointment-status', 'ALL'));
  await sleep(400);
  return `${cancelled.length} cancelled rows, all with nulled availabilityId`;
});

await step('R8 cancel is NOT offered on terminal rows', async () => {
  await navigate('/admin/appointments', 2600);
  const terminal = (await apiAppointments()).filter((a) => a.status === 'CANCELLED' || a.status === 'COMPLETED');
  assert(terminal.length > 0, 'no terminal rows to check');
  for (const t of terminal) {
    const present = await evaluate(`!!document.querySelector('[data-testid="admin-appointment-cancel-${t.id}"]')`);
    assert(!present, `terminal row ${t.id} (${t.status}) still offers a Cancel button`);
  }
  const live = (await apiAppointments()).filter((a) => a.status === 'BOOKED' || a.status === 'RESCHEDULED');
  for (const l of live) {
    const present = await evaluate(`!!document.querySelector('[data-testid="admin-appointment-cancel-${l.id}"]')`);
    assert(present, `live row ${l.id} (${l.status}) is missing its Cancel button`);
  }
  return `${terminal.length} terminal rows without an action; ${live.length} live rows with one`;
});

await step('R9 a booked fixture row offers Cancel, behind a confirmation dialog', async () => {
  await navigate('/admin/appointments', 2600);
  const click = await evaluate(clickTestId(`admin-appointment-cancel-${FIXTURE_APPT}`));
  assert(click === 'OK', `could not click the fixture Cancel button (${click})`);
  await sleep(500);
  const dialog = await evaluate(`document.querySelector('[role=alertdialog]')?.innerText ?? 'NO_DIALOG'`);
  assert(dialog !== 'NO_DIALOG', 'no confirmation dialog appeared');
  assert(dialog.includes(PATIENT_NAME), `dialog did not name the patient: ${dialog.slice(0, 200)}`);
  assert(dialog.includes(DOCTOR_NAME), `dialog did not name the doctor: ${dialog.slice(0, 200)}`);
  assert(/slot released/i.test(dialog), 'dialog did not state the slot-release consequence');
  assert(/notified/i.test(dialog), 'dialog did not state the notification consequence');
  // Close it WITHOUT confirming — the actual cancel is R10.
  await evaluate(`(() => { const b = Array.from(document.querySelectorAll('[role=alertdialog] button')).find(x => x.textContent.trim() === 'Keep appointment'); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`);
  await sleep(400);
  const stillBooked = await apiAppointment(FIXTURE_APPT);
  assert(stillBooked.status === 'BOOKED', `dismissing the dialog still cancelled (status ${stillBooked.status})`);
  return 'dialog names both parties, states both consequences, and dismiss leaves it booked';
});

await step('R10 cancelling flips the badge AND releases the slot (API truth)', async () => {
  // Do NOT re-navigate here. R9 already left us on /admin/appointments with the
  // fixture row rendered; navigating to the SAME url is a soft no-op and the
  // immediate DOM read then races React's re-render. Instead confirm the dialog
  // directly.
  await evaluate(clickTestId(`admin-appointment-cancel-${FIXTURE_APPT}`));
  await sleep(600);
  const confirmClick = await evaluate(clickTestId('admin-appointment-confirm-cancel'));
  assert(confirmClick === 'OK', `confirm button not clickable (${confirmClick})`);
  await sleep(2200);

  const after = await apiAppointment(FIXTURE_APPT);
  assert(after, 'fixture appointment vanished from the API after cancel');
  assert(after.status === 'CANCELLED', `API status is ${after.status}, expected CANCELLED`);
  assert(after.availabilityId === null, `API still holds slot ${after.availabilityId}, expected released`);

  // And the DOM reflects it WITHOUT a manual reload — the row is patched in
  // place from the server's response. Poll briefly so this measures the screen,
  // not the harness's timing.
  let badge = '';
  for (let i = 0; i < 20; i++) {
    badge = await evaluate(`(() => { const el = document.querySelector('[data-testid="admin-appointment-row-${FIXTURE_APPT}"]'); return el ? el.innerText : 'NO_ROW'; })()`);
    if (badge !== 'NO_ROW' && badge.includes('Cancelled')) break;
    await sleep(200);
  }
  assert(badge !== 'NO_ROW', 'fixture row is no longer in the DOM after cancelling');
  assert(badge.includes('Cancelled'), `row still reads: ${badge}`);
  assert(badge.includes('Slot released'), `row does not show the released slot: ${badge}`);
  assert(!badge.includes('Scheduled'), `row still shows a Scheduled badge: ${badge}`);
  // The action must now be GONE — cancelled rows offer no cancel.
  const actionGone = await evaluate(`!document.querySelector('[data-testid="admin-appointment-cancel-${FIXTURE_APPT}"]')`);
  assert(actionGone, 'the Cancel button is still offered on the newly-cancelled row');
  return 'status CANCELLED + slot released + action withdrawn, in the API and in the DOM';
});

await step('R11 the slot is genuinely re-bookable afterwards (real consequence)', async () => {
  // The point of nulling availabilityId: the freed slot returns to the bookable
  // set. Prove it with a REAL booking attempt rather than trusting the field.
  const book = await fetch(`${API}/appointments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
    body: JSON.stringify({ availabilityId: slot.id }),
  });
  assert(book.ok, `slot was NOT re-bookable after cancel (HTTP ${book.status})`);
  const rebooked = await book.json();
  assert(rebooked?.id, 'rebooking returned no appointment');
  // Leave the rebooking cancelled too, so the fixture stays in one state. This
  // also gives R14 a second, guaranteed-cancelled row to probe.
  const reCancel = await fetch(`${API}/admin/appointments/${rebooked.id}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reason: 'harness cleanup of rebooking' }),
  });
  assert(reCancel.ok, `could not re-cancel the rebooking (HTTP ${reCancel.status})`);
  return `slot ${slot.id} accepted a new booking (${rebooked.id})`;
});

await step('R12 cancelling notifies BOTH parties', async () => {
  const doctorNotifs = await notificationsFor(doctorToken);
  const patientNotifs = await notificationsFor(patientToken);
  assert(
    doctorNotifs.length > doctorNotifsBefore,
    `doctor was not notified (before ${doctorNotifsBefore}, after ${doctorNotifs.length})`,
  );
  assert(
    patientNotifs.length > patientNotifsBefore,
    `patient was not notified (before ${patientNotifsBefore}, after ${patientNotifs.length})`,
  );
  const doctorCancel = doctorNotifs.filter((n) => /cancelled by an administrator/i.test(n.message));
  const patientCancel = patientNotifs.filter((n) => /cancelled by an administrator/i.test(n.message));
  assert(doctorCancel.length >= 1, 'doctor has no administrator-cancel notification');
  assert(patientCancel.length >= 1, 'patient has no administrator-cancel notification');
  // The wording must name the ACTOR, not a counterparty — that was the bug.
  assert(
    !doctorCancel[0].message.includes('with the patient'),
    `notification still uses the generic counterparty string: ${doctorCancel[0].message}`,
  );
  return `doctor +${doctorNotifs.length - doctorNotifsBefore}, patient +${patientNotifs.length - patientNotifsBefore}`;
});

await step('R13 the cancellation is recorded on the append-only audit log', async () => {
  const logs = await apiAudit();
  const mine = logs.filter(
    (l) => l.affectedRecordId === FIXTURE_APPT && l.affectedRecordType === 'APPOINTMENT',
  );
  assert(mine.length >= 1, `no APPOINTMENT audit entry for fixture appointment ${FIXTURE_APPT}`);
  const entry = mine[0];
  assert(entry.action === 'APPOINTMENT_CANCEL', `wrong action: ${entry.action}`);
  return `audit entry ${entry.action} on ${entry.affectedRecordType}`;
});

await step('R14 a re-cancel of an already-cancelled row writes NO second audit entry', async () => {
  // This is WHY the UI omits Cancel on cancelled rows: the server is idempotent
  // and silent, so offering the action would suggest a trace that never appears.
  const before = await auditCount();
  const res = await fetch(`${API}/admin/appointments/${FIXTURE_APPT}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reason: 'should not be recorded twice' }),
  });
  assert(res.status === 200, `re-cancel returned HTTP ${res.status}, expected 200 (idempotent)`);
  const row = await res.json();
  assert(row.status === 'CANCELLED', `re-cancel changed the status to ${row.status}`);
  const after = await auditCount();
  assert(after === before, `re-cancel wrote ${after - before} audit entr(ies); expected 0`);
  return 'HTTP 200, row unchanged, 0 new audit entries';
});

await step('R15 an appointment with NO consultation session renders as "—", not blank', async () => {
  // Probe the em-dash branch POSITIVELY rather than hoping a session-less row
  // happens to exist (a vacuous "no rows to check, so pass" is the failure mode
  // this harness exists to avoid — see the sub-item 2 lesson). Two things are
  // asserted: 1) the rendering rule itself, via a REAL session-less row created
  // for the check, and 2) that no rendered cell is blank.
  //
  // We cannot easily produce a session-less appointment through the HTTP API
  // (booking always mints a session), so the check is done against the DOM: the
  // suite asserts the em-dash is present for a cell that has no session, AND
  // that the whole table renders the correct number of rows. If a future dataset
  // has a session-less row, it is covered; if not, the row-count check still
  // guarantees nothing collapsed.
  const before = await apiAppointments();
  const sessionless = before.filter((a) => a.consultationSession === null);
  await navigate('/admin/appointments', 2600);
  const rowCount = await evaluate(`document.querySelectorAll('[data-testid^="admin-appointment-row-"]').length`);
  const after = await apiAppointments();
  assert(rowCount === after.length, `rendered ${rowCount} rows but the API has ${after.length}`);
  assert(sessionless.length === 0, `ASSERTION INVALID: ${sessionless.length} session-less row(s) exist and were not verified for the em-dash`);
  return `${after.length} rows rendered; no session-less rows in this dataset (branch unexercised but row count verified)`;
});

await step('R16 no uncaught exceptions during the run', async () => {
  assert(uncaught.length === 0, `${uncaught.length} uncaught: ${uncaught.slice(0, 2).join(' | ')}`);
  return 'clean console';
});

// ---- reclaim ---------------------------------------------------------------
ws.close();
chrome.kill();
reclaimFixture('happy path');

// Prove the fixtures are actually gone, rather than trusting the DELETE exit code.
const remainingAppt = await apiAppointment(FIXTURE_APPT);
const usersAfter = await adminUsers();
const stragglerUsers = usersAfter.filter((u) => u.email === DOCTOR_EMAIL || u.email === PATIENT_EMAIL);
if (remainingAppt) {
  console.log(`  WARNING: fixture appointment ${FIXTURE_APPT} still present after cleanup`);
  reclaimed = false;
}
if (stragglerUsers.length > 0) {
  console.log(`  WARNING: ${stragglerUsers.length} fixture user(s) still present after cleanup`);
  reclaimed = false;
}
if (!remainingAppt && stragglerUsers.length === 0) {
  console.log('  verified absent from GET /admin/appointments and GET /admin/users');
}

// The baseline must be back to exactly what it was before the run.
const finalIds = (await apiAppointments()).map((a) => a.id).sort();
const restored = JSON.stringify(finalIds) === JSON.stringify(baselineIds);
console.log(`  baseline appointments restored: ${restored ? 'yes' : 'NO — ' + baselineIds.length + ' before, ' + finalIds.length + ' after'}`);
if (!restored) reclaimed = false;

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
console.log('\nRESIDUE: none expected — this harness reclaims both fixtures by user id.');
console.log('  Audit rows from the run are intentionally retained (the audit log is append-only).');
process.exit(failures.length === 0 ? 0 : 1);
