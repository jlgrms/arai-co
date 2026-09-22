// Sub-item 5 (Layer 5) — runtime verification of the NOTIFICATION BELL UI.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the
// REAL frontend at :5173 against the REAL backend at :3000 in headless Chrome.
// Verifies the bell's rendered states:
//   U1 bell trigger present for patient (aria-label="Notifications")
//   U2 opening the bell fetches /notifications/me and renders the caller's rows
//   U3 unread rows show the unread dot; header shows "N unread"
//   U4 clicking an unread row marks it read (optimistic) and the row flips
//   U5a doctor has a bell
//   U5b admin has NO bell (out of scope)
//   U7 the DOCTOR's OWN rows actually open and read correctly
//   U8 the doctor's rows name a patient and leak no raw ISO timestamp
//   U9 a doctor-initiated change reaches the doctor's own feed
//   U6 empty state: fresh user sees "You're all caught up."
//
// U5a previously asserted only that a bell ICON existed for a doctor, which
// proves nothing about whether the doctor's rows render or say anything useful —
// the doctor's bell was never opened by any harness. U7-U9 close that gap.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createReclaimer } from './lib/reclaim.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9226;
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

// Fixture reclamation (DEFERRED item 1). Measured before this change: a run that
// reported "reclaimed 2/2 slots" actually leaked 2 users, 2 appointments and 8
// notifications. Everything this run creates is now tracked and removed by id.
const reclaim = createReclaimer({ label: 'sub5-bell-ui' });

// Helper: snapshot a user's notification ids, so a booking's new rows can be
// identified afterwards. Notification has no Appointment FK (see
// scripts/lib/reclaim.mjs), so deleting the appointment does NOT remove them and
// they have to be tracked explicitly.
async function notificationIds(token) {
  const r = await fetch(`${API}/notifications/me`, { headers: { Authorization: `Bearer ${token}` } });
  const rows = (await r.json()) || [];
  return new Set(Array.isArray(rows) ? rows.map((n) => n.id) : []);
}
async function trackNewNotifications(token, beforeIds) {
  const after = await fetch(`${API}/notifications/me`, { headers: { Authorization: `Bearer ${token}` } });
  const rows = (await after.json()) || [];
  for (const n of Array.isArray(rows) ? rows : []) {
    if (!beforeIds.has(n.id)) reclaim.trackNotification(n.id);
  }
}

// Helper: create a slot + booking for a patient, tracking every id it creates.
// Returns the slot id. Used by both the patient-feed seeding and the doctor probe.
async function bookOnNewSlot({ doctorToken, patientToken, utcMonth, offsetBase }) {
  const mk = (m) => new Date(Date.UTC(utcMonth[0], utcMonth[1], utcMonth[2], 9, 0, 0, 0) + m * 60000).toISOString();
  const off = (Date.now() % 100000) + offsetBase;
  const slotRes = await fetch(`${API}/doctors/me/availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({ startTime: mk(off), endTime: mk(off + 30) }),
  });
  const slot = (await slotRes.json()).id;
  reclaim.trackSlot(slot);
  // Snapshot BOTH parties. A booking notifies the patient AND the doctor, and
  // both are seeded accounts here, so neither set cascades on user delete.
  const beforeP = await notificationIds(patientToken);
  const beforeD = await notificationIds(doctorToken);
  const bookRes = await fetch(`${API}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken}` },
    body: JSON.stringify({ availabilityId: slot }),
  });
  const booked = await bookRes.json();
  if (booked.id) reclaim.trackAppointment(booked.id);
  await trackNewNotifications(patientToken, beforeP);
  await trackNewNotifications(doctorToken, beforeD);
  return { slot, status: bookRes.status, booked };
}

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/chrome-sub5-bell', 'about:blank'],
  { stdio: 'ignore' },
);

async function cdpTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP target never appeared');
}

const ws = new WebSocket(await cdpTarget());
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const send = (method, params = {}) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
async function navigate(path, waitMs = 1800) { await send('Page.navigate', { url: `${BASE}${path}` }); await sleep(waitMs); }
const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()`;
// Radix menus open on pointerdown, not a synthetic .click(); drive real mouse events.
async function clickXY(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function clickSelectorCenter(sel) {
  const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!rect) throw new Error(`selector not found: ${sel}`);
  await clickXY(rect.x, rect.y);
}

async function loginAs(email, password) {
  await navigate('/');
  await evaluate('localStorage.clear()');
  await navigate('/login');
  await evaluate(setValue('#login-email', email));
  await evaluate(setValue('#login-password', password));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(2200);
  return await evaluate('location.pathname');
}

async function openBell() {
  await clickSelectorCenter('button[aria-label="Notifications"]');
  await sleep(1200);
}

const results = [];
async function step(name, fn) { try { results.push(`PASS  ${name}  ->  ${await fn()}`); } catch (e) { results.push(`FAIL  ${name}  ->  ${e.message}`); } }

await send('Page.enable'); await send('Runtime.enable');

// Seed a real notification for the patient so the list is non-empty. Everything
// this creates (slot, appointment, and the notification the booking generates) is
// tracked for removal.
{
  const pl = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'jordan.lee@example.com', password: 'PatientPass123!' }) })).json();
  const dl = (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dr.patel@example.com', password: 'DoctorPass123!' }) })).json());
  await bookOnNewSlot({
    doctorToken: dl.accessToken,
    patientToken: pl.accessToken,
    utcMonth: [2027, 5, 1],
    offsetBase: 80000,
  });
}

