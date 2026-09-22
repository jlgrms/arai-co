// Layer 6 sub-item 6 — runtime verification of the MEDICAL RECORDS view.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the REAL
// frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
// Checks:
//   M1  /patient/records renders the real seeded history for Jordan Lee
//   M2  every seeded consultation appears (count matches the API)
//   M3  notes render (findings + recommendations) matching the API text
//   M4  prescriptions render matching the API text
//   M5  the year grouping heading is present
//   M6  a record's "View full consultation" link opens that exact session
//   M7  A patient with NO completed consultations gets the empty state (Alex Kim)
//   M8  the empty state is an explained normal case, not an error
//   M9  the empty patient's page contains no other patient's data (no leak)
//   M10 the client never requests records with a patient id (scoping is server-side)
//   M11 no doctor name from Jordan's history appears on the empty page
//   M12 zero uncaught exceptions across both sessions
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9235;
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/chrome-sub6-records', 'about:blank'],
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
// Every URL the page requests, so we can prove the records call carries no id.
const requestedUrls = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    uncaught.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Network.requestWillBeSent') {
    requestedUrls.push(m.params.request.url);
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

async function loginAs(email, password) {
  await navigate('/');
  await evaluate('localStorage.clear()');
  await navigate('/login');
  await evaluate(setValue('#login-email', email));
  await evaluate(setValue('#login-password', password));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(2500);
  return await evaluate('location.pathname');
}

const results = [];
async function step(name, fn) { try { results.push(`PASS  ${name}  ->  ${await fn()}`); } catch (e) { results.push(`FAIL  ${name}  ->  ${e.message}`); } }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

async function tokenFor(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'PatientPass123!' }),
  });
  return (await r.json()).accessToken;
}

// ---------------------------------------------------------------- populated
const jordanToken = await tokenFor('jordan.lee@example.com');
const jordanRecords = await (await fetch(`${API}/consultations/records/me`, { headers: { Authorization: `Bearer ${jordanToken}` } })).json();
assert(Array.isArray(jordanRecords) && jordanRecords.length > 0, 'Jordan has no seeded records — seed not applied?');
console.log(`jordan: ${jordanRecords.length} records, ${jordanRecords.reduce((n, r) => n + r.notes.length + r.prescriptions.length, 0)} entries`);

await loginAs('jordan.lee@example.com', 'PatientPass123!');

await step('M1 /patient/records renders the seeded history', async () => {
  await navigate('/patient/records', 2600);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('Medical records'), 'page heading missing');
  assert(!body.includes('No records yet'), 'showed the empty state despite having records');
  const first = jordanRecords[0];
  assert(body.includes(first.doctorName), `first record's doctor (${first.doctorName}) not shown`);
  return `rendered; first entry by ${first.doctorName}`;
});

await step('M2 every seeded consultation appears', async () => {
  const body = await evaluate('document.body.innerText');
  for (const r of jordanRecords) {
    assert(body.includes(r.doctorName), `missing consultation with ${r.doctorName}`);
  }
  // The summary badge should state the true count.
  assert(
    body.includes(`${jordanRecords.length} completed consultations`),
    `summary count badge does not state ${jordanRecords.length}`,
  );
  return `all ${jordanRecords.length} consultations present + count badge matches`;
});

await step('M3 notes render and match the API text', async () => {
  const body = await evaluate('document.body.innerText');
  assert(body.includes('Findings'), 'no "Findings" label');
  assert(body.includes('Recommendations'), 'no "Recommendations" label');
  // Check a fragment from EVERY seeded note, not just one.
  for (const r of jordanRecords) {
    for (const note of r.notes) {
      const frag = note.findings.slice(0, 45);
      assert(body.includes(frag), `missing findings text: "${frag}"`);
    }
  }
  return `all ${jordanRecords.reduce((n, r) => n + r.notes.length, 0)} notes matched API text`;
});

await step('M4 prescriptions render and match the API text', async () => {
  const body = await evaluate('document.body.innerText');
  assert(body.includes('Prescriptions'), 'no "Prescriptions" label');
  const totalRx = jordanRecords.reduce((n, r) => n + r.prescriptions.length, 0);
  assert(totalRx > 0, 'seed produced no prescriptions');
  for (const r of jordanRecords) {
    for (const rx of r.prescriptions) {
      const frag = rx.details.slice(0, 35);
      assert(body.includes(frag), `missing prescription text: "${frag}"`);
    }
  }
  return `all ${totalRx} prescriptions matched API text`;
});

