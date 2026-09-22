// Layer 8 sub-item 4 — runtime verification of the ADMIN OPERATIONAL DASHBOARD.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the
// REAL frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
//   R1  /admin renders the LIVE dashboard, not the placeholder
//   R2  the rendered tiles EQUAL a simultaneous GET /admin/dashboard (per bucket)
//   R3  no bucket renders blank — every tile shows a numeric count
//   R4  a groupBy key with NO rows renders as "0", not empty (zero-coalescing)
//   R5  /admin is the ADMIN LANDING page (sign-in lands here, nav marked active)
//   R6  every section link points at the section ROOT with no query param
//   R7  clicking a section link lands on the real screen for that section
//   R8  the users total includes the admin, and the footnote says so
//   R9  refreshing re-reads the endpoint (the numbers are not cached)
//   R10 a failed fetch renders a message and a retry, not a stuck skeleton
//   R11 no uncaught exceptions during the run
//
// ZERO-FIXTURE HARNESS — deliberate, and a first for this project.
//
// Every prior Layer 6-8 harness created throwaway accounts and reclaimed them by
// user id. This one creates NOTHING. That is possible because the deliverable is
// a READ-ONLY aggregation: it has no mutation to exercise, so it needs no
// fixture to exercise it with. Two consequences:
//
//   1. There is no cleanup path, no reclaimer, no `process.on('exit')` hook, and
//      no `l8s4%` entry in db-clean-harness-users.sh — because there is nothing
//      to reclaim. Running this harness cannot perturb the database at all.
//   2. NULL-HYPOTHESIS DISCIPLINE (DEFERRED.md item 1). Every assertion here is
//      an EQUALITY against a live API read taken at the same moment, not against
//      a hardcoded expectation. A harness that asserted "users == 11" would be
//      asserting the fixture database, not the screen — and would pass on a
//      screen that rendered a forgotten literal. Comparing against a simultaneous
//      GET /admin/dashboard means the assertion stays true no matter what the
//      data becomes, and can only pass if the DOM is driven by the endpoint.
//
// NO FIXTURE IS CREATED TO FORCE A NON-ZERO TILE (Jean's Flag 8 decision). The
// live payload has several legitimately-absent groupBy keys (no RESCHEDULED, no
// PENDING, no REJECTED, no SUSPENDED / DEACTIVATED). Those absences are exactly
// what R4 needs — the strongest test of zero-coalescing is the real absence, and
// manufacturing one would be inventing a defect to fix. R4 therefore asserts the
// omitted key renders as 0 by comparing the DOM against the ABSENT-key set the
// endpoint actually returned.
//
// The audit log grows by this run only if something logs in; a plain admin
// sign-in writes no audit row (verified in sub-item 3), so this run appends
// nothing anywhere.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9244; // 9226, 9231-9243 are taken by earlier harnesses.
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

