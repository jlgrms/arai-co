// Sub-item 5 (Layer 5) — runtime verification of the NOTIFICATION BELL UI.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the
// REAL frontend at :5173 against the REAL backend at :3000 in headless Chrome.
// Verifies the bell's rendered states:
//   U1 bell trigger present for patient (aria-label="Notifications")
//   U2 opening the bell fetches /notifications/me and renders the caller's rows
//   U3 unread rows show the unread dot; header shows "N unread"
//   U4 clicking an unread row marks it read (optimistic) and the row flips
//   U5 admin has NO bell (out of scope); doctor DOES have a bell
//   U6 empty state: fresh user sees "You're all caught up."
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

await send('Page.enable'); await send('Runtime.enable');

// Seed a real notification for the patient so the list is non-empty.
{
  const pl = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'jordan.lee@example.com', password: 'PatientPass123!' }) })).json();
  const dl = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dr.patel@example.com', password: 'DoctorPass123!' }) })).json();
  const off = (Date.now() % 100000) + 80000;
  const mk = (m) => new Date(Date.UTC(2027, 5, 1, 9, 0, 0, 0) + m * 60000).toISOString();
  const slot = (await (await fetch(`${API}/doctors/me/availability`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dl.accessToken}` }, body: JSON.stringify({ startTime: mk(off), endTime: mk(off + 30) }) })).json()).id;
  await fetch(`${API}/appointments`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pl.accessToken}` }, body: JSON.stringify({ availabilityId: slot }) });
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
ws.close();
chrome.kill('SIGKILL');
process.exit(0);
