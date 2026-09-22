// Layer 6 sub-item 2 — runtime verification of the DISCOVER DOCTORS UI.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the
// REAL frontend at :5173 against the REAL backend at :3000 in headless Chrome.
// Verifies the rendered behaviour:
//   D1 list renders ALL approved doctors from the API, by name (not a count)
//   D2 specialty dropdown is populated from the unfiltered set
//   D3 typing "chen" (server search) narrows to Dr. Wei Chen
//   D4 search is case-insensitive in the UI too
//   D5 biography match works from the search box
//   D6 specialty filter narrows the list
//   D7 search + specialty compose (AND)
//   D8 no-match shows the filtered empty state + Clear filters resets
//   D9 zero uncaught exceptions during the whole run
//
// NOTE ON THE EXPECTED COUNT: D1/D8b originally hardcoded 5. That was correct
// when written (Layer 6 sub-item 2), but sub-item 3 seeded a 6th approved doctor
// (Dr. Camila Reyes, added so the guided-matching "two doctors share a specialty"
// case is demoable), which silently invalidated the literal. The doctor roster is
// DATA, not a fixed product constant, so the expected set is now derived from
// `GET /doctors` and compared by NAME. That is also a stronger assertion: a list
// of the right length containing the wrong doctors previously passed.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createReclaimer } from './lib/reclaim.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9231;
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

// FIXTURE DISCIPLINE (DEFERRED item 1): this harness registers a throwaway
// patient and previously leaked it on every run. The id returned by
// registration is captured below and reclaimed on every exit path.
const reclaim = createReclaimer({ label: 'l6s2-discover' });

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/chrome-sub6-discover', 'about:blank'],
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
const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'OK'; })()`;

// Card names currently rendered in the grid, in DOM order.
const CARD_NAMES = `Array.from(document.querySelectorAll('section li p.font-heading')).map(p => p.textContent.trim())`;
// The "N doctors available/found" count line.
const COUNT_LINE = `(document.querySelector('section > p')?.textContent || '').trim()`;

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
const email = `uidisc-${Date.now()}@example.com`;
const reg = await (await fetch(`${API}/auth/register/patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123!', name: 'UI Disc' }) })).json();
assert(reg.accessToken, 'registration failed: ' + JSON.stringify(reg));
// Capture the fixture id for cleanup. The register response is FLAT
// (`{ accessToken, userId, role }`), not `{ user: { id } }`; reading the wrong
// field yields undefined and the tracker silently no-ops, leaking the account.
reclaim.trackUser(reg.userId, email);

const landed = await loginAs(email, 'Password123!');
console.log('landed on:', landed);

// ---- Expected data derived from the API, not hardcoded --------------------
// The roster is seeded data that legitimately grows; a literal here goes stale
// silently (see the note at the top). Read the truth the UI is rendering.
const token = reg.accessToken;
const apiDoctors = await (await fetch(`${API}/doctors`, { headers: { Authorization: `Bearer ${token}` } })).json();
const EXPECTED_NAMES = apiDoctors.map((d) => d.name);
const EXPECTED_SPECIALTIES = [...new Set(apiDoctors.map((d) => d.specialization))].sort();
console.log(`API truth: ${EXPECTED_NAMES.length} approved doctors — ${EXPECTED_NAMES.join(', ')}`);
console.log(`API truth: ${EXPECTED_SPECIALTIES.length} distinct specialties — ${EXPECTED_SPECIALTIES.join(', ')}\n`);

// Start from a clean slate on the discover screen.
await navigate('/patient/discover', 2200);

await step('D1 list renders ALL approved doctors from the API, by name', async () => {
  const names = await evaluate(CARD_NAMES);
  // Set equality, both directions: no missing doctor and no extra one. A count
  // check alone would pass a list of 6 that omits one real doctor and shows a
  // bogus one.
  const missing = EXPECTED_NAMES.filter((n) => !names.includes(n));
  const extra = names.filter((n) => !EXPECTED_NAMES.includes(n));
  assert(missing.length === 0, `doctors from API missing in UI: ${JSON.stringify(missing)}; rendered=${JSON.stringify(names)}`);
  assert(extra.length === 0, `UI rendered doctors not returned by API: ${JSON.stringify(extra)}`);
  assert(names.length === EXPECTED_NAMES.length, `expected ${EXPECTED_NAMES.length} cards, got ${names.length}`);
  // Order must be stable (the API orders by name) or the grid reshuffles per load.
  assert(JSON.stringify(names) === JSON.stringify(EXPECTED_NAMES), `order differs from API: ${JSON.stringify(names)} vs ${JSON.stringify(EXPECTED_NAMES)}`);
  return `${names.length} cards, exact set + order match: ${names.join(', ')}`;
});

