// Layer 8 sub-item 2 — runtime verification of the ADMIN DOCTOR REVIEW UI.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the
// REAL frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
//   R1  /admin/doctors renders the real review table, not the placeholder
//   R2  every rendered row matches GET /admin/doctors exactly (by profile id)
//   R3  the seeded baseline mixes APPROVED / PENDING / REJECTED (6/1/1)
//   R4  search narrows server-side by name
//   R5  search also matches SPECIALIZATION (a different ILIKE branch)
//   R6  the status filter narrows to exactly the PENDING set the API reports
//       (no longer vacuous — the seed provides a PENDING doctor; see item 3)
//   R7  a fresh doctor registration arrives PENDING and does not appear in
//       patient-facing discovery yet
//   R8  approve: confirm dialog, badge flips, PERSISTED to the API
//   R9  discovery now RETURNS the approved doctor (the consequence is real)
//   R10 reject: confirm dialog, badge flips, persisted
//   R11 discovery DROPS the rejected doctor again
//   R12 reopen: no confirm dialog, returns to the pending queue
//   R13 edit: the dialog updates name/biography and PATCHes only changed fields
//   R14 the edit is persisted and round-trips through a fresh page load
//   R15 an unchanged form does not PATCH at all ("No changes to save")
//   R16 the current status's own action is absent from the row
//   R17 a blank name is refused client-side (no request sent)
//   R18 approval and edit are separate audit entries
//   R19 zero uncaught exceptions
//
// FIXTURE DISCIPLINE — this harness is B1 from the Layer 8 sub-item 2 plan, the
// first harness in the repo to CLEAN UP AFTER ITSELF rather than report residue:
//   - creates ONE throwaway doctor via POST /auth/register/doctor (arrives
//     PENDING, which is the state the queue exists to review);
//   - mutates ONLY that doctor;
//   - DELETES it by user id on exit, on the success path AND on the failure
//     path AND on SIGINT — see the finally/exit hooks at the bottom.
//
// Why a doctor and not a patient: the review queue MUTATES doctor profiles, so
// the only way to exercise approve/reject/reopen/edit end-to-end is to own a
// doctor whose state this run may change. The seed now also provides a PENDING
// and a REJECTED doctor (DEFERRED item 3), so the queue is no longer empty on a
// fresh database and the filter steps are no longer vacuous — but this harness
// must still create its own, because it cannot mutate a seeded account without
// leaving that account in a changed state.
//
// Deletion goes through SQL because there is NO user-DELETE endpoint (only
// Availability has one). It shells out to the same docker exec psql the cleanup
// script uses. Deletion is BY USER ID captured at registration, never by email
// pattern, so it can only ever remove the row this run created.
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9242; // 9226, 9231-9241 are taken by earlier harnesses.
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASS = 'AdminPass123!';

const stamp = Date.now();
const FIXTURE_EMAIL = `l8s2-${stamp}@example.com`;
const FIXTURE_NAME = `Dr. Harness ${stamp}`;
const FIXTURE_SPECIALIZATION = 'Dermatology';

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

// ---- fixture reclamation ---------------------------------------------------
// The whole point of B1. Registered account ids are collected here and removed
// on every exit path. `reclaimed` guards against double-deletion (the exit hook
// can fire after the happy-path cleanup).
let fixtureUserId = null;
let reclaimed = false;

function reclaimFixture(reason) {
  if (reclaimed || !fixtureUserId) return;
  reclaimed = true;
  console.log(`\n== Fixture cleanup (${reason}) ==`);
  // BY ID ONLY. Cascades User -> DoctorProfile -> Availability -> Appointment
  // -> ConsultationSession. Nothing else can match this predicate.
  const res = spawnSync(
    'docker',
    [
      'exec', 'telehealth-postgres', 'psql', '-U', 'telehealth', '-d', 'telehealth',
      '-c', `DELETE FROM "User" WHERE id = '${fixtureUserId}';`,
    ],
    { encoding: 'utf8' },
  );
  if (res.status === 0) {
    console.log(`  deleted fixture user ${fixtureUserId} (${FIXTURE_EMAIL})`);
  } else {
    console.log(`  DELETE FAILED (exit ${res.status}) — fixture ${fixtureUserId} may remain`);
    console.log(`  ${(res.stderr || '').trim().split('\n').slice(-2).join('\n  ')}`);
  }
}

