// Dependency-free CDP driver for sub-item 3 evidence.
// Launches the app in headless Chrome, drives the real login/register forms,
// and prints the rendered error UI. Uses Node's global WebSocket (Node >=22)
// and fetch - no Playwright/puppeteer (standalone runtime, ground rule 1).
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9222;
const BASE = 'http://localhost:5173';

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
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

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
  await navigate('/login');
  await evaluate(setValue('#login-email', 'jordan.lee@example.com'));
  await evaluate(setValue('#login-password', 'wrongpass'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return readAlerts();
});

await step('login 403 account unavailable', async () => {
  await navigate('/login');
  await evaluate(setValue('#login-email', 'alex.kim@example.com'));
  await evaluate(setValue('#login-password', 'PatientPass123!'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return readAlerts();
});

await step('login 400 validation', async () => {
  await navigate('/login');
  await evaluate(setValue('#login-email', 'bad-email'));
  await evaluate(setValue('#login-password', ''));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return (await readAlerts()) + ' || fields: ' + (await readFieldErrors());
});

await step('patient register 400 validation', async () => {
  await navigate('/register/patient');
  await evaluate(setValue('#reg-email', 'bad'));
  await evaluate(setValue('#reg-password', 'x'));
  await evaluate(setValue('#reg-name', ''));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return (await readAlerts()) + ' || fields: ' + (await readFieldErrors());
});

await step('patient register 409 duplicate', async () => {
  await navigate('/register/patient');
  await evaluate(setValue('#reg-email', 'jordan.lee@example.com'));
  await evaluate(setValue('#reg-password', 'Password123!'));
  await evaluate(setValue('#reg-name', 'Duplicate Person'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return readAlerts();
});

await step('doctor register 400 validation', async () => {
  await navigate('/register/doctor');
  await evaluate(setValue('#reg-email', 'ok2@example.com'));
  await evaluate(setValue('#reg-password', 'Password123!'));
  await evaluate(setValue('#reg-name', 'Dr Valid'));
  await evaluate(setValue('#reg-specialization', ''));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1200);
  return (await readAlerts()) + ' || fields: ' + (await readFieldErrors());
});

await step('doctor register 409 duplicate', async () => {
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
process.exit(0);
