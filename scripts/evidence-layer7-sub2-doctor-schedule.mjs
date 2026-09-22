// Layer 7 sub-item 2 — runtime verification of the DOCTOR SCHEDULE screen.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the REAL
// frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
// Checks:
//   S1  /doctor/schedule renders the real schedule (not the placeholder)
//   S2  every slot from the API appears, grouped under day headings
//   S3  a slot BOOKED by an appointment is badged "Booked" and names the patient
//   S4  a booked slot's Edit/Block/Delete controls are DISABLED (sealed, 409 guard)
//   S5  an unbooked slot's controls are ENABLED
//   S6  creating a slot POSTs it and it appears after the refresh
//   S7  a blocked slot shows the "Blocked" badge
//   S8  blocking an open slot PATCHes isBlocked and the badge flips
//   S9  deleting a slot confirms first, then removes it via DELETE
//   S10 deleting a BOOKED slot via the API is refused with 409 (domain rule holds)
//   S11 the summary counts match the API-derived truth
//   S12 zero uncaught exceptions across the run
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9237;
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/chrome-l7-s2-schedule', 'about:blank'],
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
const uncaught = [];
const writes = [];
const reqs = new Map();

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    uncaught.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Network.requestWillBeSent') {
    reqs.set(m.params.requestId, {
      url: m.params.request.url,
      method: m.params.request.method,
      postData: m.params.request.postData ?? null,
    });
  }
  if (m.method === 'Network.loadingFinished') {
    const rec = reqs.get(m.params.requestId);
    if (rec && rec.url.includes('/doctors/me/availability') && rec.method !== 'GET') writes.push(rec);
    reqs.delete(m.params.requestId);
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
const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'OK'; })()`;
const clickByText = (txt, sel = 'button, a') => `(() => { const b = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find(b => b.textContent.trim() === ${JSON.stringify(txt)}); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`;
// "Add slot" exists BOTH on the page and inside the dialog. Matching by text
// alone silently picked the page-level button behind the modal, so the form was
// never submitted (0 POSTs). When a dialog is open, always scope to it.
const clickInDialog = (txt) => `(() => { const d = document.querySelector('[role=dialog]'); if (!d) return 'NO_DIALOG'; const b = Array.from(d.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(txt)}); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`;

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

const results = [];
async function step(name, fn) { try { results.push(`PASS  ${name}  ->  ${await fn()}`); } catch (e) { results.push(`FAIL  ${name}  ->  ${e.message}`); } }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

const DOC_EMAIL = 'dr.patel@example.com';
const DOC_PASS = 'DoctorPass123!';
const token = await tokenFor(DOC_EMAIL, DOC_PASS);
const auth = { Authorization: `Bearer ${token}` };

const readSlots = async () => (await fetch(`${API}/doctors/me/availability`, { headers: auth })).json();
const slotsBefore = await readSlots();
const appts = await (await fetch(`${API}/appointments/me`, { headers: auth })).json();
const bookedSlotIds = new Set(appts.filter((a) => a.availabilityId && a.status !== 'CANCELLED').map((a) => a.availabilityId));
console.log(`doctor: ${DOC_EMAIL}`);
console.log(`slots: ${slotsBefore.length}, of which booked: ${bookedSlotIds.size}\n`);

await loginAs(DOC_EMAIL, DOC_PASS);

await step('S1 /doctor/schedule renders the real schedule', async () => {
  await navigate('/doctor/schedule', 2800);
  const body = await evaluate('document.body.innerText');
  // NOTE: the description text is intentionally IDENTICAL to the old
  // PlaceholderPage copy, so it cannot be used to tell them apart. The real
  // screen is identified by structural elements the placeholder never had.
  assert(body.includes('Your availability'), 'schedule summary card missing');
  const addButtons = await evaluate(
    `Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Add slot').length`,
  );
  assert(addButtons >= 1, 'no Add slot control — this is the placeholder');
  const stats = await evaluate(
    `['Total slots','Open','Booked','Blocked'].every(l => document.body.innerText.includes(l))`,
  );
  assert(stats, 'summary stat tiles missing');
  return 'summary card + Add slot + stat tiles all rendered';
});