// U1: patient bell trigger present.
await step('U1 patient has a Notifications bell trigger', async () => {
  const landed = await loginAs('jordan.lee@example.com', 'PatientPass123!');
  const has = await evaluate(`!!document.querySelector('button[aria-label="Notifications"]')`);
  if (!has) throw new Error(`no bell trigger on ${landed}`);
  return `landed=${landed}, bell present`;
});

// U2/U3: open the bell, assert rows render + unread dot + header label.
await step('U2 open bell renders the caller\'s notification rows', async () => {
  await openBell();
  const rowCount = await evaluate(`document.querySelectorAll('[role="menu"] button[type="button"]').length`);
  if (rowCount < 1) throw new Error(`expected >=1 rendered row, got ${rowCount}`);
  const hasMessage = await evaluate(`Array.from(document.querySelectorAll('[role="menu"] button[type="button"]')).every(b => b.innerText.trim().length > 0)`);
  if (!hasMessage) throw new Error('a rendered row had no message text');
  return `${rowCount} rows rendered with message text`;
});

await step('U3 unread rows show a dot and header shows "N unread"', async () => {
  const unreadLabel = await evaluate(`(() => { const el = Array.from(document.querySelectorAll('[role="menu"] span')).find(s => /unread$/.test(s.textContent||'')); return el ? el.textContent.trim() : null; })()`);
  const dots = await evaluate(`document.querySelectorAll('[role="menu"] .bg-accent').length`);
  if (!unreadLabel) throw new Error('no "N unread" header label');
  if (dots < 1) throw new Error('no unread dot rendered');
  return `header="${unreadLabel}", unreadDots=${dots}`;
});

// U4: clicking an unread row marks it read (optimistic -> read styling).
await step('U4 clicking an unread row marks it read', async () => {
  const beforeDots = await evaluate(`document.querySelectorAll('[role="menu"] .bg-accent').length`);
  const rect = await evaluate(`(() => { const rows = Array.from(document.querySelectorAll('[role="menu"] button[type="button"]')); const unread = rows.find(b => b.querySelector('.bg-accent')); if (!unread) return null; const r = unread.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!rect) throw new Error('no unread row available to click');
  await clickXY(rect.x, rect.y);
  await sleep(900);
  const afterDots = await evaluate(`document.querySelectorAll('[role="menu"] .bg-accent').length`);
  if (!(afterDots < beforeDots)) throw new Error(`dot count did not decrease (before=${beforeDots}, after=${afterDots})`);
  return `unread dots ${beforeDots} -> ${afterDots}`;
});

// U5a: doctor has a bell.
await step('U5a doctor has a bell', async () => {
  const landed = await loginAs('dr.patel@example.com', 'DoctorPass123!');
  const has = await evaluate(`!!document.querySelector('button[aria-label="Notifications"]')`);
  if (!has) throw new Error(`no bell for doctor on ${landed}`);
  return `landed=${landed}, bell present`;
});

// U5a only proves the ICON exists. U7-U9 open the doctor's own bell and read the
// rows, using a notification created on demand so the assertion does not depend
// on whatever happens to be seeded.

// Deterministically give Dr. Patel a notification that names a specific patient,
// by booking a real appointment as that patient on one of the doctor's slots.
const DOC_EMAIL = 'dr.patel@example.com';
const UNIQUE_PATIENT = `Bell Doctor Probe ${Date.now()}`;
let probePatientEmail = null;
{
  const dl = (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: DOC_EMAIL, password: 'DoctorPass123!' }) })).json()).accessToken;
  const suffix = Date.now();
  probePatientEmail = `bell.doc.${suffix}@example.com`;
  const reg = await (await fetch(`${API}/auth/register/patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: probePatientEmail, password: 'Password123!', name: UNIQUE_PATIENT }) })).json();
  // The register response is FLAT — { accessToken, userId, role } — not
  // { user: { id } }. Reading the wrong field silently no-ops and leaks the
  // account while reporting clean.
  if (reg.userId) reclaim.trackUser(reg.userId, probePatientEmail);
  const pl = reg.accessToken;

  // A slot far in the future so it cannot collide with the layer harnesses.
  const { status, booked } = await bookOnNewSlot({
    doctorToken: dl,
    patientToken: pl,
    utcMonth: [2027, 7, 1],
    offsetBase: 400000,
  });
  if (status !== 201) throw new Error(`fixture booking failed ${status}: ${JSON.stringify(booked)}`);
}