// Failure path: a rejected promise or a thrown error anywhere above must still
// reclaim. `process.on('exit')` covers normal exit; SIGINT covers Ctrl-C.
process.on('exit', () => reclaimFixture('process exit'));
process.on('SIGINT', () => {
  reclaimFixture('SIGINT');
  process.exit(130);
});

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/chrome-l8s2-doctors`, 'about:blank'],
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
// Every PATCH body the page sends, so R13/R15 can prove what actually travelled.
const pendingRequests = new Map();
const sentPatches = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    uncaught.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Network.requestWillBeSent') {
    pendingRequests.set(m.params.requestId, {
      url: m.params.request.url,
      method: m.params.request.method,
      postData: m.params.request.postData ?? null,
    });
  }
  if (m.method === 'Network.loadingFinished') {
    const rec = pendingRequests.get(m.params.requestId);
    if (rec && rec.method === 'PATCH') sentPatches.push(rec);
    pendingRequests.delete(m.params.requestId);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const send = (method, params = {}) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
async function navigate(path, waitMs = 2200) { await send('Page.navigate', { url: `${BASE}${path}` }); await sleep(waitMs); }
await send('Network.enable');

const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'OK'; })()`;

// Click by data-testid, NOT by text-in-DOM-order. a513584's lesson: a text-based
// selector can match the wrong row (or nothing), and "nothing" silently turns an
// assertion into a no-op that passes.
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

const apiDoctors = async () => {
  const r = await fetch(`${API}/admin/doctors`, { headers: { Authorization: `Bearer ${adminToken}` } });
  return r.json();
};
const apiDoctor = async (profileId) => (await apiDoctors()).find((d) => d.id === profileId);

const auditCount = async () => {
  const r = await fetch(`${API}/admin/audit-logs`, { headers: { Authorization: `Bearer ${adminToken}` } });
  return (await r.json()).length;
};

// Patient-facing discovery, as a REAL signed-in patient — used to prove that
// approve/reject has a REAL consequence rather than only flipping a badge.
//
// Three things this must get right, each of which an earlier draft got wrong and
// which together would have made R7/R9/R11 pass VACUOUSLY:
//   1. GET /doctors is JwtAuthGuard-protected (any authenticated role), so an
//      anonymous call returns 401 — not an empty list, and not success.
//   2. The search param is `search`, NOT `q`. Passing `q` is silently ignored,
//      which returns the whole directory and makes "was it found?" meaningless.
//   3. It returns a BARE ARRAY, not a { data: [] } envelope.
// A non-200 or non-array response therefore THROWS rather than reading as
// "not found" — the failure mode this harness exists to avoid.
const PATIENT_EMAIL = 'jordan.lee@example.com';
const PATIENT_PASS = 'PatientPass123!';
const patientToken = await tokenFor(PATIENT_EMAIL, PATIENT_PASS);
assert(patientToken, 'patient login failed — discovery checks would be meaningless');

const discoveredByName = async (name) => {
  const r = await fetch(`${API}/doctors?search=${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${patientToken}` },
  });
  if (!r.ok) throw new Error(`discovery probe returned HTTP ${r.status}`);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error(`discovery did not return an array: ${typeof list}`);
  return list.some((d) => d.name === name);
};

const auditBefore = await auditCount();

// ---- fixture: register a throwaway doctor --------------------------------
await fetch(`${API}/auth/register/doctor`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: FIXTURE_EMAIL,
    password: 'FixturePass123!',
    name: FIXTURE_NAME,
    specialization: FIXTURE_SPECIALIZATION,
    biography: 'Created by the Layer 8 sub-item 2 harness; deleted on exit.',
  }),
});

const allDoctors = await apiDoctors();
const fixture = allDoctors.find((d) => d.user.email === FIXTURE_EMAIL);
assert(fixture, 'fixture doctor was not registered');
fixtureUserId = fixture.userId; // now reclaimable on any exit path

console.log(`\nLayer 8 sub-item 2 — admin doctor review UI`);
console.log(`Fixture: ${FIXTURE_EMAIL} (profile ${fixture.id}, user ${fixture.userId})\n`);

const landed = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
assert(landed === '/admin', `admin sign-in landed on ${landed}, expected /admin`);

