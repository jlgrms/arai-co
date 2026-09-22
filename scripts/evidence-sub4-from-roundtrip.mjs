// Sub-item 4 evidence: "from" redirect round-trip preservation.
// Verifies the user-facing requirement behind state.from:
// an unauthenticated deep hit on a guarded route, once the user logs in,
// lands back on the ORIGINALLY intended page (not the role default home).
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9225;
const BASE = 'http://localhost:5173';
const DEEP = '/patient/records';       // guarded, non-default patient route
const DEFAULT_HOME = '/patient/discover';

const chrome = spawn(
  CHROME,
  ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-sub4-roundtrip','about:blank'],
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
const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'; })()`;

const results = [];
async function step(name, fn) { try { results.push(`PASS  ${name}  ->  ${await fn()}`); } catch (e) { results.push(`FAIL  ${name}  ->  ${e.message}`); } }

await send('Page.enable'); await send('Runtime.enable');

// T1: unauth deep hit -> /login, from-state == DEEP.
await step('T1 unauth deep hit redirects to /login with from=DEEP', async () => {
  await navigate('/');
  await evaluate('localStorage.clear()');
  await navigate(DEEP);
  const path = await evaluate('location.pathname');
  const from = await evaluate(`window.history.state?.usr?.from ?? null`);
  if (path !== '/login') throw new Error(`expected /login, got ${path}`);
  if (from !== DEEP) throw new Error(`expected from=${DEEP}, got ${JSON.stringify(from)}`);
  return `path=${path} from=${JSON.stringify(from)}`;
});

// T2: from the /login screen, log in as patient, assert landing == DEEP.
await step('T2 login from that /login screen lands on DEEP (not default home)', async () => {
  const onLogin = await evaluate('location.pathname');
  if (onLogin !== '/login') throw new Error(`not on /login (${onLogin})`);
  await evaluate(setValue('#login-email', 'jordan.lee@example.com'));
  await evaluate(setValue('#login-password', 'PatientPass123!'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(2000);
  const landed = await evaluate('location.pathname');
  if (landed === DEEP) return `landed=${landed} (honored from; PASS)`;
  if (landed === DEFAULT_HOME) throw new Error(`landed=${landed} (fell back to DEFAULT home; from NOT honored)`);
  throw new Error(`landed=${landed} (neither DEEP nor DEFAULT)`);
});

// T3: control — direct /login (no from) -> default home, proving the default
// path still works and T2's result is attributable to the from-state.
await step('T3 control: direct /login (no from) -> default home', async () => {
  await navigate('/');
  await evaluate('localStorage.clear()');
  await navigate('/login');
  const fromAtLogin = await evaluate(`window.history.state?.usr?.from ?? null`);
  await evaluate(setValue('#login-email', 'jordan.lee@example.com'));
  await evaluate(setValue('#login-password', 'PatientPass123!'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(2000);
  const landed = await evaluate('location.pathname');
  if (landed !== DEFAULT_HOME) throw new Error(`expected ${DEFAULT_HOME}, got ${landed} (fromAtLogin=${JSON.stringify(fromAtLogin)})`);
  return `landed=${landed} (default preserved; fromAtLogin=${JSON.stringify(fromAtLogin)})`;
});

console.log(results.join('\n'));
ws.close();
chrome.kill('SIGKILL');
process.exit(0);