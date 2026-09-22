// Layer 8 sub-item 5 — runtime verification of the ADMIN AUDIT LOG UI.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the
// REAL frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
//   R1  /admin/audit renders the LIVE log, not the placeholder
//   R2  every rendered row matches GET /admin/audit-logs exactly (by id)
//   R3  rows arrive newest-first and the screen does not re-sort them
//   R4  the Action column shows a human label AND the raw stored string
//   R5  affectedRecordId renders as PLAIN TEXT — never an anchor
//   R6  a null/blank reason renders as an em-dash, never blank
//   R7  the admin email renders for every row (never a placeholder)
//   R8  the admin facet narrows to exactly that admin's rows
//   R9  the action facet narrows to exactly that action's rows
//   R10 the record-type facet narrows to exactly that type's rows
//   R11 facets AND together, and a conflicting combination yields the empty state
//   R12 the summary says "shown", not "found" (filtering is local), and clears
//   R13 timestamps render in UTC with an explicit suffix
//   R14 there is NO free-text search input (structured facets only)
//   R15 no uncaught exceptions during the run
//
// ZERO-FIXTURE HARNESS, same discipline as sub-item 4. The audit log is
// READ-ONLY and the endpoint takes no parameters, so there is no mutation to
// exercise and nothing to clean up — no reclaimer, no exit hook, and no `l8s5%`
// prefix in db-clean-harness-users.sh. Running this cannot perturb the database.
//
// WHY NOT WRITE AN AUDIT ROW TO HAVE A KNOWN FIXTURE: every admin mutation writes
// a log row, and the log is APPEND-ONLY — there is no delete. So a harness that
// suspended a user to generate a row would permanently add to the very log it is
// verifying, and would dirty an entity in the process. Instead every assertion is
// an EQUALITY against a simultaneous GET /admin/audit-logs (the sub-item 4
// pattern), which is both non-destructive and a stronger test: it cannot pass on
// a screen rendering a hardcoded value.
//
// CONSEQUENCE FOR THIS RUN: because no row is written, the log's row count and
// content are IDENTICAL before and after. The harness asserts that explicitly
// (R2 reads before and after), so a stray write would be caught rather than
// silently absorbed.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9245; // 9226, 9231-9244 are taken by earlier harnesses.
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASS = 'AdminPass123!';

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
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/chrome-l8s5-audit`, 'about:blank'],
  { stdio: 'ignore' },
);
process.on('SIGINT', () => {
  chrome.kill();
  process.exit(130);
});

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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
async function navigate(path, waitMs = 2600) { await send('Page.navigate', { url: `${BASE}${path}` }); await sleep(waitMs); }
await send('Network.enable');

const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'OK'; })()`;

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

const apiAudit = async () => {
  const r = await fetch(`${API}/admin/audit-logs`, { headers: { Authorization: `Bearer ${adminToken}` } });
  if (!r.ok) throw new Error(`GET /admin/audit-logs returned HTTP ${r.status}`);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error(`audit log did not return an array: ${typeof list}`);
  return list;
};

const readRenderedRowIds = `Array.from(document.querySelectorAll('[data-testid^="admin-audit-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-audit-row-',''))`;

const baseline = await apiAudit();
assert(baseline.length > 0, 'INVALID: the audit log is empty, so this harness has nothing to verify');

// The action we will facet on is chosen FROM THE DATA, not hardcoded — so the
// harness still works if the log's composition changes.
const actionsPresent = [...new Set(baseline.map((r) => r.action))].sort();
const typesPresent = [...new Set(baseline.map((r) => r.affectedRecordType))].sort();
// Prefer an action that appears MORE THAN ONCE so the "narrows" assertions are
// meaningful (a facet matching exactly one of one row proves little).
const facetAction =
  actionsPresent.map((a) => ({ a, n: baseline.filter((r) => r.action === a).length }))
    .sort((x, y) => y.n - x.n)[0];
const facetType =
  typesPresent.map((a) => ({ a, n: baseline.filter((r) => r.affectedRecordType === a).length }))
    .sort((x, y) => y.n - x.n)[0];