await step('D2 specialty dropdown populated from unfiltered set', async () => {
  const opts = await evaluate(`Array.from(document.querySelectorAll('#specialty-filter option')).map(o => o.value)`);
  assert(opts[0] === '', `first option should be the "all" sentinel, got ${JSON.stringify(opts[0])}`);
  // Derived: 1 sentinel + one option per distinct specialty the API returns.
  assert(
    opts.length === EXPECTED_SPECIALTIES.length + 1,
    `expected 1 sentinel + ${EXPECTED_SPECIALTIES.length} specialties, got ${opts.length}: ${JSON.stringify(opts)}`,
  );
  const offered = opts.slice(1).sort();
  assert(
    JSON.stringify(offered) === JSON.stringify(EXPECTED_SPECIALTIES),
    `dropdown specialties differ from API: ${JSON.stringify(offered)} vs ${JSON.stringify(EXPECTED_SPECIALTIES)}`,
  );
  return `options: ${JSON.stringify(opts)}`;
});

await step('D3 typing "chen" narrows to Dr. Wei Chen', async () => {
  await evaluate(setValue('#doctor-search', 'chen'));
  await sleep(900); // debounce 300ms + request
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 1 && names[0].includes('Chen'), `got ${JSON.stringify(names)}`);
  const line = await evaluate(COUNT_LINE);
  return `${names.join(', ')} | "${line}"`;
});

await step('D4 search is case-insensitive ("CHEN")', async () => {
  await evaluate(setValue('#doctor-search', 'CHEN'));
  await sleep(900);
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 1 && names[0].includes('Chen'), `got ${JSON.stringify(names)}`);
  return names.join(', ');
});

await step('D5 biography match ("procedural") finds Dr. Okafor', async () => {
  await evaluate(setValue('#doctor-search', 'procedural'));
  await sleep(900);
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 1 && names[0].includes('Okafor'), `got ${JSON.stringify(names)}`);
  return names.join(', ');
});

await step('D6 specialty filter narrows the list', async () => {
  await evaluate(setValue('#doctor-search', ''));      // clear search
  await evaluate(setValue('#specialty-filter', 'Pediatrics'));
  await sleep(1100);
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 1 && names[0].includes('Nguyen'), `got ${JSON.stringify(names)}`);
  return names.join(', ');
});

await step('D7 search + specialty compose (AND)', async () => {
  await evaluate(setValue('#doctor-search', 'procedural')); // matches Okafor, but specialty is Pediatrics
  await sleep(1000);
  const names = await evaluate(CARD_NAMES);
  assert(names.length === 0, `AND should yield nothing, got ${JSON.stringify(names)}`);
  const cardCount = await evaluate(`document.querySelectorAll('section li').length`);
  assert(cardCount === 0, `expected 0 cards, got ${cardCount}`);
  return 'contradictory filters -> empty list';
});

await step('D8 empty state appears and Clear filters resets', async () => {
  const emptyText = await evaluate(`document.body.innerText.includes('No doctors match your filters')`);
  assert(emptyText, 'filtered empty state message not rendered');
  await evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Clear filters'); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`);
  const clicked = await evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Clear filters'); return b ? 'STILL_THERE' : 'GONE'; })()`);
  return `empty state shown, clear button ${clicked}`;
});

await step('D8b clearing restores the full list and resets controls', async () => {
  await sleep(1200);
  const names = await evaluate(CARD_NAMES);
  assert(
    names.length === EXPECTED_NAMES.length,
    `expected ${EXPECTED_NAMES.length} after clear, got ${names.length}: ${JSON.stringify(names)}`,
  );
  assert(
    JSON.stringify(names) === JSON.stringify(EXPECTED_NAMES),
    `cleared list is not the full API set: ${JSON.stringify(names)}`,
  );
  const search = await evaluate(`document.querySelector('#doctor-search').value`);
  const spec = await evaluate(`document.querySelector('#specialty-filter').value`);
  assert(search === '' && spec === '', `controls not reset: search=${JSON.stringify(search)} spec=${JSON.stringify(spec)}`);
  return `${names.length} doctors restored, controls reset`;
});

await step('D9 zero uncaught exceptions', async () => {
  assert(uncaught.length === 0, `uncaught: ${uncaught.join(' | ')}`);
  return '0 uncaught exceptions';
});

console.log('\n=== LAYER 6 SUB-ITEM 2 — DISCOVER UI EVIDENCE ===');
for (const r of results) console.log(r);
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} passed`);

ws.close();
chrome.kill('SIGKILL');
// Reclaim the throwaway account this run registered. Reported per item; an
// already-gone row is not counted as reclaimed.
await reclaim.run('success path');

process.exit(failed.length ? 1 : 0);
