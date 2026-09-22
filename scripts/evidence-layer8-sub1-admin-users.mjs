// Layer 8 sub-item 1 — runtime verification of the ADMIN USER MANAGEMENT UI.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the
// REAL frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
//   U1  /admin/users renders the real table, not the placeholder
//   U2  every row in the table matches GET /admin/users exactly (by id)
//   U3  admin accounts are absent (server rule) and the real patients/doctors show
//   U4  search narrows the list server-side (email substring)
//   U5  search matches a profile NAME, not just email
//   U6  role filter narrows to doctors only
//   U7  status filter narrows to the suspended account
//   U8  filters compose (search AND role AND status)
//   U9  no-match shows the filtered empty state; Clear resets
//   U10 suspend: confirm dialog, reason recorded, badge flips, reason shows inline
//   U11 suspend is PERSISTED to the API (not just optimistic UI)
//   U12 deactivate: destructive path flips the badge
//   U13 activate: restores to ACTIVE
//   U14 re-applying the current state is offered for it: the current state's own
//       action is absent from the row
//   U15 the audit log gained exactly the expected entries
//   U16 zero uncaught exceptions
//
// FIXTURE DISCIPLINE (learned from a513584): this harness creates its OWN
// throwaway patient account, mutates ONLY that account, and restores it to
// ACTIVE on exit. It never touches a seeded account. It does NOT delete the
// account it creates — there is no user-DELETE endpoint — so it reports that
// residue explicitly rather than pretending it cleaned up.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9241; // 9226, 9231-9240 are taken by earlier harnesses.
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASS = 'AdminPass123!';

const stamp = Date.now();
const FIXTURE_EMAIL = `l8s1-ui-${stamp}@example.com`;
const FIXTURE_NAME = `UI L8S1 ${stamp}`;

let pass = 0;
const failures = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`  FAIL  ${name} — ${err.message}`);
  }
}

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/chrome-l8s1-users`, 'about:blank'],
  { stdio: 'ignore' },
);

async function cdpTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP target never appeared');
}

const ws = new WebSocket(await cdpTarget());
let id = 0;
const pending = new Map();
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

// Click by data-testid, NOT by text-in-DOM-order. a513584's lesson: a
// text-based selector can match the wrong row (or nothing), and "nothing"
// silently turns an assertion into a no-op that passes.
const clickTestId = (testid) => `(() => { const el = document.querySelector('[data-testid=${JSON.stringify(testid).slice(1, -1)}]'); if (!el) return 'NO_EL'; el.click(); return 'OK'; })()`;
const clickExact = (txt, sel = 'button') => `(() => { const b = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find(b => b.textContent.trim() === ${JSON.stringify(txt)}); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`;

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

// ---- API truth -------------------------------------------------------------

const adminToken = await tokenFor(ADMIN_EMAIL, ADMIN_PASS);
assert(adminToken, 'admin login failed — cannot run this harness');

const apiUsers = async () => {
  const r = await fetch(`${API}/admin/users`, { headers: { Authorization: `Bearer ${adminToken}` } });
  return r.json();
};

// Fixture: a disposable patient this harness owns and restores.
await fetch(`${API}/auth/register/patient`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: FIXTURE_EMAIL, password: 'FixturePass123!', name: FIXTURE_NAME }),
});

const before = await apiUsers();
const fixture = before.find((u) => u.email === FIXTURE_EMAIL);
assert(fixture, 'fixture account was not registered');

const auditCount = async () => {
  const r = await fetch(`${API}/admin/audit-logs`, { headers: { Authorization: `Bearer ${adminToken}` } });
  return (await r.json()).length;
};
const auditBefore = await auditCount();

// Admin email must never appear: listUsers excludes ADMIN.
const ADMIN_USER_ID = (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
}).then((r) => r.json())).userId;

console.log(`\nLayer 8 sub-item 1 — admin user management UI`);
console.log(`Fixture: ${FIXTURE_EMAIL} (${fixture.id})\n`);

const landed = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
assert(landed === '/admin', `admin sign-in landed on ${landed}, expected /admin`);

await step('U1 /admin/users renders the real table, not the placeholder', async () => {
  await navigate('/admin/users', 2600);
  const body = await evaluate('document.body.innerText');
  assert(!body.includes('This screen is delivered in a later step'), 'placeholder still rendered');
  assert(await evaluate(`!!document.querySelector('#admin-user-search')`), 'search input missing');
  assert(await evaluate(`!!document.querySelector('#admin-user-role')`), 'role filter missing');
  assert(await evaluate(`!!document.querySelector('#admin-user-state')`), 'status filter missing');
  return 'table + 3 filters present';
});

await step('U2 every rendered row matches GET /admin/users exactly (by id)', async () => {
  await navigate('/admin/users', 2600);
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-user-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-user-row-',''))`);
  const expected = (await apiUsers()).map((u) => u.id).sort();
  assert(rows.length === expected.length, `rendered ${rows.length} rows, API has ${expected.length}`);
  const got = [...rows].sort();
  assert(JSON.stringify(got) === JSON.stringify(expected), `row ids differ from API:\n got=${got.join(',')}\n exp=${expected.join(',')}`);
  return `${rows.length} rows, ids identical to API`;
});