await step('R1 /admin/doctors renders the real table, not the placeholder', async () => {
  await navigate('/admin/doctors', 2600);
  const body = await evaluate('document.body.innerText');
  assert(!body.includes('This screen is delivered in a later step'), 'placeholder still rendered');
  assert(await evaluate(`!!document.querySelector('#admin-doctor-search')`), 'search input missing');
  assert(await evaluate(`!!document.querySelector('#admin-doctor-status')`), 'status filter missing');
  return 'table + search + status filter present';
});

await step('R2 every rendered row matches GET /admin/doctors exactly (by profile id)', async () => {
  await navigate('/admin/doctors', 2600);
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-doctor-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-doctor-row-',''))`);
  const expected = (await apiDoctors()).map((d) => d.id).sort();
  assert(rows.length === expected.length, `rendered ${rows.length} rows, API has ${expected.length}`);
  const got = [...rows].sort();
  assert(JSON.stringify(got) === JSON.stringify(expected), `row ids differ from API:\n got=${got.join(',')}\n exp=${expected.join(',')}`);
  return `${rows.length} rows, profile ids identical to API`;
});

await step('R3 the seeded baseline mixes APPROVED / PENDING / REJECTED', async () => {
  // This step USED to assert "6 doctors, all APPROVED, so the pending queue is
  // empty apart from the fixture". That premise stopped being true when DEFERRED
  // item 3 was resolved: the seed now includes `dr.pending@example.com` and
  // `dr.rejected@example.com` so the review queue has content on a fresh seed,
  // rather than only after this harness has run.
  //
  // The assertion is now the honest version of the same question — what states
  // does the seed provide? — and it is deliberately an EQUALITY against the
  // live API rather than a hardcoded count, so it cannot silently rot into a
  // fixture-database assertion.
  const seeded = await apiDoctors();
  const seededNonFixture = seeded.filter((d) => d.user.email !== FIXTURE_EMAIL);
  const statuses = {};
  for (const d of seededNonFixture) statuses[d.approvalStatus] = (statuses[d.approvalStatus] || 0) + 1;

  assert(seededNonFixture.length === 8, `seed expectation changed: ${seededNonFixture.length} seeded doctors, expected 8`);
  assert(statuses.APPROVED === 6, `expected 6 APPROVED seeded doctors, got ${statuses.APPROVED}`);
  assert(statuses.PENDING === 1, `expected 1 PENDING seeded doctor, got ${statuses.PENDING}`);
  assert(statuses.REJECTED === 1, `expected 1 REJECTED seeded doctor, got ${statuses.REJECTED}`);

  // The named fixtures must be the ones carrying those states, so a future
  // reseed cannot satisfy the counts with different rows.
  const pending = seededNonFixture.find((d) => d.approvalStatus === 'PENDING');
  const rejected = seededNonFixture.find((d) => d.approvalStatus === 'REJECTED');
  assert(pending.user.email === 'dr.pending@example.com', `PENDING fixture is ${pending.user.email}`);
  assert(rejected.user.email === 'dr.rejected@example.com', `REJECTED fixture is ${rejected.user.email}`);

  return '8 seeded doctors — 6 APPROVED, 1 PENDING (dr.pending), 1 REJECTED (dr.rejected)';
});

await step('R4 search narrows the list server-side by name', async () => {
  await navigate('/admin/doctors', 2600);
  await evaluate(setValue('#admin-doctor-search', String(stamp)));
  await sleep(900);
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-doctor-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-doctor-row-',''))`);
  assert(rows.length === 1, `expected 1 row for the unique stamp, got ${rows.length}`);
  assert(rows[0] === fixture.id, `expected the fixture row, got ${rows[0]}`);
  return 'unique-substring name search returned exactly the fixture';
});

await step('R5 search also matches SPECIALIZATION (a different ILIKE branch)', async () => {
  await navigate('/admin/doctors', 2600);
  await evaluate(setValue('#admin-doctor-search', FIXTURE_SPECIALIZATION));
  await sleep(900);
  const body = await evaluate('document.body.innerText');
  assert(body.includes(FIXTURE_NAME), `specialization search did not surface the fixture: ${body.slice(0, 300)}`);
  // Dermatology is seeded once too, so a second row is expected — this proves
  // the branch matched specialization, not merely the fixture's own name.
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-doctor-row-"]')).length`);
  assert(rows >= 2, `specialization search returned ${rows} row(s); expected the fixture plus the seeded dermatologist`);
  return `${rows} rows matched "${FIXTURE_SPECIALIZATION}" via the specialization ILIKE`;
});