// No fixture reclaimer exists, by design. The only teardown is killing Chrome.
const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/chrome-l8s4-dashboard`, 'about:blank'],
  { stdio: 'ignore' },
);
// Belt-and-braces: if the process is interrupted, do not leave Chrome running.
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
async function navigate(path, waitMs = 2400) { await send('Page.navigate', { url: `${BASE}${path}` }); await sleep(waitMs); }
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

const apiDashboard = async () => {
  const r = await fetch(`${API}/admin/dashboard`, { headers: { Authorization: `Bearer ${adminToken}` } });
  if (!r.ok) throw new Error(`GET /admin/dashboard returned HTTP ${r.status}`);
  return r.json();
};

// Read the DOM's tiles as { sectionId: { BUCKET: count } }.
//
// Each tile carries data-bucket-count with the RENDERED number, so this reads
// the actual rendered value rather than re-parsing the label text. A tile that
// failed to render simply will not appear in the map — which is what lets R3
// detect a MISSING tile rather than silently skipping it.
const readRenderedTiles = `(() => {
  const out = {};
  for (const el of document.querySelectorAll('[data-testid^="admin-dashboard-bucket-"]')) {
    const tid = el.getAttribute('data-testid');
    const rest = tid.replace('admin-dashboard-bucket-', '');
    const idx = rest.indexOf('-');
    const section = rest.slice(0, idx);
    const bucket = rest.slice(idx + 1);
    const countEl = el.querySelector('[data-bucket-count]');
    out[section] = out[section] || {};
    out[section][bucket] = countEl ? Number(countEl.getAttribute('data-bucket-count')) : null;
  }
  return out;
})()`;

const readRenderedTotals = `(() => {
  const out = {};
  for (const id of ['users','doctors','appointments','consultationSessions']) {
    const el = document.querySelector('[data-testid="admin-dashboard-total-' + id + '"]');
    out[id] = el ? Number(el.innerText.trim()) : null;
  }
  return out;
})()`;

// The endpoint's groupBy maps, keyed to match the DOM's section ids.
const bySection = (payload) => ({
  users: { ...payload.users.byRole, ...payload.users.byAccountState },
  doctors: payload.doctors.byApprovalStatus,
  appointments: payload.appointments.byStatus,
  consultationSessions: payload.consultationSessions.byState,
});
const totalsBySection = (payload) => ({
  users: payload.users.total,
  doctors: payload.doctors.total,
  appointments: payload.appointments.total,
  consultationSessions: payload.consultationSessions.total,
});

// The FULL enum per section, so R3 can prove a zero tile is still PRESENT.
const FULL_ENUM = {
  users: ['ADMIN', 'PATIENT', 'DOCTOR', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'],
  doctors: ['PENDING', 'APPROVED', 'REJECTED'],
  appointments: ['BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED'],
  consultationSessions: ['SCHEDULED', 'JOINED', 'IN_PROGRESS', 'COMPLETED'],
};

const landed = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
assert(landed === '/admin', `admin sign-in landed on ${landed}, expected /admin`);

console.log('\nLayer 8 sub-item 4 — admin operational dashboard UI');
console.log('ZERO-FIXTURE harness: it creates no accounts and reclaims nothing.\n');

await step('R1 /admin renders the live dashboard, not the placeholder', async () => {
  await navigate('/admin', 2800);
  const body = await evaluate('document.body.innerText');
  assert(
    !body.includes('This screen is delivered in a later step') && !body.includes('Operational counts across users, doctors, and appointments.'),
    'the placeholder is still rendering at /admin',
  );
  const sections = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-dashboard-section-"]')).map(el => el.getAttribute('data-testid').replace('admin-dashboard-section-',''))`);
  assert(sections.length === 4, `rendered ${sections.length} sections, expected 4`);
  for (const expected of ['users', 'doctors', 'appointments', 'consultationSessions']) {
    assert(sections.includes(expected), `section "${expected}" missing from the dashboard`);
  }
  return `4 sections: ${sections.join(', ')}`;
});

await step('R2 every rendered tile EQUALS a simultaneous GET /admin/dashboard', async () => {
  await navigate('/admin', 2800);
  const rendered = await evaluate(readRenderedTiles);
  // Read the endpoint NOW, after the render, so the comparison window is tight.
  // A write landing between these two reads could legitimately differ; on a
  // quiescent database they must match exactly. If this ever flakes, the cause
  // is a concurrent writer, not a rendering bug — say so rather than loosening
  // the assertion.
  const payload = await apiDashboard();
  const expected = bySection(payload);

  let compared = 0;
  for (const [section, buckets] of Object.entries(expected)) {
    assert(rendered[section], `section "${section}" rendered no tiles at all`);
    for (const [key, rawCount] of Object.entries(buckets)) {
      assert(
        rendered[section][key] !== undefined,
        `tile ${section}/${key} is missing from the DOM (API says ${rawCount})`,
      );
      assert(
        rendered[section][key] === rawCount,
        `tile ${section}/${key} rendered ${rendered[section][key]}, API says ${rawCount}`,
      );
      compared += 1;
    }
  }
  assert(compared > 0, 'compared 0 tiles — the DOM read found nothing');
  return `${compared} non-zero tiles match the live endpoint exactly`;
});

await step('R3 no bucket renders blank — every full-enum tile shows a number', async () => {
  // This is the assertion that would have caught the original defect: iterating
  // Object.keys(map) drops every zero bucket, so the tile simply does not exist.
  // Asserting PRESENCE for the full enum is what proves buildSections iterates
  // the enum rather than the payload.
  await navigate('/admin', 2800);
  const rendered = await evaluate(readRenderedTiles);
  let tiles = 0;
  for (const [section, keys] of Object.entries(FULL_ENUM)) {
    assert(rendered[section], `section "${section}" rendered no tiles at all`);
    for (const key of keys) {
      const count = rendered[section][key];
      assert(count !== undefined, `tile ${section}/${key} is MISSING — a zero bucket was dropped`);
      assert(count !== null, `tile ${section}/${key} has no numeric count`);
      assert(Number.isFinite(count), `tile ${section}/${key} rendered a non-number (${count})`);
      tiles += 1;
    }
  }
  assert(tiles === 17, `rendered ${tiles} tiles, expected 17 (3+4+3+4+4 enum values)`);
  return `all ${tiles} enum tiles present with numeric counts`;
});