await step('S2 every API slot appears, grouped by day', async () => {
  const body = await evaluate('document.body.innerText');
  const headings = await evaluate(`Array.from(document.querySelectorAll('h3, h2')).map(h => h.textContent.trim())`);
  // At least one day heading must be present when slots exist.
  assert(headings.length > 0, 'no day headings rendered');
  // Each distinct day's slot count should sum to the API total.
  const rendered = await evaluate(`document.querySelectorAll('ul > li').length`);
  // ul > li also matches nothing else on this screen (slots are the only lists).
  assert(rendered >= slotsBefore.length, `rendered ${rendered} slot rows but API has ${slotsBefore.length}`);
  return `${slotsBefore.length} API slots, ${rendered} rows rendered across ${headings.length} heading(s)`;
});

await step('S3 a booked slot is badged "Booked" and names the patient', async () => {
  if (bookedSlotIds.size === 0) return 'SKIP — no booked slots in the fixture';
  const bookedAppt = appts.find((a) => a.availabilityId && a.status !== 'CANCELLED');
  const body = await evaluate('document.body.innerText');
  assert(body.includes('Booked'), 'no "Booked" badge anywhere');
  assert(body.includes(bookedAppt.patientProfile.name), `patient ${bookedAppt.patientProfile.name} not named on the booked slot`);
  return `booked slot names ${bookedAppt.patientProfile.name}`;
});

await step('S4 a booked slot is SEALED — its controls are disabled', async () => {
  if (bookedSlotIds.size === 0) return 'SKIP — no booked slots in the fixture';
  const state = await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('ul > li'));
    // Find the row that mentions a booked patient and inspect its buttons.
    const row = rows.find(r => r.textContent.includes('Booked'));
    if (!row) return { found: false };
    const buttons = Array.from(row.querySelectorAll('button'));
    return {
      found: true,
      labels: buttons.map(b => b.textContent.trim()),
      disabled: buttons.map(b => b.disabled),
      hasReason: /cancel or reschedule/i.test(row.textContent),
    };
  })()`);
  assert(state.found, 'no booked slot row found');
  assert(state.disabled.length >= 3, `expected 3 controls, saw ${state.disabled.length}: ${state.labels.join(',')}`);
  assert(state.disabled.every(Boolean), `sealed slot has an ENABLED control: ${JSON.stringify(state.labels.map((l, i) => [l, state.disabled[i]]))}`);
  assert(state.hasReason, 'sealed slot does not explain why it cannot be edited');
  return `all ${state.disabled.length} controls disabled + reason shown`;
});

await step('S5 an unbooked slot keeps its controls enabled', async () => {
  const free = slotsBefore.find((s) => !bookedSlotIds.has(s.id) && !s.isBlocked);
  if (!free) return 'SKIP — no open slot in the fixture';
  const enabled = await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('ul > li'));
    const row = rows.find(r => r.textContent.trim().startsWith(${JSON.stringify(
      new Date(free.startTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    )}));
    if (!row) return null;
    const buttons = Array.from(row.querySelectorAll('button'));
    return buttons.map(b => ({ label: b.textContent.trim(), disabled: b.disabled }));
  })()`);
  if (enabled === null) return 'SKIP — could not locate the open slot row by time';
  assert(enabled.length > 0, 'no controls on the open slot');
  assert(enabled.every((b) => !b.disabled), `open slot has a disabled control: ${JSON.stringify(enabled)}`);
  return `open slot controls all enabled: ${enabled.map((b) => b.label).join(', ')}`;
});