await step('R6 the status filter narrows to exactly the PENDING set', async () => {
  // NOTE: this step was VACUOUS before DEFERRED item 3 was resolved. The seed had
  // no PENDING doctor, so the PENDING filter's correct result was exactly the one
  // fixture this run created — "the filter works" and "the filter does nothing"
  // were indistinguishable. The seed now provides `dr.pending@example.com`, so
  // the filter must return that row AS WELL as the fixture, and the assertion
  // below compares against the API's own PENDING set rather than a literal.
  await navigate('/admin/doctors', 2600);
  await evaluate(setValue('#admin-doctor-status', 'PENDING'));
  await sleep(900);

  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-doctor-row-"]')).map(el => el.getAttribute('data-testid').replace('admin-doctor-row-',''))`);
  const expected = (await apiDoctors())
    .filter((d) => d.approvalStatus === 'PENDING')
    .map((d) => d.id)
    .sort();

  // The filter must actually discriminate: a minimum of 2 rows means it cannot
  // pass by returning a single hardcoded result.
  assert(expected.length >= 2, `expected the seed PENDING fixture plus this run's doctor, API reports ${expected.length}`);
  assert(rows.length === expected.length, `PENDING filter returned ${rows.length} row(s), API reports ${expected.length}`);
  const got = [...rows].sort();
  assert(JSON.stringify(got) === JSON.stringify(expected), `PENDING rows differ from API:\n got=${got.join(',')}\n exp=${expected.join(',')}`);
  assert(rows.includes(fixture.id), 'the fixture is missing from its own filtered result');

  const body = await evaluate('document.body.innerText');
  assert(body.includes('Pending review'), 'PENDING badge not labelled readably');
  return `${rows.length} PENDING rows (the seed fixture + this run's), badged "Pending review"`;
});

await step('R7 a pending doctor is NOT in patient-facing discovery yet', async () => {
  // The consequence-side precondition for R9: if it were already discoverable,
  // approving it would prove nothing.
  assert((await apiDoctor(fixture.id)).approvalStatus === 'PENDING', 'fixture is not pending');
  const found = await discoveredByName(FIXTURE_NAME);
  assert(found === false, 'a PENDING doctor is already discoverable — approve would prove nothing');
  return 'pending profile correctly hidden from discovery';
});

await step('R8 approve: confirm dialog, badge flips, PERSISTED to the API', async () => {
  await navigate('/admin/doctors', 2600);
  const clicked = await evaluate(clickTestId(`admin-doctor-approve-${fixture.id}`));
  assert(clicked === 'OK', `approve button not found (${clicked})`);
  await sleep(700);

  const dialogText = await evaluate(`document.querySelector('[role=alertdialog]')?.innerText ?? ''`);
  assert(dialogText.includes('Approve'), `confirm dialog missing: ${JSON.stringify(dialogText.slice(0, 120))}`);
  assert(dialogText.includes(FIXTURE_NAME), 'dialog does not name the doctor');
  assert(dialogText.includes('visible to patients'), 'dialog does not state the consequence');

  await evaluate(setValue('#admin-doctor-reason', 'Harness approve reason'));
  await sleep(200);
  await evaluate(`(() => { const d = document.querySelector('[role=alertdialog]'); const b = Array.from(d.querySelectorAll('button')).find(x => x.textContent.trim() === 'Approve'); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`);
  await sleep(1600);

  const truth = await apiDoctor(fixture.id);
  assert(truth.approvalStatus === 'APPROVED', `API says ${truth.approvalStatus}, UI showed Approved`);
  const rowText = await evaluate(`document.querySelector('[data-testid="admin-doctor-row-${fixture.id}"]')?.innerText ?? ''`);
  assert(rowText.includes('Approved'), `badge did not flip to Approved: ${rowText}`);
  return 'dialog gated it; API and badge both APPROVED';
});

await step('R9 discovery now RETURNS the approved doctor (the consequence is real)', async () => {
  const found = await discoveredByName(FIXTURE_NAME);
  assert(found === true, 'approved doctor still not discoverable — approval is not wired to discovery');
  return 'approved doctor is now visible to patients';
});

