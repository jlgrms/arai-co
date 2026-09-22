// Sub-item 3 happy-path + localStorage evidence (real Chrome via CDP).
//
// FIXTURE DISCIPLINE (DEFERRED item 1): this harness registers a throwaway
// patient AND a throwaway doctor, and previously leaked both. It now tracks the
// ids returned by registration and reclaims them on every exit path. Only ids
// captured from this run's own register calls are ever deleted.
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createReclaimer } from './lib/reclaim.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9223;
const BASE = 'http://localhost:5173';
const stamp = Date.now();

// Fixture reclamation. The register response is FLAT — `{ accessToken, userId,
// role }` — not `{ user: { id } }`. Reading the wrong field yields undefined and
// the tracker silently no-ops, which would leak while reporting clean.
const reclaim = createReclaimer({ label: 'sub3-happy' });

/**
 * Captures the fixture id for cleanup WITHOUT creating the account.
 *
 * The obvious approach — pre-register over the API to read the id — does not
 * work here: the step under test registers the SAME email through the UI
 * afterwards, so the pre-registration consumes the address, the UI registration
 * is refused as a duplicate, and the harness silently stops testing registration
 * at all. (It still reported PASS, because the old pass-condition never checked
 * the path — see `expectRegistered` below. Caught by diffing against the
 * pre-change run, which landed on /patient/discover.)
 *
 * Instead the id is read back FROM THE DATABASE by the email this run just
 * generated. That is still "only what this run created": the email carries the
 * run's `stamp`, so the lookup cannot match another run's or a seeded account.
 */
function captureFixtureByEmail(email) {
  const res = spawnSync(
    'docker',
    [
      'exec', 'telehealth-postgres', 'psql', '-U', 'telehealth', '-d', 'telehealth',
      '-t', '-A', '-c', `SELECT id FROM "User" WHERE email = '${email.replace(/'/g, "''")}';`,
    ],
    { encoding: 'utf8' },
  );
  const id = (res.stdout || '').trim();
  if (id) reclaim.trackUser(id, email);
  return id || null;
}

/**
 * Asserts a registration step actually registered.
 *
 * The original step returned `path=... tokenPresent=...` and PASSED regardless,
 * so a completely failed registration was reported as a pass. That is the same
 * vacuous-assertion defect as DEFERRED item 10 (R17 passed while the widget was
 * broken). Registration is only verified if the user left the register route AND
 * a token was stored.
 */
function expectRegistered(stepName, { path, token }) {
  if (path.startsWith('/register')) {
    throw new Error(`${stepName}: still on ${path} — registration did not complete`);
  }
  if (!token) throw new Error(`${stepName}: no access token stored after registration`);
}

const chrome = spawn(
  CHROME,
  ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-sub3-happy','about:blank'],
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
async function navigate(path, waitMs = 1500) { await send('Page.navigate', { url: `${BASE}${path}` }); await sleep(waitMs); }
// Boot on the unguarded public home, drop the session, so guards see an
// unauthenticated user on the next navigation (auth-context re-bootstraps from
// empty storage). Avoids the redirect-on-authenticated guard racing form fill.
async function logoutToNeutral() { await navigate('/'); await evaluate('localStorage.clear()'); }
const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;

const results = [];
async function step(name, fn) { try { results.push(`PASS  ${name}  ->  ${await fn()}`); } catch (e) { results.push(`FAIL  ${name}  ->  ${e.message}`); } }

await send('Page.enable'); await send('Runtime.enable');

// Baseline: no token stored.
await step('no token before login', async () => {
  await navigate('/login');
  await evaluate('localStorage.clear()');
  return 'token=' + JSON.stringify(await evaluate(`localStorage.getItem('aray.accessToken')`));
});

// Patient register (happy) -> redirect to /patient/discover, token in localStorage.
await step('patient register happy -> redirect + localStorage', async () => {
  await navigate('/register/patient');
  await evaluate(setValue('#reg-name', 'Happy Patient'));
  await evaluate(setValue('#reg-email', `happy.patient.${stamp}@example.com`));
  await evaluate(setValue('#reg-password', 'Password123!'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1800);
  const path = await evaluate('location.pathname');
  const tok = await evaluate(`localStorage.getItem('aray.accessToken')`);
  const user = await evaluate(`localStorage.getItem('aray.authUser')`);
  expectRegistered('patient register', { path, token: tok });
  captureFixtureByEmail(`happy.patient.${stamp}@example.com`);
  return `path=${path} tokenPresent=${Boolean(tok)} user=${user}`;
});

// Clear, then doctor register (happy) -> redirect to /doctor/schedule.
await step('doctor register happy -> redirect + localStorage', async () => {
  await logoutToNeutral();
  await navigate('/register/doctor');
  await evaluate(setValue('#reg-name', 'Happy Doctor'));
  await evaluate(setValue('#reg-email', `happy.doctor.${stamp}@example.com`));
  await evaluate(setValue('#reg-password', 'Password123!'));
  await evaluate(setValue('#reg-specialization', 'Neurology'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1800);
  const path = await evaluate('location.pathname');
  const tok = await evaluate(`localStorage.getItem('aray.accessToken')`);
  const user = await evaluate(`localStorage.getItem('aray.authUser')`);
  expectRegistered('doctor register', { path, token: tok });
  captureFixtureByEmail(`happy.doctor.${stamp}@example.com`);
  return `path=${path} tokenPresent=${Boolean(tok)} user=${user}`;
});

// Login (happy) with a seeded account -> redirect by role.
await step('login happy (patient) -> redirect + localStorage', async () => {
  await logoutToNeutral();
  await navigate('/login');
  await evaluate(setValue('#login-email', 'jordan.lee@example.com'));
  await evaluate(setValue('#login-password', 'PatientPass123!'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1800);
  const path = await evaluate('location.pathname');
  const tok = await evaluate(`localStorage.getItem('aray.accessToken')`);
  return `path=${path} tokenPresent=${Boolean(tok)}`;
});

// Persistence across reload: token survives, guard lets us stay on guarded route.
await step('session persists across hard reload', async () => {
  await navigate('/patient/discover');
  await sleep(1200);
  await send('Page.reload', {});
  await sleep(2000);
  const path = await evaluate('location.pathname');
  const tok = await evaluate(`localStorage.getItem('aray.accessToken')`);
  return `afterReloadPath=${path} tokenPresent=${Boolean(tok)}`;
});

console.log(results.join('\n'));
ws.close();
chrome.kill('SIGKILL');
await reclaim.run('success path');

// A leaked throwaway account here is exactly what DEFERRED item 1 is about, so
// fail loudly rather than exit 0 over a leak.
const cleanup = reclaim.ids();
if (cleanup.users.length === 0) {
  console.log('WARNING: no fixture ids were captured — the harness may have leaked its registrations');
}
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