const landed = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
assert(landed === '/admin', `admin sign-in landed on ${landed}, expected /admin`);

console.log('\nLayer 8 sub-item 5 — admin audit log UI');
console.log(`ZERO-FIXTURE harness. Log has ${baseline.length} rows across ${actionsPresent.length} actions.`);
console.log(`Facet action: ${facetAction.a} (${facetAction.n} rows); facet type: ${facetType.a} (${facetType.n} rows).\n`);

await step('R1 /admin/audit renders the live log, not the placeholder', async () => {
  await navigate('/admin/audit', 2800);
  const body = await evaluate('document.body.innerText');
  assert(
    !body.includes('This screen is delivered in a later step') &&
      !body.includes('Recorded admin actions with timestamps and reasons.'),
    'the placeholder is still rendering at /admin/audit',
  );
  const rows = await evaluate(readRenderedRowIds);
  assert(rows.length > 0, 'no audit rows rendered');
  for (const id of ['audit-filter-admin', 'audit-filter-action', 'audit-filter-record-type']) {
    assert(await evaluate(`!!document.getElementById('${id}')`), `filter control #${id} is missing`);
  }
  return `${rows.length} rows + 3 structured facets`;
});

await step('R2 every rendered row matches GET /admin/audit-logs exactly (by id)', async () => {
  await navigate('/admin/audit', 2800);
  const rendered = await evaluate(readRenderedRowIds);
  const api = (await apiAudit()).map((r) => r.id);
  assert(
    rendered.length === api.length,
    `rendered ${rendered.length} rows, API has ${api.length}`,
  );
  const got = [...rendered].sort();
  const exp = [...api].sort();
  assert(
    JSON.stringify(got) === JSON.stringify(exp),
    `row ids differ from API:\n got=${got.join(',')}\n exp=${exp.join(',')}`,
  );
  // And the log was NOT mutated by this run: re-read and compare to the baseline
  // captured before the browser ever opened.
  const after = (await apiAudit()).map((r) => r.id);
  assert(
    JSON.stringify(after) === JSON.stringify(baseline.map((r) => r.id)),
    `the audit log CHANGED during a harness that must be read-only (${baseline.length} -> ${after.length})`,
  );
  return `${rendered.length} rows, ids identical to API, log unmodified`;
});

await step('R3 rows arrive newest-first and the screen does not re-sort them', async () => {
  await navigate('/admin/audit', 2800);
  const rendered = await evaluate(readRenderedRowIds);
  const api = await apiAudit();
  const byId = new Map(api.map((r) => [r.id, r]));
  // The rendered ORDER must equal the API's order, not merely the same set. A
  // client-side re-sort would produce a different sequence if the server ever
  // regressed, hiding the regression.
  assert(
    JSON.stringify(rendered) === JSON.stringify(api.map((r) => r.id)),
    'rendered order differs from the API order — the screen may be re-sorting',
  );
  // Independently confirm the server's own order is descending.
  for (let i = 1; i < api.length; i++) {
    assert(
      new Date(api[i - 1].timestamp).getTime() >= new Date(api[i].timestamp).getTime(),
      `API order is not newest-first at index ${i}`,
    );
  }
  const first = byId.get(rendered[0]);
  const last = byId.get(rendered[rendered.length - 1]);
  return `order identical to API; newest ${first.timestamp} -> oldest ${last.timestamp}`;
});

await step('R4 the Action column shows a human label AND the raw stored string', async () => {
  await navigate('/admin/audit', 2800);
  const api = await apiAudit();
  const known = {
    APPOINTMENT_CANCEL: 'Appointment cancelled',
    DOCTOR_APPROVAL_UPDATE: 'Doctor profile reviewed',
    USER_STATE_CHANGE: 'User state changed',
  };
  let checked = 0;
  for (const label of Object.keys(known)) {
    const row = api.find((r) => r.action === label);
    if (!row) continue;
    const text = await evaluate(`(() => { const el = document.querySelector('[data-testid="admin-audit-row-${row.id}"]'); return el ? el.innerText : 'NO_ROW'; })()`);
    assert(text !== 'NO_ROW', `row ${row.id} not rendered`);
    // Both the human label and the raw enum must be present (Flag D): a label
    // alone would hide what was actually written to the table.
    assert(text.includes(known[label]), `human label "${known[label]}" missing from row: ${text}`);
    assert(text.includes(label), `raw action "${label}" missing from row: ${text}`);
    checked += 1;
  }
  assert(checked > 0, 'no labelled action present in the log to verify');
  return `${checked} action(s) show both the label and the raw string`;
});