await step('R10 reject: confirm dialog, badge flips, persisted', async () => {
  await navigate('/admin/doctors', 2600);
  const clicked = await evaluate(clickTestId(`admin-doctor-reject-${fixture.id}`));
  assert(clicked === 'OK', `reject button not found (${clicked})`);
  await sleep(700);
  const dialogText = await evaluate(`document.querySelector('[role=alertdialog]')?.innerText ?? ''`);
  assert(dialogText.includes('Reject'), 'reject confirm dialog missing');
  assert(dialogText.includes('not appear in patient search'), 'dialog does not state the consequence');
  await evaluate(`(() => { const d = document.querySelector('[role=alertdialog]'); const b = Array.from(d.querySelectorAll('button')).find(x => x.textContent.trim() === 'Reject'); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`);
  await sleep(1600);
  const truth = await apiDoctor(fixture.id);
  assert(truth.approvalStatus === 'REJECTED', `API says ${truth.approvalStatus}`);
  const rowText = await evaluate(`document.querySelector('[data-testid="admin-doctor-row-${fixture.id}"]')?.innerText ?? ''`);
  assert(rowText.includes('Rejected'), `badge did not flip to Rejected: ${rowText}`);
  return 'API and badge both REJECTED';
});

await step('R11 discovery DROPS the rejected doctor again', async () => {
  const found = await discoveredByName(FIXTURE_NAME);
  assert(found === false, 'a REJECTED doctor is still discoverable');
  return 'rejected doctor removed from patient discovery';
});

await step('R12 reopen: no confirm dialog, returns to the pending queue', async () => {
  const clicked = await evaluate(clickTestId(`admin-doctor-reopen-${fixture.id}`));
  assert(clicked === 'OK', `reopen button not found (${clicked})`);
  await sleep(1600); // reopen is not confirmed — it must fire directly
  const dialogOpen = await evaluate(`!!document.querySelector('[role=alertdialog]')`);
  assert(dialogOpen === false, 'reopen prompted a confirmation it should not have');
  const truth = await apiDoctor(fixture.id);
  assert(truth.approvalStatus === 'PENDING', `API says ${truth.approvalStatus}`);
  return 'reopened to PENDING with no confirmation';
});

await step('R13 edit: the dialog PATCHes only changed fields', async () => {
  sentPatches.length = 0;
  await navigate('/admin/doctors', 2600);
  const opened = await evaluate(clickTestId(`admin-doctor-edit-${fixture.id}`));
  assert(opened === 'OK', `edit button not found (${opened})`);
  await sleep(700);

  const title = await evaluate(`document.querySelector('[role=dialog]')?.innerText ?? ''`);
  assert(title.includes('Update profile details'), `edit dialog missing: ${title.slice(0, 120)}`);
  // The form must be pre-filled from the real profile, not blank.
  const prefilled = await evaluate(`document.querySelector('#admin-doctor-name')?.value ?? ''`);
  assert(prefilled === FIXTURE_NAME, `name not pre-filled: ${JSON.stringify(prefilled)}`);

  // Change ONLY the biography, leaving name and specialization untouched.
  await evaluate(setValue('#admin-doctor-biography', 'Biography rewritten by the Layer 8 sub-item 2 harness.'));
  await evaluate(setValue('#admin-doctor-edit-reason', 'Harness edit reason'));
  await sleep(200);
  await evaluate(clickExact('Save changes', '[role=dialog] button'));
  await sleep(1800);

  assert(sentPatches.length === 1, `expected exactly 1 PATCH, saw ${sentPatches.length}`);
  const body = JSON.parse(sentPatches[0].postData);
  assert(typeof body.biography === 'string', 'biography absent from the patch');
  assert(body.name === undefined, `untouched name was sent: ${JSON.stringify(body.name)}`);
  assert(body.specialization === undefined, `untouched specialization was sent: ${JSON.stringify(body.specialization)}`);
  assert(body.approvalStatus === undefined, `approvalStatus was sent by the EDIT dialog: ${body.approvalStatus}`);
  return `PATCH carried only biography + reason (keys: ${Object.keys(body).join(', ')})`;
});

await step('R14 the edit is persisted and round-trips through a fresh load', async () => {
  const truth = await apiDoctor(fixture.id);
  assert(
    truth.biography === 'Biography rewritten by the Layer 8 sub-item 2 harness.',
    `biography not persisted (${truth.biography})`,
  );
  await navigate('/admin/doctors', 2600);
  await evaluate(setValue('#admin-doctor-search', String(stamp)));
  await sleep(900);
  const rowText = await evaluate(`document.querySelector('[data-testid="admin-doctor-row-${fixture.id}"]')?.innerText ?? ''`);
  assert(rowText.includes(FIXTURE_NAME), 'fixture row missing after the edit');
  return 'API and a fresh page load both agree';
});