// U7: the doctor's bell opens and shows rows.
await step('U7 the doctor\'s own bell opens and renders their rows', async () => {
  await loginAs(DOC_EMAIL, 'DoctorPass123!');
  await openBell();
  const rowCount = await evaluate(`document.querySelectorAll('[role="menu"] button[type="button"]').length`);
  if (rowCount < 1) throw new Error(`expected >=1 doctor notification row, got ${rowCount}`);
  const texts = await evaluate(`Array.from(document.querySelectorAll('[role="menu"] button[type="button"]')).map(b => b.innerText.trim()).filter(Boolean)`);
  if (texts.length !== rowCount) throw new Error('a doctor row rendered without message text');
  return `${rowCount} doctor rows rendered, all with text`;
});

// U8: the doctor's row names a patient and never leaks a machine timestamp.
// This is the regression the message-formatting fix addresses: rows previously
// read "... on 2026-09-23T09:00:00.000Z", which is a wire format, not a time.
//
// Scoped to THIS run's probe row, deliberately. Notifications are append-only
// (no edit/delete), so rows written before the fix still carry ISO strings and
// always will. Asserting "no ISO anywhere in the feed" would therefore be
// permanently red for a reason that is not a defect of the current build — it
// would describe history, not the code. What is assertable is that a row created
// NOW is well formed; the older rows are the reason the fix cannot be a
// migration and must be understood as forward-only.
//
// (Found the hard way: the first version of this check asserted over the whole
// feed and went red immediately after the negative test — correctly, but for the
// wrong reason.)
await step('U8 the doctor\'s new row names a patient and leaks no raw ISO timestamp', async () => {
  const texts = await evaluate(`Array.from(document.querySelectorAll('[role="menu"] button[type="button"]')).map(b => b.innerText.trim()).filter(Boolean)`);
  const mine = texts.find((t) => t.includes(UNIQUE_PATIENT));
  if (!mine) throw new Error(`doctor cannot see a notification naming their patient "${UNIQUE_PATIENT}"; got: ${JSON.stringify(texts.slice(0, 4))}`);

  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(mine)) {
    throw new Error(`the doctor's own new row shows a raw ISO timestamp: "${mine.slice(0, 140)}"`);
  }
  return `new row well formed, names patient: "${mine.slice(0, 90)}"`;
});

// U9: the doctor's row shows a readable time, not just "no ISO".
await step('U9 the doctor\'s row shows a human-readable time', async () => {
  const texts = await evaluate(`Array.from(document.querySelectorAll('[role="menu"] button[type="button"]')).map(b => b.innerText.trim()).filter(Boolean)`);
  const mine = texts.find((t) => t.includes(UNIQUE_PATIENT));
  if (!mine) throw new Error('probe row vanished between checks');
  // Expect "<day> <Mon> <year>, HH:MM UTC" as produced by the backend formatter.
  if (!/\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC/.test(mine)) {
    throw new Error(`no readable time in the doctor's row: "${mine.slice(0, 140)}"`);
  }
  return `readable time present in: "${mine.slice(0, 90)}"`;
});

// U5b: admin has NO bell (out of scope).
await step('U5b admin has NO bell (out of scope)', async () => {
  await loginAs('admin@example.com', 'AdminPass123!');
  const has = await evaluate(`!!document.querySelector('button[aria-label="Notifications"]')`);
  if (has) throw new Error('admin unexpectedly has a bell');
  return 'no bell for admin (as intended)';
});

// U6: empty state for a fresh user.
await step('U6 fresh user sees empty state ("You\'re all caught up.")', async () => {
  const suffix = Date.now();
  const email = `bell.ui.${suffix}@example.com`;
  const regRes = await fetch(`${API}/auth/register/patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'PatientPass123!', name: 'Bell UI', contactDetails: email }) });
  const reg = await regRes.json();
  if (reg.userId) reclaim.trackUser(reg.userId, email);
  await loginAs(email, 'PatientPass123!');
  await openBell();
  const text = await evaluate(`(() => { const el = Array.from(document.querySelectorAll('[role="menu"] p')).map(p => p.textContent||'').join(' | '); return el; })()`);
  if (!/all caught up/i.test(text)) throw new Error(`empty-state text not found (got: ${text})`);
  return `empty state rendered: "${text.trim()}"`;
});

console.log(results.join('\n'));

// Reclaim everything this run created. The reclaimer deletes by id and reports a
// per-item outcome, so this can no longer claim success while leaking — which is
// what the previous block did: it printed "reclaimed 2/2 slots" while two users,
// two appointments and eight notifications drifted the database.
await reclaim.run('success path');

const failedChecks = results.filter((r) => r.startsWith('FAIL')).length;
ws.close();
chrome.kill('SIGKILL');
process.exit(failedChecks ? 1 : 0);
