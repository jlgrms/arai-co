// Layer 7 sub-item 1 — runtime verification of the DOCTOR PROFILE screen.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the REAL
// frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
// Checks:
//   D1  a doctor reaching /doctor/profile gets the real profile (not a placeholder)
//   D2  the values shown match GET /doctors/me exactly
//   D3  the specialization control is a select limited to the product set
//   D4  editing a field and saving PATCHes only the changed field
//   D5  the change persists on reload (round-trips through the backend)
//   D6  an untouched field is NOT sent in the PATCH body
//   D7  the "no changes" path sends no PATCH and reports it honestly
//   D8  a patient is refused the doctor route by the role guard (403/redirect)
//   D9  the approval-status notice reflects the real approvalStatus
//   D10 restoring the original value leaves the profile unchanged
//   D11 the page never renders the placeholder text
//   D12 zero uncaught exceptions across the whole run
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9236;
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/chrome-l7-s1-profile', 'about:blank'],
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
// Every PATCH body the page sends, so we can prove only changed fields travel.
const sentPatches = [];
const pendingRequests = new Map();

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    uncaught.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Network.requestWillBeSent') {
    pendingRequests.set(m.params.requestId, {
      url: m.params.request.url,
      method: m.params.request.method,
      postData: m.params.request.postData ?? null,
    });
  }
  if (m.method === 'Network.requestWillBeSentExtraInfo' || m.method === 'Network.loadingFinished') {
    const rec = pendingRequests.get(m.params.requestId);
    if (rec && rec.method === 'PATCH') sentPatches.push(rec);
    pendingRequests.delete(m.params.requestId);
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
const setSelect = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; el.value = ${JSON.stringify(val)}; el.dispatchEvent(new Event('change', { bubbles: true })); return el.value; })()`;

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

const DOC_EMAIL = 'dr.okafor@example.com';
const DOC_PASS = 'DoctorPass123!';
const token = await tokenFor(DOC_EMAIL, DOC_PASS);
const meBefore = await (await fetch(`${API}/doctors/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
console.log(`doctor: ${meBefore.name} | ${meBefore.specialization} | ${meBefore.approvalStatus}`);
console.log(`biography: ${(meBefore.biography ?? '').slice(0, 60)}…\n`);

const landed = await loginAs(DOC_EMAIL, DOC_PASS);
console.log(`login landed on: ${landed}\n`);

await step('D1 /doctor/profile renders the real profile, not a placeholder', async () => {
  await navigate('/doctor/profile', 2600);
  const body = await evaluate('document.body.innerText');
  assert(body.includes(meBefore.name), `doctor name ${meBefore.name} not rendered`);
  assert(!body.includes('Your biography and specialization.'), 'still showing the PlaceholderPage copy');
  return `rendered profile for ${meBefore.name}`;
});

await step('D2 displayed values match GET /doctors/me', async () => {
  const name = await evaluate(`document.querySelector('#name').value`);
  const spec = await evaluate(`document.querySelector('#specialization').value`);
  const bio = await evaluate(`document.querySelector('#biography').value`);
  assert(name === meBefore.name, `name input "${name}" != API "${meBefore.name}"`);
  assert(spec === meBefore.specialization, `specialization "${spec}" != API "${meBefore.specialization}"`);
  assert(bio === (meBefore.biography ?? ''), 'biography textarea does not match the API');
  return 'name, specialization and biography all match the API';
});

await step('D3 specialization is a bounded select of the product set', async () => {
  const info = await evaluate(`(() => {
    const el = document.querySelector('#specialization');
    if (!el) return null;
    return { tag: el.tagName, options: Array.from(el.options).map(o => o.value).filter(Boolean) };
  })()`);
  assert(info, 'no specialization control');
  assert(info.tag === 'SELECT', `specialization is a ${info.tag}, expected SELECT (free text would allow typos)`);
  assert(info.options.length >= 5, `only ${info.options.length} options`);
  assert(info.options.includes('General Medicine') && info.options.includes('Dermatology'), `unexpected options: ${info.options.join(', ')}`);
  return `SELECT with ${info.options.length} options: ${info.options.join(', ')}`;
});

const EDITED_BIO = `${meBefore.biography ?? ''} [verified ${new Date().toISOString().slice(0, 19)}]`;
sentPatches.length = 0;

await step('D4 editing ONLY the biography PATCHes only that field', async () => {
  await evaluate(setValue('#biography', EDITED_BIO));
  await sleep(300);
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(2200);

  const patches = sentPatches.filter((p) => p.url.includes('/doctors/me'));
  assert(patches.length === 1, `expected exactly 1 PATCH to /doctors/me, saw ${patches.length}`);
  const body = JSON.parse(patches[0].postData);
  assert('biography' in body, 'biography not in the PATCH body');
  assert(!('name' in body), `name was sent though it was not edited: ${patches[0].postData}`);
  assert(!('specialization' in body), `specialization was sent though it was not edited: ${patches[0].postData}`);
  return `PATCH body = ${patches[0].postData}`;
});

await step('D5 the change persists on reload (server round-trip)', async () => {
  await navigate('/doctor/profile', 2600);
  const bio = await evaluate(`document.querySelector('#biography').value`);
  assert(bio === EDITED_BIO, 'edited biography did not survive a reload');
  const api = await (await fetch(`${API}/doctors/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert(api.biography === EDITED_BIO, 'the API did not persist the edited biography');
  return 'reload shows the saved value and the API agrees';
});

await step('D6 approval-status notice matches the real status', async () => {
  const body = await evaluate('document.body.innerText');
  const status = meBefore.approvalStatus;
  const expected = status === 'APPROVED' ? 'Profile approved' : status === 'PENDING' ? 'Awaiting review' : 'Profile not approved';
  assert(body.includes(expected), `expected the "${expected}" notice for status ${status}`);
  return `notice "${expected}" shown for ${status}`;
});

sentPatches.length = 0;

await step('D7 saving with no changes sends no PATCH and says so', async () => {
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1600);
  const patches = sentPatches.filter((p) => p.url.includes('/doctors/me'));
  assert(patches.length === 0, `a no-op save still sent ${patches.length} PATCH request(s)`);
  const body = await evaluate('document.body.innerText');
  assert(/No changes to save/i.test(body), 'no honest "no changes" feedback was shown');
  return '0 PATCH requests, "No changes to save" reported';
});

sentPatches.length = 0;

await step('D8 restoring the original biography reverts it', async () => {
  await evaluate(setValue('#biography', meBefore.biography ?? ''));
  await sleep(300);
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(2200);
  const api = await (await fetch(`${API}/doctors/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert(api.biography === (meBefore.biography ?? ''), 'biography was not restored to its original value');
  return 'original biography restored via the UI';
});

await step('D9 a patient is refused the doctor profile route', async () => {
  await loginAs('jordan.lee@example.com', 'PatientPass123!');
  await navigate('/doctor/profile', 2400);
  const path = await evaluate('location.pathname');
  const body = await evaluate('document.body.innerText');
  assert(!path.startsWith('/doctor'), `patient was allowed onto ${path}`);
  assert(!body.includes('#name'), 'patient somehow rendered the doctor profile form');
  return `patient redirected away from /doctor/profile to ${path}`;
});

await step('D10 zero uncaught exceptions', async () => {
  assert(uncaught.length === 0, `${uncaught.length} uncaught: ${uncaught.slice(0, 2).join(' | ')}`);
  return '0 uncaught exceptions';
});

console.log('--- RESULTS ---');
for (const r of results) console.log(r);
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
ws.close(); chrome.kill();
process.exit(failed === 0 ? 0 : 1);