await step('R15 an unchanged form does not PATCH at all ("No changes to save")', async () => {
  sentPatches.length = 0;
  const opened = await evaluate(clickTestId(`admin-doctor-edit-${fixture.id}`));
  assert(opened === 'OK', `edit button not found (${opened})`);
  await sleep(700);
  await evaluate(clickExact('Save changes', '[role=dialog] button'));
  await sleep(1400);
  assert(sentPatches.length === 0, `an unchanged form sent ${sentPatches.length} PATCH(es) — would be a 400`);
  // And the dialog should stay open, since nothing was saved.
  const stillOpen = await evaluate(`!!document.querySelector('[role=dialog]')`);
  assert(stillOpen === true, 'the dialog closed despite saving nothing');
  return '0 requests; no "No review fields provided" 400';
});

await step('R16 the current status\u2019s own action is absent from the row', async () => {
  // The fixture is PENDING here: Approve and Reject must exist, Reopen must not.
  assert(await evaluate(`!document.querySelector('[data-testid="admin-doctor-reopen-${fixture.id}"]')`), 'Reopen offered on a PENDING profile');
  assert(await evaluate(`!!document.querySelector('[data-testid="admin-doctor-approve-${fixture.id}"]')`), 'Approve missing on a PENDING profile');
  assert(await evaluate(`!!document.querySelector('[data-testid="admin-doctor-reject-${fixture.id}"]')`), 'Reject missing on a PENDING profile');
  return 'no self-cancelling action; the other two present';
});

await step('R17 a blank name is refused client-side (no request sent)', async () => {
  sentPatches.length = 0;
  await evaluate(`(() => { const b = Array.from(document.querySelectorAll('[role=dialog] button')).find(x => x.textContent.trim() === 'Cancel'); if (b) b.click(); return 'OK'; })()`);
  await sleep(500);
  const opened = await evaluate(clickTestId(`admin-doctor-edit-${fixture.id}`));
  assert(opened === 'OK', `edit button not found (${opened})`);
  await sleep(700);
  await evaluate(setValue('#admin-doctor-name', '')); // @IsNotEmpty server-side
  await evaluate(clickExact('Save changes', '[role=dialog] button'));
  await sleep(1400);
  assert(sentPatches.length === 0, `a blank name still sent ${sentPatches.length} PATCH(es)`);
  const dialogText = await evaluate(`document.querySelector('[role=dialog]')?.innerText ?? ''`);
  assert(dialogText.includes('Name cannot be empty'), `no field-level message shown: ${dialogText.slice(0, 200)}`);
  // Restore the name so the fixture stays coherent for the audit step.
  await evaluate(setValue('#admin-doctor-name', FIXTURE_NAME));
  await evaluate(`(() => { const b = Array.from(document.querySelectorAll('[role=dialog] button')).find(x => x.textContent.trim() === 'Cancel'); if (b) b.click(); return 'OK'; })()`);
  await sleep(400);
  return 'guarded before the request, with a field-level message';
});

await step('R18 approval and edit are separate audit entries', async () => {
  const after = await auditCount();
  // From this run: approve (R8), reject (R10), reopen (R12), edit (R13) = 4.
  const delta = after - auditBefore;
  assert(delta >= 4, `expected at least 4 new audit entries, got ${delta}`);
  return `+${delta} audit entries recorded`;
});

await step('R19 no uncaught exceptions during the run', async () => {
  assert(uncaught.length === 0, `${uncaught.length} uncaught: ${uncaught.slice(0, 2).join(' | ')}`);
  return 'clean console';
});

// ---- reclaim ---------------------------------------------------------------
ws.close();
chrome.kill();
reclaimFixture('happy path');

// Prove it is actually gone, rather than trusting the DELETE's exit code.
const straggler = (await apiDoctors()).find((d) => d.user.email === FIXTURE_EMAIL);
if (straggler) {
  console.log(`  WARNING: fixture ${FIXTURE_EMAIL} still present after cleanup`);
  reclaimed = false;
} else {
  console.log('  verified absent from GET /admin/doctors');
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
console.log('\nRESIDUE: none expected — this harness reclaims its own fixture.');
console.log('  Audit rows from the run are intentionally retained (the audit log is append-only).');
process.exit(failures.length === 0 ? 0 : 1);