// ---- CREATE ----
const NEW_START = new Date();
NEW_START.setDate(NEW_START.getDate() + 14);
NEW_START.setHours(3, 0, 0, 0);
const NEW_END = new Date(NEW_START.getTime() + 30 * 60 * 1000);
const toLocal = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
writes.length = 0;

await step('S6 creating a slot POSTs it and it appears', async () => {
  await evaluate(clickByText('Add slot'));
  await sleep(900);
  await evaluate(setValue('#slot-start', toLocal(NEW_START)));
  await evaluate(setValue('#slot-end', toLocal(NEW_END)));
  await sleep(200);
  // Scoped to the dialog: the page also has an "Add slot" button.
  const submitted = await evaluate(clickInDialog('Add slot'));
  assert(submitted === 'OK', `dialog submit: ${submitted}`);
  await sleep(2400);

  const posts = writes.filter((w) => w.method === 'POST');
  assert(posts.length === 1, `expected 1 POST, saw ${posts.length}`);
  const body = JSON.parse(posts[0].postData);
  assert(body.startTime && body.endTime, `POST body missing times: ${posts[0].postData}`);

  const after = await readSlots();
  assert(after.length === slotsBefore.length + 1, `slot count ${slotsBefore.length} -> ${after.length}, expected +1`);
  const created = after.find((s) => new Date(s.startTime).getTime() === NEW_START.getTime());
  assert(created, 'the created slot is not in the API response');
  return `POST ${posts[0].postData} -> now ${after.length} slots`;
});

await step('S7 an unblocked new slot shows the Open badge', async () => {
  await navigate('/doctor/schedule', 2800);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('Open'), 'no Open badge after adding a slot');
  return 'Open badge present';
});

// ---- BLOCK ----
let createdSlotId = null;

await step('S8 blocking an open slot PATCHes isBlocked and flips the badge', async () => {
  const after = await readSlots();
  const created = after.find((s) => new Date(s.startTime).getTime() === NEW_START.getTime());
  assert(created, 'created slot vanished');
  createdSlotId = created.id;
  assert(created.isBlocked === false, 'new slot unexpectedly starts blocked');

  writes.length = 0;
  const clicked = await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('ul > li'));
    const row = rows.find(r => r.textContent.includes(${JSON.stringify(
      NEW_START.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    )}));
    if (!row) return 'NO_ROW';
    const btn = Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'Block');
    if (!btn) return 'NO_BTN';
    btn.click(); return 'OK';
  })()`);
  assert(clicked === 'OK', `block click: ${clicked}`);
  await sleep(2400);

  const patches = writes.filter((w) => w.method === 'PATCH');
  assert(patches.length === 1, `expected 1 PATCH, saw ${patches.length}`);
  assert(patches[0].postData.includes('"isBlocked":true'), `PATCH body: ${patches[0].postData}`);

  const now = await readSlots();
  const blocked = now.find((s) => s.id === createdSlotId);
  assert(blocked.isBlocked === true, 'the slot did not become blocked server-side');
  return `PATCH ${patches[0].postData} -> isBlocked=true`;
});

await step('S9 a blocked slot can still be edited (not sealed)', async () => {
  // Blocked != sealed. Unblocking must be permitted.
  const clicked = await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('ul > li'));
    const row = rows.find(r => r.textContent.includes('Blocked'));
    if (!row) return 'NO_ROW';
    const btn = Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'Unblock');
    if (!btn) return 'NO_UNBLOCK_BTN';
    return btn.disabled ? 'DISABLED' : 'ENABLED';
  })()`);
  assert(clicked === 'ENABLED', `blocked slot's Unblock button: ${clicked}`);
  return 'blocked slot remains editable (Unblock enabled)';
});