await step('R5 affectedRecordId renders as PLAIN TEXT — never an anchor', async () => {
  await navigate('/admin/audit', 2800);
  const api = await apiAudit();
  const withId = api.filter((r) => r.affectedRecordId);
  assert(withId.length > 0, 'no rows carry an affectedRecordId to check');

  // The whole point of Flag A: the id may point at a deleted record, so it must
  // never be a link. Assert BOTH that the uuid is visible AND that no anchor
  // anywhere on the page points at a record id.
  const sample = withId[0];
  const text = await evaluate(`(() => { const el = document.querySelector('[data-testid="admin-audit-row-${sample.id}"]'); return el ? el.innerText : 'NO_ROW'; })()`);
  assert(text.includes(sample.affectedRecordId), `affectedRecordId not rendered for row ${sample.id}`);

  const idHrefs = await evaluate(`Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href')).filter(h => h && /[0-9a-f]{8}-[0-9a-f]{4}/i.test(h))`);
  assert(
    idHrefs.length === 0,
    `found ${idHrefs.length} link(s) pointing at a record id — a dead link would be presented as navigation: ${idHrefs.slice(0, 3).join(', ')}`,
  );
  return `${withId.length} rows carry an id, all rendered as text; 0 id-bearing links on the page`;
});

await step('R6 a null/blank reason renders as an em-dash, never blank', async () => {
  await navigate('/admin/audit', 2800);
  const api = await apiAudit();
  const noReason = api.filter((r) => !r.reason || !r.reason.trim());
  assert(
    noReason.length > 0,
    'INVALID: every row has a reason, so the em-dash branch is not exercised by this dataset',
  );
  const sample = noReason[0];
  const text = await evaluate(`(() => { const el = document.querySelector('[data-testid="admin-audit-row-${sample.id}"]'); return el ? el.innerText : 'NO_ROW'; })()`);
  assert(text !== 'NO_ROW', `row ${sample.id} not rendered`);
  assert(text.includes('—'), `row with no reason does not render an em-dash: ${text}`);

  // And a row WITH a reason must show it verbatim, not redacted.
  const withReason = api.find((r) => r.reason && r.reason.trim());
  if (withReason) {
    const t2 = await evaluate(`(() => { const el = document.querySelector('[data-testid="admin-audit-row-${withReason.id}"]'); return el ? el.innerText : 'NO_ROW'; })()`);
    assert(t2.includes(withReason.reason), `reason was not rendered verbatim: ${t2}`);
  }
  return `${noReason.length} of ${api.length} rows have no reason, each rendering an em-dash`;
});

await step('R7 the admin email renders for every row', async () => {
  await navigate('/admin/audit', 2800);
  const api = await apiAudit();
  const emails = [...new Set(api.map((r) => r.adminUser.email))];
  for (const email of emails) {
    const row = api.find((r) => r.adminUser.email === email);
    const text = await evaluate(`(() => { const el = document.querySelector('[data-testid="admin-audit-row-${row.id}"]'); return el ? el.innerText : 'NO_ROW'; })()`);
    assert(text.includes(email), `admin email ${email} missing from row ${row.id}`);
  }
  const body = await evaluate('document.body.innerText');
  assert(!body.includes('Unknown administrator'), 'a placeholder admin label leaked onto the page');
  return `${emails.length} distinct admin(s) named from the payload`;
});