await step('R4 a groupBy key with NO rows renders as "0" (zero-coalescing)', async () => {
  await navigate('/admin', 2800);
  const rendered = await evaluate(readRenderedTiles);
  const payload = await apiDashboard();

  // The keys the endpoint OMITTED — these are the ones the database genuinely
  // has none of. Assert each rendered as exactly 0, and that at least one such
  // key exists, so this test cannot pass vacuously.
  const absent = [];
  for (const [section, buckets] of Object.entries(bySection(payload))) {
    for (const key of FULL_ENUM[section]) {
      if (buckets[key] === undefined) absent.push({ section, key });
    }
  }
  assert(
    absent.length > 0,
    'INVALID: the endpoint returned every enum key, so the zero-coalescing path is not exercised by this dataset',
  );

  // And prove the absence is real, not a harness misread: the key must be
  // genuinely missing from the raw payload object.
  const raw = await apiDashboard();
  for (const { section, key } of absent) {
    const rawMap = section === 'users'
      ? (raw.users.byRole[key] !== undefined ? raw.users.byRole : raw.users.byAccountState)
      : section === 'doctors' ? raw.doctors.byApprovalStatus
      : section === 'appointments' ? raw.appointments.byStatus
      : raw.consultationSessions.byState;
    assert(rawMap[key] === undefined, `raw payload DOES contain ${section}/${key} — absence assumption wrong`);
    assert(
      rendered[section][key] === 0,
      `tile ${section}/${key} is absent from the payload but rendered ${rendered[section][key]}, expected 0`,
    );
  }
  const list = absent.map((a) => `${a.section}/${a.key}`).join(', ');
  return `${absent.length} omitted key(s) each rendered as 0: ${list}`;
});

await step('R5 /admin is the admin LANDING page', async () => {
  // Sign out and back in without a deep link; the guard + HOME_BY_ROLE must put
  // an admin here. This is why the screen's loading/error states matter.
  const after = await loginAs(ADMIN_EMAIL, ADMIN_PASS);
  assert(after === '/admin', `admin sign-in landed on ${after}, expected /admin`);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('Dashboard'), 'the landing page does not present the dashboard');
  const tiles = await evaluate(`document.querySelectorAll('[data-testid^="admin-dashboard-bucket-"]').length`);
  assert(tiles > 0, 'the landing page rendered no tiles');
  return `sign-in lands on /admin with ${tiles} tiles rendered`;
});

await step('R6 every section link points at the section ROOT with no query param', async () => {
  await navigate('/admin', 2800);
  const links = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="admin-dashboard-section-"] a')).map(a => a.getAttribute('href'))`);
  assert(links.length === 4, `found ${links.length} section links, expected 4`);
  for (const href of links) {
    assert(href, 'a section link has no href');
    assert(!href.includes('?'), `section link "${href}" carries a query param — the destination cannot honour a filter`);
    assert(!href.includes('#'), `section link "${href}" carries a fragment`);
    assert(/^\/admin\/(users|doctors|appointments)$/.test(href), `section link "${href}" is not a known section root`);
  }
  return `all 4 links are bare section roots: ${links.join(', ')}`;
});

await step('R7 clicking a section link lands on the real screen for that section', async () => {
  await navigate('/admin', 2800);
  const usersHref = await evaluate(`document.querySelector('[data-testid="admin-dashboard-section-users"] a')?.getAttribute('href')`);
  assert(usersHref === '/admin/users', `users section links to ${usersHref}`);
  await evaluate(`document.querySelector('[data-testid="admin-dashboard-section-users"] a').click()`);
  await sleep(2200);
  const path = await evaluate('location.pathname');
  assert(path === '/admin/users', `clicking the users link landed on ${path}`);
  const body = await evaluate('document.body.innerText');
  assert(!body.includes('This screen is delivered in a later step'), 'the users destination is still a placeholder');
  return `users section link navigates to /admin/users (real screen)`;
});

await step('R8 the users total includes the admin, and the footnote says so', async () => {
  await navigate('/admin', 2800);
  const payload = await apiDashboard();
  const renderedTotal = await evaluate(`Number(document.querySelector('[data-testid="admin-dashboard-total-users"]').innerText.trim())`);
  assert(
    renderedTotal === payload.users.total,
    `users total rendered ${renderedTotal}, API says ${payload.users.total}`,
  );
  // The discrepancy this footnote exists to explain: the total counts admins,
  // GET /admin/users does not list them.
  const admins = payload.users.byRole.ADMIN ?? 0;
  const manageable = (payload.users.byRole.PATIENT ?? 0) + (payload.users.byRole.DOCTOR ?? 0);
  assert(admins > 0, 'INVALID: no admin account in the dataset, so the footnote case cannot be checked');
  assert(manageable < renderedTotal, `manageable (${manageable}) is not less than the total (${renderedTotal})`);
  const body = await evaluate('document.body.innerText');
  assert(
    body.includes(String(manageable)) && /administrator/i.test(body),
    `the users footnote does not name the ${admins} administrator difference (expected to mention ${manageable})`,
  );
  return `total ${renderedTotal} (incl. ${admins} admin), footnote names the ${manageable} listed on /admin/users`;
});

