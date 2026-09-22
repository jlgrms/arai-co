// Sub-item 3 happy-path + localStorage evidence (real Chrome via CDP).
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9223;
const BASE = 'http://localhost:5173';
const stamp = Date.now();

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
process.exit(0);
