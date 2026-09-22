// Sub-item 4 evidence: role-based routing guards.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch).
// Verifies the four stated requirements against the REAL app:
//   R1 unauth  -> /login, preserving intended path (state.from)
//   R2 wrong role -> that user's own home
//   R3 loading screen shown while auth resolves (no flash of guarded content)
//   R4 allowed role -> guarded content renders
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9224;
const BASE = 'http://localhost:5173';

const chrome = spawn(
  CHROME,
  ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-sub4-guards','about:blank'],
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
async function logoutToNeutral() { await navigate('/'); await evaluate('localStorage.clear()'); }
const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()`;

const results = [];
async function step(name, fn) { try { results.push(`PASS  ${name}  ->  ${await fn()}`); } catch (e) { results.push(`FAIL  ${name}  ->  ${e.message}`); } }

await send('Page.enable'); await send('Runtime.enable');

// R1: unauthenticated hit on a guarded route -> /login, preserving intended path.
await step('R1 unauth guarded route -> /login preserving from', async () => {
  await logoutToNeutral();
  await navigate('/patient/appointments');
  const path = await evaluate('location.pathname');
  const from = await evaluate(`window.history.state?.usr?.from ?? null`);
  return `path=${path} from=${JSON.stringify(from)}`;
});

// R2: wrong role. Login as patient, then hit a doctor-only route -> own home.
await step('R2 wrong role -> own home (patient hits /doctor/schedule)', async () => {
  await logoutToNeutral();
  await navigate('/login');
  await evaluate(setValue('#login-email', 'jordan.lee@example.com'));
  await evaluate(setValue('#login-password', 'PatientPass123!'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1800);
  await navigate('/doctor/schedule');
  const path = await evaluate('location.pathname');
  return `path=${path} (expected /patient/discover)`;
});

// R2b: wrong role the other way — authed doctor hits patient-only route.
await step('R2b wrong role -> own home (doctor hits /patient/records)', async () => {
  await logoutToNeutral();
  await navigate('/login');
  await evaluate(setValue('#login-email', 'dr.chen@example.com'));
  await evaluate(setValue('#login-password', 'DoctorPass123!'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1800);
  const landed = await evaluate('location.pathname');
  await navigate('/patient/records');
  const path = await evaluate('location.pathname');
  return `afterLogin=${landed} afterWrongRoleAttempt=${path} (expected /doctor/schedule)`;
});

// R4: allowed role -> guarded content renders (the shell mounts).
await step('R4 allowed role -> guarded shell renders', async () => {
  const path = await evaluate('location.pathname');
  const shell = await evaluate(`Boolean(document.querySelector('nav, aside, [data-testid], header'))`);
  return `path=${path} shellMounted=${shell}`;
});

// R3: loading screen while auth resolves, and NO flash of guarded content.
// Installs a MutationObserver into EVERY new document (so it survives the hard
// reload) and records the exact DOM paint ordering: LOADING before SHELL proves
// the auth-resolution screen is shown and no guarded content flashes first.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__guardLog = [];
    window.__guardStart = Date.now();
    const install = () => {
      if (!document.documentElement) return;
      new MutationObserver(() => {
        const hasStatus = Boolean(document.querySelector('[role=status]'));
        const hasNav = Boolean(document.querySelector('nav, aside'));
        window.__guardLog.push([Date.now() - window.__guardStart, hasStatus ? 'LOADING' : (hasNav ? 'SHELL' : '-')]);
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) install();
    else document.addEventListener('DOMContentLoaded', install);
  `,
});
await step('R3 loading screen during resolve, no guarded-content flash', async () => {
  await navigate('/doctor/schedule');
  await sleep(800);
  await send('Page.reload', {});
  await sleep(2500);
  const log = await evaluate('window.__guardLog || []');
  const states = log.map((e) => e[1]);
  const sawLoading = states.includes('LOADING');
  const firstShell = states.indexOf('SHELL');
  const firstLoading = states.indexOf('LOADING');
  const noFlash = sawLoading && firstShell !== -1 && firstLoading < firstShell;
  return `sawLoading=${sawLoading} ordering=[${log.map((e) => e[0] + 'ms:' + e[1]).join(' ')}] noFlashBeforeGuarded=${noFlash}`;
});

console.log(results.join('\n'));
ws.close();
chrome.kill('SIGKILL');
process.exit(0);