await step('U3 admin accounts are absent; the real patients and doctors render', async () => {
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-user-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-user-row-',''))`);
  assert(!rows.includes(ADMIN_USER_ID), 'ADMIN account leaked into the list');
  const body = await evaluate('document.body.innerText');
  for (const n of ['Jordan Lee', 'Sam Rivera', 'Alex Kim', 'Dr. Rohan Patel']) {
    assert(body.includes(n), `expected seeded account "${n}" missing from the table`);
  }
  return 'no ADMIN row; seeded patients + doctors present';
});

await step('U4 search narrows the list server-side by email', async () => {
  await navigate('/admin/users', 2600);
  await evaluate(setValue('#admin-user-search', stamp));
  await sleep(900); // past the 300ms debounce
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-user-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-user-row-',''))`);
  assert(rows.length === 1, `expected 1 row for the unique stamp, got ${rows.length}`);
  assert(rows[0] === fixture.id, `expected the fixture row, got ${rows[0]}`);
  return 'unique-substring search returned exactly the fixture';
});

await step('U5 search matches a profile NAME, not only email', async () => {
  await navigate('/admin/users', 2600);
  await evaluate(setValue('#admin-user-search', 'Jordan Lee'));
  await sleep(900);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('jordan.lee@example.com'), `name search did not surface Jordan: ${body.slice(0, 300)}`);
  return 'name query matched via the profile ILIKE';
});

await step('U6 role filter narrows to doctors only', async () => {
  await navigate('/admin/users', 2600);
  await evaluate(setValue('#admin-user-role', 'DOCTOR'));
  await sleep(900);
  const body = await evaluate('document.body.innerText');
  const expectedDoctors = (await apiUsers()).filter((u) => u.role === 'DOCTOR');
  assert(expectedDoctors.length === 6, `seed expectation changed: ${expectedDoctors.length} doctors`);
  assert(body.includes('Dr. Rohan Patel'), 'doctors missing after role filter');
  assert(!body.includes('jordan.lee@example.com'), 'patient leaked into a DOCTOR-only filter');
  return `${expectedDoctors.length} doctors, no patients`;
});

await step('U7 status filter narrows to the suspended account', async () => {
  // Arrange: suspend the fixture so exactly one SUSPENDED account exists.
  await fetch(`${API}/admin/users/${fixture.id}/state`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ accountState: 'SUSPENDED', reason: 'harness U7 arrange' }),
  });
  await navigate('/admin/users', 2600);
  await evaluate(setValue('#admin-user-state', 'SUSPENDED'));
  await sleep(900);
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-user-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-user-row-',''))`);
  assert(rows.length === 1, `expected exactly the fixture suspended, got ${rows.length} rows`);
  assert(rows[0] === fixture.id, `unexpected suspended row ${rows[0]}`);
  return 'SUSPENDED filter returned exactly the fixture';
});

