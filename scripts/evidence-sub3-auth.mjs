// Dependency-free CDP driver for sub-item 3 evidence.
// Launches the app in headless Chrome, drives the real login/register forms,
// and prints the rendered error UI. Uses Node's global WebSocket (Node >=22)
// and fetch - no Playwright/puppeteer (standalone runtime, ground rule 1).
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createReclaimer } from './lib/reclaim.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9222;
const BASE = 'http://localhost:5173';

// Fixture reclamation (DEFERRED item 1). This harness drives the register forms
// through the UI, so the account id is not available from a response it holds —
// it is read back from the database by the exact email this file uses (see
// `captureFixtureByEmail`). Only ids that map to those known addresses are
// tracked; nothing is deleted by pattern.
const reclaim = createReclaimer({ label: 'sub3-auth' });

/**
 * Reads a fixture's id back from the database by email and tracks it.
 *
 * Used instead of a register response because these steps register through the
 * UI. The email is a fixed literal here, but the lookup is still "only what this
 * run created": the caller invokes it only on steps whose registration actually
 * succeeded, and a seeded account can never share these addresses.
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

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/chrome-sub3-profile',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function cdpTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error('CDP target never appeared');
}

const wsUrl = await cdpTarget();
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

function send(method, params = {}) {
  const mid = ++id;
  return new Promise((resolve) => {
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

async function navigate(path, waitMs = 1500) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await sleep(waitMs);
}

const setValue = (sel, val) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  // Fail with a useful message. Previously a missing field produced
  // "Cannot read properties of null (reading 'tagName')", which masked the real
  // cause (the auth guard had redirected the page) behind a stack dump.
  if (!el) throw new Error('field not found: ' + ${JSON.stringify(sel)} + ' (page=' + location.pathname + ')');
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

/**
 * Clears the session and lands on the unguarded public home.
 *
 * Every step below drives a login or register form. Steps previously ran back to
 * back without resetting session state, so after a step that *authenticated*
 * (step 2 — see its note), the next `navigate('/login')` was bounced by the auth
 * guard and every later step crashed on a missing field. Resetting first makes
 * each step independent, which is what its name has always implied.
 */
async function logoutToNeutral() {
  await navigate('/');
  await evaluate('localStorage.clear()');
}

async function readAlerts() {
  return evaluate(`Array.from(document.querySelectorAll('[role=alert]')).map(a => a.innerText.trim()).join(' | ')`);
}

async function readFieldErrors() {
  return evaluate(
    `Array.from(document.querySelectorAll('p[id$=-error]')).map(p => p.innerText.trim()).filter(Boolean).join(' | ')`,
  );
}

const results = [];
async function step(name, fn) {
  try {
    const out = await fn();
    results.push(`PASS  ${name}  ->  ${out}`);
  } catch (e) {
    results.push(`FAIL  ${name}  ->  ${e.message}`);
  }
}

await send('Page.enable');
await send('Runtime.enable');

await step('login 401 invalid creds', async () => {
  await logoutToNeutral();
  await navigate('/login');
  await evaluate(setValue('#login-email', 'jordan.lee@example.com'));
  await evaluate(setValue('#login-password', 'wrongpass'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return readAlerts();
});

// NOTE (verification gap — see DEFERRED items 1/3): `alex.kim@example.com` is a
// seeded ACTIVE patient, so this step does NOT observe a 403 — the login
// succeeds. Every seeded account is ACTIVE, so the 403 branch is unreachable
// until a PENDING/REJECTED fixture is seeded (DEFERRED item 3). The step is left
// to fail visibly rather than be rewritten to assert the success it actually
// gets; asserting the wrong outcome is the defect this file was just fixed for.
await step('login 403 account unavailable', async () => {
  await logoutToNeutral();
  await navigate('/login');
  await evaluate(setValue('#login-email', 'alex.kim@example.com'));
  await evaluate(setValue('#login-password', 'PatientPass123!'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  const alerts = await readAlerts();
  const path = await evaluate('location.pathname');
  // Fail if the account was NOT rejected: landing anywhere other than /login
  // means login succeeded, so no 403 evidence exists.
  if (!path.startsWith('/login')) {
    throw new Error(`expected 403 (stay on /login) but landed on ${path} — fixture is ACTIVE, no 403 observed`);
  }
  return `${alerts} || path=${path}`;
});

await step('login 400 validation', async () => {
  await logoutToNeutral();
  await navigate('/login');
  await evaluate(setValue('#login-email', 'bad-email'));
  await evaluate(setValue('#login-password', ''));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return (await readAlerts()) + ' || fields: ' + (await readFieldErrors());
});

await step('patient register 400 validation', async () => {
  await logoutToNeutral();
  await navigate('/register/patient');
  await evaluate(setValue('#reg-email', 'bad'));
  await evaluate(setValue('#reg-password', 'x'));
  await evaluate(setValue('#reg-name', ''));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return (await readAlerts()) + ' || fields: ' + (await readFieldErrors());
});

await step('patient register 409 duplicate', async () => {
  await logoutToNeutral();
  await navigate('/register/patient');
  await evaluate(setValue('#reg-email', 'jordan.lee@example.com'));
  await evaluate(setValue('#reg-password', 'Password123!'));
  await evaluate(setValue('#reg-name', 'Duplicate Person'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return readAlerts();
});

await step('doctor register 400 validation', async () => {
  await logoutToNeutral();
  await navigate('/register/doctor');
  await evaluate(setValue('#reg-email', 'ok2@example.com'));
  await evaluate(setValue('#reg-password', 'Password123!'));
  await evaluate(setValue('#reg-name', 'Dr Valid'));
  await evaluate(setValue('#reg-specialization', ''));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  // This step is labelled "validation" because #reg-specialization is left
  // empty, but every other field is valid. If the form submits and the API
  // accepts it, the account IS created and would otherwise leak — so the id is
  // captured here regardless of whether the UI showed an error or redirected.
  captureFixtureByEmail('ok2@example.com');
  return (await readAlerts()) + ' || fields: ' + (await readFieldErrors()) + ' || path=' + (await evaluate('location.pathname'));
});

await step('doctor register 409 duplicate', async () => {
  await logoutToNeutral();
  await navigate('/register/doctor');
  await evaluate(setValue('#reg-email', 'dr.chen@example.com'));
  await evaluate(setValue('#reg-password', 'Password123!'));
  await evaluate(setValue('#reg-name', 'Dr Duplicate'));
  await evaluate(setValue('#reg-specialization', 'Cardiology'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return readAlerts();
});

console.log(results.join('\n'));
ws.close();
chrome.kill('SIGKILL');
await reclaim.run('success path');

// Previously this harness exited 0 unconditionally, so a run full of FAIL lines
// still looked green to a caller. Exit non-zero when any step failed.
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
