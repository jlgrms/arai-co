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

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9226;
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

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

// Slots created by this harness, reclaimed at the end. Each run used to leave one
// behind forever, which accreted ~15 stray future slots on Dr. Patel across a
// day of runs and drifted the DB away from its baseline. A harness that mutates
// shared state must put it back.
//
// The reclaim has to cancel the appointment FIRST: DELETE is gated on the slot
// having no live consumer (409 "This slot is booked by an appointment"). And the
// cancel must be made by the appointment's OWNER — the two fixtures book as
// different patients (jordan.lee and the throwaway probe account), so the owner
// is resolved from the row rather than assumed. Getting this wrong fails
// silently: the DELETE 409s and the slot survives, which is exactly how the
// drift went unnoticed the first time.
const createdSlots = [];
async function releaseSlot(doctorToken, slotId) {
  if (!slotId) return { deleted: false, reason: 'no slot id' };
  const appts = await (await fetch(`${API}/appointments/me`, { headers: { Authorization: `Bearer ${doctorToken}` } })).json();
  const onSlot = Array.isArray(appts) ? appts.find((a) => a.availabilityId === slotId) : null;

  if (onSlot) {
    // The doctor-side appointment projection carries patientProfile.name but not
    // the email, so map the name to the account that booked it. Only two accounts
    // can own a slot this harness created.
    const ownerEmail =
      onSlot.patientProfile?.name === 'Jordan Lee'
        ? 'jordan.lee@example.com'
        : probePatientEmail;
    const ownerPassword = ownerEmail === 'jordan.lee@example.com' ? 'PatientPass123!' : 'Password123!';
    if (ownerEmail) {
      const owner = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ownerEmail, password: ownerPassword }) })).json();
      if (owner.accessToken) {
        await fetch(`${API}/appointments/${onSlot.id}/cancel`, { method: 'PATCH', headers: { Authorization: `Bearer ${owner.accessToken}` } });
      }
    }
  }

  const del = await fetch(`${API}/doctors/me/availability/${slotId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${doctorToken}` } });
  return { deleted: del.ok, status: del.status, hadAppointment: Boolean(onSlot) };
}

await send('Page.enable'); await send('Runtime.enable');

// Seed a real notification for the patient so the list is non-empty.
{
  const pl = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'jordan.lee@example.com', password: 'PatientPass123!' }) })).json();
  const dl = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dr.patel@example.com', password: 'DoctorPass123!' }) })).json();
  const off = (Date.now() % 100000) + 80000;
  const mk = (m) => new Date(Date.UTC(2027, 5, 1, 9, 0, 0, 0) + m * 60000).toISOString();
  const slot = (await (await fetch(`${API}/doctors/me/availability`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dl.accessToken}` }, body: JSON.stringify({ startTime: mk(off), endTime: mk(off + 30) }) })).json()).id;
  await fetch(`${API}/appointments`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pl.accessToken}` }, body: JSON.stringify({ availabilityId: slot }) });
  createdSlots.push({ token: dl.accessToken, slotId: slot });
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
  const pl = (await (await fetch(`${API}/auth/register/patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: probePatientEmail, password: 'Password123!', name: UNIQUE_PATIENT }) })).json()).accessToken;

  // A slot far in the future so it cannot collide with the layer harnesses.
  const mk = (m) => new Date(Date.UTC(2027, 7, 1, 9, 0, 0, 0) + m * 60000).toISOString();
  const off = (Date.now() % 100000) + 400000;
  const slotRes = await fetch(`${API}/doctors/me/availability`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dl}` }, body: JSON.stringify({ startTime: mk(off), endTime: mk(off + 30) }) });
  const slot = (await slotRes.json()).id;
  const bookRes = await fetch(`${API}/appointments`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pl}` }, body: JSON.stringify({ availabilityId: slot }) });
  if (bookRes.status !== 201) throw new Error(`fixture booking failed ${bookRes.status}: ${JSON.stringify(await bookRes.json())}`);
  createdSlots.push({ token: dl, slotId: slot });
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
  await fetch(`${API}/auth/register/patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'PatientPass123!', name: 'Bell UI', contactDetails: email }) });
  await loginAs(email, 'PatientPass123!');
  await openBell();
  const text = await evaluate(`(() => { const el = Array.from(document.querySelectorAll('[role="menu"] p')).map(p => p.textContent||'').join(' | '); return el; })()`);
  if (!/all caught up/i.test(text)) throw new Error(`empty-state text not found (got: ${text})`);
  return `empty state rendered: "${text.trim()}"`;
});

console.log(results.join('\n'));

// Reclaim every slot this run created, so the harness is idempotent in its
// effect on the database. Reported per-slot rather than as an attempt count: an
// earlier version logged "reclaimed 2" while both DELETEs were 409ing, which
// looked like success and hid the leak.
let reclaimed = 0;
const reclaimFailures = [];
for (const { token, slotId } of createdSlots) {
  const outcome = await releaseSlot(token, slotId);
  if (outcome.deleted) reclaimed += 1;
  else reclaimFailures.push(`${slotId} -> HTTP ${outcome.status}${outcome.hadAppointment ? ' (had appointment)' : ''}`);
}
console.log(`\nreclaimed ${reclaimed}/${createdSlots.length} harness-created slot(s)`);
if (reclaimFailures.length) {
  console.log(`WARNING: ${reclaimFailures.length} slot(s) not reclaimed (DB will drift):`);
  for (const f of reclaimFailures) console.log(`  ${f}`);
}
const failedChecks = results.filter((r) => r.startsWith('FAIL')).length;
ws.close();
chrome.kill('SIGKILL');
process.exit(failedChecks ? 1 : 0);