await step('M5 history is grouped under a year heading', async () => {
  const headings = await evaluate(`Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim())`);
  const yearHeading = headings.find((h) => /^\d{4}$/.test(h));
  assert(yearHeading, `no year heading found, got ${JSON.stringify(headings)}`);
  return `year heading "${yearHeading}" present`;
});

await step('M6 "View full consultation" opens that exact session', async () => {
  // Click the link on the FIRST record card and compare against its sessionId.
  const clicked = await evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a')).filter(a => a.textContent.trim() === 'View full consultation');
    if (links.length === 0) return 'NO_LINK';
    links[0].click(); return 'OK';
  })()`);
  assert(clicked === 'OK', `link click: ${clicked}`);
  await sleep(2600);
  const path = await evaluate('location.pathname');
  const expected = jordanRecords[0].sessionId;
  assert(path === `/patient/consultations/${expected}`, `expected /patient/consultations/${expected}, got ${path}`);
  return `deep-linked to the record's own session (${expected.slice(0, 8)}…)`;
});

// ---------------------------------------------------------------- empty state
const alexToken = await tokenFor('alex.kim@example.com');
const alexRecords = await (await fetch(`${API}/consultations/records/me`, { headers: { Authorization: `Bearer ${alexToken}` } })).json();
assert(Array.isArray(alexRecords) && alexRecords.length === 0, `Alex should have 0 records, got ${JSON.stringify(alexRecords).slice(0, 120)}`);

await loginAs('alex.kim@example.com', 'PatientPass123!');

await step('M7 a patient with no completed consultations gets the empty state', async () => {
  await navigate('/patient/records', 2600);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('No records yet'), `empty state missing, body: ${body.slice(0, 300)}`);
  return 'empty state rendered for a patient with no history';
});

await step('M8 the empty state reads as a normal case, not an error', async () => {
  const body = await evaluate('document.body.innerText');
  assert(
    body.includes('once a consultation is completed'),
    'empty state does not explain when records will appear',
  );
  assert(!body.includes("Couldn't load"), 'empty state looks like a load failure');
  const destructive = await evaluate(`document.querySelectorAll('[role="alert"]').length`);
  assert(destructive === 0, `expected no alert region on the empty state, found ${destructive}`);
  // And there is a way forward.
  assert(body.includes('Book an appointment'), 'no next step offered from the empty state');
  return 'explained, no error styling, next step offered';
});

await step('M9 the empty page contains no other patient\'s data', async () => {
  const body = await evaluate('document.body.innerText');
  for (const r of jordanRecords) {
    assert(!body.includes(r.doctorName), `LEAK: ${r.doctorName} appears on the empty patient's page`);
  }
  const frag = jordanRecords[0].notes[0].findings.slice(0, 40);
  assert(!body.includes(frag), 'LEAK: another patient\'s note text appears');
  return 'no cross-patient data present';
});

await step('M10 the client never sends a patient id when fetching records', async () => {
  // Proves scoping is delegated to the server rather than attempted client-side.
  const recordCalls = requestedUrls.filter((u) => u.includes('/consultations/records'));
  assert(recordCalls.length > 0, 'no records request was observed');
  for (const u of recordCalls) {
    const path = new URL(u).pathname;
    assert(path === '/consultations/records/me', `unexpected records path "${path}"`);
    assert(!/\/records\/patient\//.test(path), `client requested a patient-scoped records path: ${path}`);
  }
  return `${recordCalls.length} records call(s), all to /records/me; no patient id sent`;
});

await step('M11 the server refuses a cross-patient records request', async () => {
  // Direct API check with Alex's token asking for the doctor-scoped route.
  const res = await fetch(`${API}/consultations/records/patient/00000000-0000-4000-8000-000000000000`, {
    headers: { Authorization: `Bearer ${alexToken}` },
  });
  assert(res.status === 403, `expected 403 for a patient hitting the doctor-scoped route, got ${res.status}`);
  const body = await res.json();
  assert(/role/i.test(body.message), `403 should cite the role guard, got: ${body.message}`);
  return `403 at the role guard: "${body.message}"`;
});

await step('M12 zero uncaught exceptions across both sessions', async () => {
  assert(uncaught.length === 0, `uncaught: ${uncaught.join(' | ')}`);
  return '0 uncaught exceptions';
});

console.log('\n=== LAYER 6 SUB-ITEM 6 — MEDICAL RECORDS VIEW EVIDENCE ===');
for (const r of results) console.log(r);
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} passed`);

ws.close();
chrome.kill();
process.exit(failed.length ? 1 : 0);