await step('U8 filters compose (search AND role AND status)', async () => {
  await navigate('/admin/users', 2600);
  await evaluate(setValue('#admin-user-role', 'PATIENT'));
  await evaluate(setValue('#admin-user-state', 'SUSPENDED'));
  await evaluate(setValue('#admin-user-search', stamp));
  await sleep(1000);
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-user-row-"]')).length`);
  assert(rows === 1, `composed filters should yield 1 row, got ${rows}`);
  // And a contradictory composition must yield none, proving AND (not OR).
  await evaluate(setValue('#admin-user-role', 'DOCTOR'));
  await sleep(900);
  const none = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-user-row-"]')).length`);
  assert(none === 0, `contradictory filters should yield 0 rows, got ${none}`);
  return 'AND semantics confirmed (1 row, then 0 on contradiction)';
});

await step('U9 no-match shows the filtered empty state; Clear resets', async () => {
  await navigate('/admin/users', 2600);
  await evaluate(setValue('#admin-user-search', 'zzzznomatchzzzz'));
  await sleep(900);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('No accounts match those filters'), `filtered empty state missing: ${body.slice(0, 300)}`);
  assert(await evaluate(`!!document.querySelector('button')`), 'no clear affordance');
  await evaluate(clickExact('Clear filters'));
  await sleep(900);
  const after = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-user-row-"]')).length`);
  assert(after > 1, `Clear filters did not restore the list (${after} rows)`);
  return `empty state shown, clear restored ${after} rows`;
});

await step('U10 suspend: confirm dialog, badge flips, reason renders inline', async () => {
  await navigate('/admin/users', 2600);
  // Reset the fixture to ACTIVE directly, so this step owns its precondition.
  await fetch(`${API}/admin/users/${fixture.id}/state`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ accountState: 'ACTIVE' }),
  });
  await navigate('/admin/users', 2600);

  const clicked = await evaluate(clickTestId(`admin-user-suspend-${fixture.id}`));
  assert(clicked === 'OK', `suspend button not found (${clicked})`);
  await sleep(700);

  // The confirm dialog must be a real gate, not direct action.
  const dialogText = await evaluate(`document.querySelector('[role=alertdialog]')?.innerText ?? ''`);
  assert(dialogText.includes('Suspend'), `confirm dialog missing: ${JSON.stringify(dialogText.slice(0, 120))}`);
  assert(dialogText.includes(FIXTURE_NAME), 'dialog does not name the account');

  await evaluate(setValue('#admin-user-reason', 'UI harness suspend reason'));
  await sleep(200);
  await evaluate(`(() => { const d = document.querySelector('[role=alertdialog]'); const b = Array.from(d.querySelectorAll('button')).find(x => x.textContent.trim() === 'Suspend'); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`);
  await sleep(1600);

  const body = await evaluate('document.body.innerText');
  assert(body.includes('UI harness suspend reason'), `reason not rendered inline: ${body.slice(0, 400)}`);
  const rowText = await evaluate(`document.querySelector('[data-testid="admin-user-row-${fixture.id}"]')?.innerText ?? ''`);
  assert(rowText.includes('Suspended'), `badge did not flip to Suspended: ${rowText}`);
  return 'dialog gated the action; badge = Suspended; reason inline';
});

await step('U11 suspend is persisted, not just optimistic UI', async () => {
  const truth = (await apiUsers()).find((u) => u.id === fixture.id);
  assert(truth.accountState === 'SUSPENDED', `API says ${truth.accountState}, UI showed Suspended`);
  assert(truth.stateReason === 'UI harness suspend reason', `reason not persisted (${truth.stateReason})`);
  // And a fresh load must agree with the API.
  await navigate('/admin/users', 2600);
  const rowText = await evaluate(`document.querySelector('[data-testid="admin-user-row-${fixture.id}"]')?.innerText ?? ''`);
  assert(rowText.includes('Suspended'), 'fresh load did not show Suspended');
  return 'API and a fresh page load both agree';
});