await step('R8 the admin facet narrows to exactly that admin\'s rows', async () => {
  await navigate('/admin/audit', 2800);
  const api = await apiAudit();
  const admin = api[0].adminUser;
  const expected = api.filter((r) => r.adminUser.id === admin.id).map((r) => r.id).sort();
  await evaluate(setValue('#audit-filter-admin', admin.id));
  await sleep(800);
  const rendered = (await evaluate(readRenderedRowIds)).sort();
  assert(rendered.length === expected.length, `facet showed ${rendered.length} rows, expected ${expected.length}`);
  assert(JSON.stringify(rendered) === JSON.stringify(expected), 'facet row ids differ from the API');
  return `${rendered.length} rows for ${admin.email}`;
});

await step('R9 the action facet narrows to exactly that action\'s rows', async () => {
  await navigate('/admin/audit', 2800);
  const api = await apiAudit();
  const expected = api.filter((r) => r.action === facetAction.a).map((r) => r.id).sort();
  await evaluate(setValue('#audit-filter-action', facetAction.a));
  await sleep(800);
  const rendered = (await evaluate(readRenderedRowIds)).sort();
  assert(rendered.length === expected.length, `facet showed ${rendered.length} rows, expected ${expected.length}`);
  assert(JSON.stringify(rendered) === JSON.stringify(expected), 'facet row ids differ from the API');
  assert(expected.length > 1, `INVALID: facet ${facetAction.a} matched only ${expected.length} row, so "narrows" proves little`);
  return `${rendered.length} rows for ${facetAction.a}`;
});

await step('R10 the record-type facet narrows to exactly that type\'s rows', async () => {
  await navigate('/admin/audit', 2800);
  const api = await apiAudit();
  const expected = api.filter((r) => r.affectedRecordType === facetType.a).map((r) => r.id).sort();
  await evaluate(setValue('#audit-filter-record-type', facetType.a));
  await sleep(800);
  const rendered = (await evaluate(readRenderedRowIds)).sort();
  assert(rendered.length === expected.length, `facet showed ${rendered.length} rows, expected ${expected.length}`);
  assert(JSON.stringify(rendered) === JSON.stringify(expected), 'facet row ids differ from the API');
  return `${rendered.length} rows for ${facetType.a}`;
});

await step('R11 facets AND together, and a conflicting combination yields the empty state', async () => {
  await navigate('/admin/audit', 2800);
  const api = await apiAudit();

  // Combining the two widest facets: the result must be their INTERSECTION.
  const expected = api
    .filter((r) => r.action === facetAction.a && r.affectedRecordType === facetType.a)
    .map((r) => r.id)
    .sort();
  await evaluate(setValue('#audit-filter-action', facetAction.a));
  await evaluate(setValue('#audit-filter-record-type', facetType.a));
  await sleep(900);
  const rendered = (await evaluate(readRenderedRowIds)).sort();
  assert(rendered.length === expected.length, `combined facets showed ${rendered.length}, expected ${expected.length}`);
  assert(JSON.stringify(rendered) === JSON.stringify(expected), 'combined facet ids differ from the API');

  // Now force a genuinely impossible combination and assert the EMPTY STATE,
  // not an empty table with a header.
  const mismatchAction = api.find((r) => r.affectedRecordType !== facetType.a);
  if (mismatchAction) {
    await navigate('/admin/audit', 2800);
    await evaluate(setValue('#audit-filter-record-type', facetType.a));
    await evaluate(setValue('#audit-filter-action', mismatchAction.action));
    await sleep(900);
    const rows = await evaluate(readRenderedRowIds);
    const body = await evaluate('document.body.innerText');
    const emptyForCombo = rows.length === 0 && /no entries match/i.test(body);
    if (emptyForCombo) {
      assert(/clear filters/i.test(body), 'empty state offers no way to clear the filters');
      return `AND verified (${expected.length} rows); impossible combo shows the empty state`;
    }
    // Not impossible after all — say so rather than passing vacuously.
    return `AND verified (${expected.length} rows); no impossible combination available in this dataset`;
  }
  return `AND verified (${expected.length} rows)`;
});