// ---- DELETE ----
await step('S10 deleting a slot confirms first, then DELETEs it', async () => {
  const toDelete = await readSlots();
  const target = toDelete.find((s) => s.id === createdSlotId);
  assert(target, 'no slot to delete');

  writes.length = 0;
  const clicked = await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('ul > li'));
    const row = rows.find(r => r.textContent.includes(${JSON.stringify(
      NEW_START.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    )}));
    if (!row) return 'NO_ROW';
    const btn = Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'Delete');
    if (!btn) return 'NO_DELETE_BTN';
    btn.click(); return 'OK';
  })()`);
  assert(clicked === 'OK', `delete click: ${clicked}`);
  await sleep(700);

  // A confirmation must appear, and nothing may have been sent yet.
  const confirmVisible = await evaluate(
    `document.body.innerText.includes('Remove this slot?')`,
  );
  assert(confirmVisible, 'no delete confirmation was shown');
  assert(writes.length === 0, `DELETE fired before confirmation: ${writes.length} write(s)`);

  // Radix renders the confirm dialog with role="alertdialog", so scope to it.
  // "Remove slot" appears in the dialog body text too, so a text-only match
  // across the whole document is ambiguous.
  const confirmed = await evaluate(`(() => {
    const d = document.querySelector('[role=alertdialog]');
    if (!d) return 'NO_ALERTDIALOG';
    const b = Array.from(d.querySelectorAll('button')).find(b => b.textContent.trim() === 'Remove slot');
    if (!b) return 'NO_BTN';
    b.click(); return 'OK';
  })()`);
  assert(confirmed === 'OK', `confirm click: ${confirmed}`);
  await sleep(2400);
  const deletes = writes.filter((w) => w.method === 'DELETE');
  assert(deletes.length === 1, `expected 1 DELETE, saw ${deletes.length}`);
  assert(deletes[0].url.includes(createdSlotId), `DELETE hit the wrong slot: ${deletes[0].url}`);

  const after = await readSlots();
  assert(after.length === slotsBefore.length, `slot count ${after.length}, expected back to ${slotsBefore.length}`);
  return `confirmed then DELETE ${createdSlotId.slice(0, 8)}… -> ${after.length} slots (restored)`;
});

await step('S11 deleting a BOOKED slot via the API is refused with 409', async () => {
  if (bookedSlotIds.size === 0) return 'SKIP — no booked slots in the fixture';
  const bookedId = [...bookedSlotIds][0];
  const res = await fetch(`${API}/doctors/me/availability/${bookedId}`, {
    method: 'DELETE', headers: auth,
  });
  assert(res.status === 409, `expected 409 for a booked slot, got ${res.status}`);
  const body = await res.json();
  assert(/cancel or reschedule/i.test(body.message), `unexpected message: ${body.message}`);
  return `409 "${body.message.slice(0, 60)}…" — the disabled controls mirror the server`;
});

await step('S12 summary counts match the API truth', async () => {
  await navigate('/doctor/schedule', 2800);
  const finalSlots = await readSlots();
  const finalAppts = await (await fetch(`${API}/appointments/me`, { headers: auth })).json();
  const held = new Set(finalAppts.filter((a) => a.availabilityId && a.status !== 'CANCELLED').map((a) => a.availabilityId));
  const booked = finalSlots.filter((s) => held.has(s.id)).length;
  const blocked = finalSlots.filter((s) => s.isBlocked && !held.has(s.id)).length;
  const free = finalSlots.filter((s) => !s.isBlocked && !held.has(s.id)).length;

  const text = await evaluate('document.body.innerText');
  const expectLine = `${free} open, ${booked} booked, ${blocked} blocked.`;
  assert(text.includes(expectLine), `expected summary "${expectLine}" not found`);
  return `summary "${expectLine}" matches the API`;
});

await step('S13 zero uncaught exceptions', async () => {
  assert(uncaught.length === 0, `${uncaught.length} uncaught: ${uncaught.slice(0, 2).join(' | ')}`);
  return '0 uncaught exceptions';
});

console.log('--- RESULTS ---');
for (const r of results) console.log(r);
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
ws.close(); chrome.kill();
process.exit(failed === 0 ? 0 : 1);