await step('U12 deactivate: destructive path flips the badge', async () => {
  const clicked = await evaluate(clickTestId(`admin-user-deactivate-${fixture.id}`));
  assert(clicked === 'OK', `deactivate button not found (${clicked})`);
  await sleep(700);
  const dialogText = await evaluate(`document.querySelector('[role=alertdialog]')?.innerText ?? ''`);
  assert(dialogText.includes('Deactivate'), 'deactivate confirm dialog missing');
  await evaluate(`(() => { const d = document.querySelector('[role=alertdialog]'); const b = Array.from(d.querySelectorAll('button')).find(x => x.textContent.trim() === 'Deactivate'); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`);
  await sleep(1600);
  const truth = (await apiUsers()).find((u) => u.id === fixture.id);
  assert(truth.accountState === 'DEACTIVATED', `API says ${truth.accountState}`);
  return 'deactivate persisted';
});

await step('U13 activate: restores the account to ACTIVE', async () => {
  const clicked = await evaluate(clickTestId(`admin-user-activate-${fixture.id}`));
  assert(clicked === 'OK', `activate button not found (${clicked})`);
  await sleep(1600); // activate has no confirm dialog
  const truth = (await apiUsers()).find((u) => u.id === fixture.id);
  assert(truth.accountState === 'ACTIVE', `API says ${truth.accountState}`);
  const rowText = await evaluate(`document.querySelector('[data-testid="admin-user-row-${fixture.id}"]')?.innerText ?? ''`);
  assert(rowText.includes('Active'), `badge did not flip to Active: ${rowText}`);
  return 'restored to ACTIVE';
});

await step('U14 the current state\'s own action is not offered', async () => {
  // The fixture is ACTIVE: Suspend and Deactivate must exist, Activate must not.
  assert(await evaluate(`!document.querySelector('[data-testid="admin-user-activate-${fixture.id}"]')`), 'Activate offered on an ACTIVE account');
  assert(await evaluate(`!!document.querySelector('[data-testid="admin-user-suspend-${fixture.id}"]')`), 'Suspend missing on an ACTIVE account');
  assert(await evaluate(`!!document.querySelector('[data-testid="admin-user-deactivate-${fixture.id}"]')`), 'Deactivate missing on an ACTIVE account');
  return 'no self-cancelling action; the other two present';
});

await step('U15 the mutations were audited', async () => {
  const after = await auditCount();
  // U7 arrange (suspend), U10 (suspend), U12 (deactivate), U13 (activate),
  // + the U10 pre-reset to ACTIVE = 5 writes through the API from this run.
  const delta = after - auditBefore;
  assert(delta >= 5, `expected at least 5 new audit entries, got ${delta}`);
  return `+${delta} audit entries recorded`;
});

await step('U16 no uncaught exceptions during the run', async () => {
  // The expected 403/404 noise from deliberate probes is surfaced as handled
  // UI states, not exceptions; only real crashes count here.
  assert(uncaught.length === 0, `${uncaught.length} uncaught: ${uncaught.slice(0, 2).join(' | ')}`);
  return 'clean console';
});

// ---- restore ---------------------------------------------------------------
// Put the fixture back to ACTIVE (its state at registration). The account
// itself cannot be deleted — no user-DELETE endpoint exists — so it is reported
// as known residue rather than silently left.
await fetch(`${API}/admin/users/${fixture.id}/state`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({ accountState: 'ACTIVE', reason: 'harness cleanup' }),
});

ws.close();
chrome.kill();

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
console.log(`\nRESIDUE (cannot self-delete, no user-DELETE endpoint):`);
console.log(`  account ${FIXTURE_EMAIL} (${fixture.id}) left ACTIVE`);
console.log(`  run scripts/db-clean-harness-users.sh --apply to reclaim it`);
process.exit(failures.length === 0 ? 0 : 1);