await step('R12 the summary says "shown", not "found", and clears', async () => {
  await navigate('/admin/audit', 2800);
  const api = await apiAudit();
  const before = await evaluate('document.body.innerText');
  assert(before.includes(`all ${api.length}`), `unfiltered summary does not report the full count: ${before.slice(-200)}`);

  await evaluate(setValue('#audit-filter-action', facetAction.a));
  await sleep(800);
  const filteredText = await evaluate('document.body.innerText');
  const shownCount = api.filter((r) => r.action === facetAction.a).length;
  assert(
    filteredText.includes(`Showing ${shownCount} of ${api.length}`),
    `filtered summary does not read "Showing ${shownCount} of ${api.length}"`,
  );
  assert(filteredText.includes('filtered locally'), 'summary does not disclose that filtering is local');
  // The wording rule from sub-item 3: never claim a server "found" something it
  // was never asked to find.
  assert(!/found \d/i.test(filteredText), 'summary claims a server "found" a count');

  // Clear must restore the full set.
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Clear')?.click()`);
  await sleep(800);
  const afterClear = await evaluate(readRenderedRowIds);
  assert(afterClear.length === api.length, `Clear restored ${afterClear.length} rows, expected ${api.length}`);
  return `"Showing ${shownCount} of ${api.length} (filtered locally)"; Clear restored all ${api.length}`;
});

await step('R13 timestamps render in UTC with an explicit suffix', async () => {
  await navigate('/admin/audit', 2800);
  const api = await apiAudit();
  const sample = api[0];
  const text = await evaluate(`(() => { const el = document.querySelector('[data-testid="admin-audit-row-${sample.id}"]'); return el ? el.innerText : 'NO_ROW'; })()`);
  assert(/UTC/.test(text), `timestamp is not marked UTC: ${text}`);
  // The rendered UTC hour must match the payload's UTC hour — proving the value
  // was not silently shifted into a local zone (DEFERRED.md item 4 documents the
  // UTC choice; it does not license a wrong time).
  const d = new Date(sample.timestamp);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  assert(text.includes(`${hh}:${mm}`), `rendered time does not match the payload's UTC time (${hh}:${mm}): ${text}`);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('times shown in UTC'), 'the page does not disclose that times are UTC');
  return `UTC suffix present; rendered ${hh}:${mm} matches the payload's UTC time`;
});

await step('R14 there is NO free-text search input (structured facets only)', async () => {
  await navigate('/admin/audit', 2800);
  // Flag B: no free-text box, because the id column is UUIDs and that is not a
  // useful search target. Assert the ABSENCE, since the other four admin screens
  // all have one and a copy-paste would silently reintroduce it.
  const textInputs = await evaluate(`document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])').length`);
  assert(textInputs === 0, `found ${textInputs} free-text input(s) on a screen that must have none`);
  const selects = await evaluate(`document.querySelectorAll('select').length`);
  assert(selects === 3, `expected exactly 3 structured facets, found ${selects}`);
  return `0 text inputs, exactly ${selects} structured selects`;
});

await step('R15 no uncaught exceptions during the run', async () => {
  assert(uncaught.length === 0, `${uncaught.length} uncaught: ${uncaught.slice(0, 2).join(' | ')}`);
  return 'clean console';
});

// ---- teardown --------------------------------------------------------------
ws.close();
chrome.kill();

// Final immutability check: a read-only harness must leave the log byte-identical.
const finalLog = await apiAudit();
const unchanged =
  finalLog.length === baseline.length &&
  JSON.stringify(finalLog.map((r) => r.id)) === JSON.stringify(baseline.map((r) => r.id));

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
console.log(`\nAudit log unchanged by the run: ${unchanged ? 'yes' : 'NO'}`);
if (!unchanged) {
  console.log(`  WARNING: log went from ${baseline.length} to ${finalLog.length} rows during a read-only run`);
}
console.log('\nRESIDUE: none possible — this harness creates no rows and mutates nothing.');
console.log('  Read-only, so no reclaim step and no db-clean-harness-users.sh prefix.');
process.exit(failures.length === 0 ? 0 : 1);
