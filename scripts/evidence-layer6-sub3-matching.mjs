// Layer 6 sub-item 3 — runtime verification of the GUIDED MATCHING UI.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the
// REAL frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
// Verifies the rendered behaviour:
//   M1  chips render from the DB-backed options endpoint (14 seeded phrases)
//   M2  a chip click fills the input AND submits in one tap
//   M3  free-text submit matches and renders results
//   M4  a symptom with >1 specialty renders MULTIPLE GROUPS with headings
//   M5  a multi-doctor specialty renders both doctors inside one group
//   M6  no-match renders the distinct empty state (NOT an error alert)
//   M7  empty-state "Browse all doctors" links to /patient/discover
//   M8  empty-state "Edit my symptom" returns to the input with text preserved
//   M9  error path (backend 500) renders the error alert, distinct from M6
//   M10 zero uncaught exceptions during the whole run
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9232;
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/chrome-sub6-match', 'about:blank'],
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
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    uncaught.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const send = (method, params = {}) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
async function navigate(path, waitMs = 1800) { await send('Page.navigate', { url: `${BASE}${path}` }); await sleep(waitMs); }
// textarea is not covered by HTMLInputElement.prototype, so target the right proto.
const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'OK'; })()`;
const clickByText = (txt) => `(() => { const b = Array.from(document.querySelectorAll('button, a')).find(b => b.textContent.trim() === ${JSON.stringify(txt)}); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`;

// Doctor names in DOM order across all rendered groups.
const CARD_NAMES = `Array.from(document.querySelectorAll('section li p.font-heading')).map(p => p.textContent.trim())`;
// Specialty group headings (h2 inside the results section).
const GROUP_HEADINGS = `Array.from(document.querySelectorAll('section h2')).map(h => h.textContent.trim())`;
// Count of doctors in each group, keyed by heading.
const GROUP_COUNTS = `Object.fromEntries(Array.from(document.querySelectorAll('section .space-y-3')).map(g => [g.querySelector('h2')?.textContent.trim(), g.querySelectorAll('li').length]))`;

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

await send('Page.enable'); await send('Runtime.enable'); await send('Console.enable');

// Fresh patient so the run doesn't depend on seeded demo state.
const email = `uimatch-${Date.now()}@example.com`;
const reg = await (await fetch(`${API}/auth/register/patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123!', name: 'UI Match' }) })).json();
assert(reg.accessToken, 'registration failed: ' + JSON.stringify(reg));

const landed = await loginAs(email, 'Password123!');
console.log('landed on:', landed);

await navigate('/patient/book', 2500);

await step('M1 chips render from the DB-backed options endpoint', async () => {
  // Scope to the chip list only — a page-wide button sweep also picks up the
  // shell's wordmark button, which is not a chip.
  const chips = await evaluate(`Array.from(document.querySelectorAll('ul li button')).map(b => b.textContent.trim())`);
  assert(chips.includes('cough'), `expected 'cough' chip, got ${JSON.stringify(chips)}`);
  assert(chips.includes('chest pain'), `expected 'chest pain' chip`);
  assert(chips.length === 14, `expected 14 chips from the 14 seeded phrases, got ${chips.length}`);
  return `${chips.length} chips incl. cough, chest pain`;
});

await step('M2 a chip click fills the input AND submits in one tap', async () => {
  await evaluate(clickByText('cough'));
  await sleep(1500);
  const input = await evaluate(`document.querySelector('#symptom-input').value`);
  assert(input === 'cough', `input should be filled with the chip phrase, got ${JSON.stringify(input)}`);
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 2, `cough should match 2 doctors, got ${JSON.stringify(names)}`);
  return `input="${input}", ${names.length} doctors: ${names.join(', ')}`;
});

await step('M5 multi-doctor specialty renders both doctors in ONE group', async () => {
  const counts = await evaluate(GROUP_COUNTS);
  assert(Object.keys(counts).length === 1, `cough matches 1 specialty, got ${JSON.stringify(Object.keys(counts))}`);
  assert(counts['General Medicine'] === 2, `General Medicine should hold 2 doctors, got ${JSON.stringify(counts)}`);
  return JSON.stringify(counts);
});

await step('M3 free-text submit matches and renders results', async () => {
  await evaluate(setValue('#symptom-input', 'rash'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1500);
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 1 && names[0].includes('Okafor'), `got ${JSON.stringify(names)}`);
  return `"rash" -> ${names.join(', ')}`;
});

await step('M4 "fever" renders MULTIPLE GROUPS with specialty headings', async () => {
  await evaluate(setValue('#symptom-input', 'fever'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1500);
  const headings = await evaluate(GROUP_HEADINGS);
  assert(headings.length === 2, `fever matches 2 specialties, got ${JSON.stringify(headings)}`);
  assert(headings.includes('General Medicine') && headings.includes('Pediatrics'), `unexpected headings: ${JSON.stringify(headings)}`);
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 3, `fever should match 3 doctors, got ${JSON.stringify(names)}`);
  return `groups ${JSON.stringify(headings)} | ${names.length} doctors`;
});

await step('M6 no-match renders the DISTINCT empty state, not an error', async () => {
  await evaluate(setValue('#symptom-input', 'qqzzxx'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1500);
  const body = await evaluate('document.body.innerText');
  assert(body.includes("couldn't match"), 'empty-state headline missing');
  assert(!body.includes('complete the match'), 'error alert must NOT render for a successful no-match');
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 0, `no doctors expected, got ${JSON.stringify(names)}`);
  // Distinct from the discovery screen's "No doctors available" wording.
  assert(!body.includes('No doctors available yet'), 'should not reuse the discovery empty state');
  return 'reassuring empty state, no error alert';
});

await step('M7 empty-state "Browse all doctors" links to /patient/discover', async () => {
  await evaluate(clickByText('Browse all doctors'));
  await sleep(1800);
  const path = await evaluate('location.pathname');
  assert(path === '/patient/discover', `expected /patient/discover, got ${path}`);
  return `navigated to ${path}`;
});

await step('M8 "Edit my symptom" returns to the input with text preserved', async () => {
  await navigate('/patient/book', 2200);
  await evaluate(setValue('#symptom-input', 'qqzzxx'));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(1500);
  await evaluate(clickByText('Edit my symptom'));
  await sleep(600);
  const value = await evaluate(`document.querySelector('#symptom-input').value`);
  assert(value === 'qqzzxx', `text should be preserved, got ${JSON.stringify(value)}`);
  const focused = await evaluate(`document.activeElement?.id`);
  assert(focused === 'symptom-input', `input should be refocused, activeElement=${focused}`);
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 0, 'empty state should be dismissed');
  return `value preserved, focus on #${focused}`;
});