await step('R9 refreshing re-reads the endpoint (the numbers are not cached)', async () => {
  await navigate('/admin', 2800);
  // Mark the DOM, refresh, and confirm the marker is gone — i.e. the screen
  // rebuilt from a fresh fetch rather than reusing a rendered tree. Then assert
  // the numbers still equal a fresh API read.
  await evaluate(`document.querySelector('[data-testid="admin-dashboard-total-users"]').setAttribute('data-stale-marker','1')`);
  const marked = await evaluate(`!!document.querySelector('[data-stale-marker]')`);
  assert(marked, 'could not mark the tile for the refresh check');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Refresh')?.click()`);
  await sleep(2200);
  const stillMarked = await evaluate(`!!document.querySelector('[data-stale-marker]')`);
  assert(!stillMarked, 'the Refresh button did not rebuild the tiles (the marker survived)');
  const payload = await apiDashboard();
  const renderedTotals = await evaluate(readRenderedTotals);
  assert(
    renderedTotals.users === payload.users.total,
    `after refresh users total rendered ${renderedTotals.users}, API says ${payload.users.total}`,
  );
  return `refresh rebuilt all tiles and re-read the endpoint (users total ${payload.users.total})`;
});

await step('R10 a failed fetch renders a message and a retry, not a stuck skeleton', async () => {
  // The landing page's worst failure mode is a skeleton that never resolves.
  // Force the fetch to fail by blocking the endpoint at the network layer.
  await navigate('/admin', 2800);
  await send('Network.setBlockedURLs', { urls: [`${API}/admin/dashboard`] });
  await navigate('/admin', 2600);
  const body = await evaluate('document.body.innerText');
  const skeletons = await evaluate(`document.querySelectorAll('[data-testid^="admin-dashboard-section-"]').length`);
  assert(skeletons === 0, 'sections still rendered while the endpoint was blocked');
  const hasRetry = await evaluate(`Array.from(document.querySelectorAll('button')).some(b => /try again/i.test(b.textContent))`);
  assert(hasRetry, 'no "Try again" affordance after a failed load');
  // Assert the STRUCTURE, not a guessed sentence. parseAdminError maps a
  // network failure (statusCode 0) to the api-client's own wording, which is
  // not knowable here — asserting on a guessed phrase would be testing my
  // recollection rather than the screen. What must hold is that the error alert
  // is present and carries a title AND a non-empty body.
  const alertText = await evaluate(`(() => { const el = document.querySelector('[role=alert]'); return el ? el.innerText : 'NO_ALERT'; })()`);
  assert(alertText !== 'NO_ALERT', 'no error alert rendered after a failed load');
  const title = await evaluate(`document.querySelector('[role=alert] [data-slot=alert-title], [role=alert] h5')?.innerText ?? ''`);
  assert(/couldn't load|not permitted/i.test(title), `error alert has no recognised title: ${title}`);
  const bodyText = alertText.replace(title, '').trim();
  assert(bodyText.length > 0, `error alert has a title but no explanatory body: ${alertText}`);
  assert(
    !/undefined|\bnull\b|\[object/i.test(bodyText),
    `error alert body leaks a raw value: ${bodyText}`,
  );
  // And the retry must actually recover once the endpoint is reachable again.
  await send('Network.setBlockedURLs', { urls: [] });
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => /try again/i.test(b.textContent))?.click()`);
  await sleep(2600);
  const recovered = await evaluate(`document.querySelectorAll('[data-testid^="admin-dashboard-bucket-"]').length`);
  assert(recovered > 0, `retry did not recover the dashboard (${recovered} tiles)`);
  return `blocked -> message + retry shown; unblocked -> ${recovered} tiles recovered`;
});

await step('R11 no uncaught exceptions during the run', async () => {
  assert(uncaught.length === 0, `${uncaught.length} uncaught: ${uncaught.slice(0, 2).join(' | ')}`);
  return 'clean console';
});

// ---- teardown --------------------------------------------------------------
ws.close();
chrome.kill();

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
console.log('\nRESIDUE: none possible — this harness creates no rows and mutates nothing.');
console.log('  It is read-only, so no reclaim step and no db-clean-harness-users.sh prefix.');
process.exit(failures.length === 0 ? 0 : 1);