await step('M9 error path renders the error alert (distinct from no-match)', async () => {
  // Fail ONLY the API host, at the browser's network layer.
  //
  // Three earlier approaches were wrong and are worth recording:
  //   - Patching window.fetch did nothing: api-client holds its own reference.
  //   - Stopping the backend container DID cause a failure, but restarting the
  //     bind-mounted app also triggered a Vite HMR reload, which remounted
  //     React and wiped the state we were trying to observe.
  //   - `Network.setBlockedURLs` with '*localhost:3000/doctors/match*' did NOT
  //     block: the pattern is matched without the query string, so a path
  //     suffix pattern never matches '/doctors/match?symptom=...'. Verified
  //     empirically — the host-level wildcard below is what actually works.
  await navigate('/patient/book', 2200);
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*localhost:3000*'] });
  try {
    await evaluate(setValue('#symptom-input', 'cough'));
    await evaluate(`document.querySelector('form button[type=submit]').click()`);
    await sleep(2500);
    const body = await evaluate('document.body.innerText');
    // Match on a substring with NO apostrophe. The JSX uses &apos;, which React
    // renders as the plain ASCII ' (U+0027) — asserting on a curly ’ here fails
    // even though the alert is on screen.
    assert(
      body.includes('complete the match'),
      `error alert missing; body=${body.slice(0, 300)}`,
    );
    const hasRetry = await evaluate(
      `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Try again')`,
    );
    assert(hasRetry, 'network failure is retryable, expected a Try again button');
    // The distinct no-match empty state must NOT be what rendered.
    assert(!body.includes("couldn't match"), 'no-match empty state leaked into the error path');
  } finally {
    await send('Network.setBlockedURLs', { urls: [] });
  }
  // Unblock and confirm the same input now succeeds — proving the alert was
  // the failure path, not a stuck screen.
  await evaluate(clickByText('Try again'));
  await sleep(2500);
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 2, `recovery after unblock failed, got ${JSON.stringify(names)}`);
  const stillErroring = await evaluate(`document.body.innerText.includes('Couldn\u2019t complete the match')`);
  assert(!stillErroring, 'error alert should clear after a successful retry');
  return 'error alert + Try again rendered; retry then succeeded';
});

await step('M10 zero uncaught exceptions', async () => {
  assert(uncaught.length === 0, `uncaught: ${uncaught.join(' | ')}`);
  return '0 uncaught exceptions';
});

console.log('\n=== LAYER 6 SUB-ITEM 3 — GUIDED MATCHING UI EVIDENCE ===');
for (const r of results) console.log(r);
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} passed`);

ws.close();
chrome.kill();
process.exit(failed.length ? 1 : 0);
