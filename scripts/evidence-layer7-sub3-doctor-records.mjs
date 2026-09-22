// Layer 7 sub-item 3 — runtime verification of the DOCTOR PATIENT RECORDS screens.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the REAL
// frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
// Checks:
//   R1  /doctor/patients renders the real list (not the placeholder)
//   R2  the patient list matches the API-derived truth EXACTLY (not a sample)
//   R3  a patient row links to /doctor/patients/<profileId> and the id in the
//       URL is one the SERVER put on the doctor's own feed
//   R4  the records screen renders every consultation the API returned
//   R5  EVERY note's findings/recommendations text appears verbatim (not a sample)
//   R6  EVERY prescription's details text appears verbatim
//   R7  an upcoming (JOINED) consultation is shown but withholds clinical content
//       and says so in domain terms (not "no notes were recorded")
//   R8  state badges reflect the API's states
//   R9  SCOPING: a doctor with NO appointment with a patient gets 403 from the API
//   R10 SCOPING: the UI surfaces that 403 as a specific, non-generic message
//   R11 search filters the list case-insensitively
//   R12 no cross-patient leak: patient B's records never appear on A's screen
//   R13 zero uncaught exceptions across the run
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9239;
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/chrome-l7-s3-records', 'about:blank'],
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
const recordCalls = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    uncaught.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Network.requestWillBeSent') {
    const url = m.params.request.url;
    if (url.includes('/consultations/records/patient/')) recordCalls.push(url);
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
const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'OK'; })()`;
const clickByText = (txt, sel = 'button, a') => `(() => { const b = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find(b => b.textContent.trim() === ${JSON.stringify(txt)}); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`;

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

const results = [];
async function step(name, fn) { try { results.push(`PASS  ${name}  ->  ${await fn()}`); } catch (e) { results.push(`FAIL  ${name}  ->  ${e.message}`); } }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

const DOC_EMAIL = 'dr.patel@example.com';
const DOC_PASS = 'DoctorPass123!';
const token = await tokenFor(DOC_EMAIL, DOC_PASS);
const auth = { Authorization: `Bearer ${token}` };

// ---- API-derived truth ----------------------------------------------------
const appts = await (await fetch(`${API}/appointments/me`, { headers: auth })).json();
const byPatient = new Map();
for (const a of appts) {
  if (!a.patientProfile) continue;
  if (!byPatient.has(a.patientProfile.id)) byPatient.set(a.patientProfile.id, { name: a.patientProfile.name, appts: [] });
  byPatient.get(a.patientProfile.id).appts.push(a);
}
console.log(`doctor: ${DOC_EMAIL}`);
console.log(`appointments: ${appts.length}, distinct patients: ${byPatient.size}`);
for (const [pid, v] of byPatient) console.log(`  patient ${v.name} (${pid}) — ${v.appts.length} appt(s)`);
console.log('');

// Primary patient = the one with the most appointments (Jordan Lee, has a
// COMPLETED session with notes AND a JOINED upcoming one — exercises both render
// paths in a single screen).
const primary = [...byPatient.entries()].sort((a, b) => b[1].appts.length - a[1].appts.length)[0];
const PRIMARY_ID = primary[0];
const PRIMARY_NAME = primary[1].name;
const primaryRecords = await (await fetch(`${API}/consultations/records/patient/${PRIMARY_ID}`, { headers: auth })).json();
const readableRecords = primaryRecords.filter((r) => r.state === 'COMPLETED' || r.state === 'IN_PROGRESS');
const allNotes = readableRecords.flatMap((r) => r.notes);
const allRx = readableRecords.flatMap((r) => r.prescriptions);
console.log(`primary patient: ${PRIMARY_NAME} (${PRIMARY_ID})`);
console.log(`records: ${primaryRecords.length} (states: ${primaryRecords.map((r) => r.state).join(', ')})`);
console.log(`notes: ${allNotes.length}, prescriptions: ${allRx.length}\n`);

await loginAs(DOC_EMAIL, DOC_PASS);

await step('R1 /doctor/patients renders the real list, not the placeholder', async () => {
  await navigate('/doctor/patients', 2800);
  const body = await evaluate('document.body.innerText');
  // Structural, not textual: the placeholder had "Patients" + "Your patients and
  // their records." as its title/description, so those strings prove nothing.
  assert(body.includes(`${byPatient.size} patient`), `patient-count badge missing; body=${body.slice(0, 300)}`);
  assert(body.includes('Search patients by name') || await evaluate('!!document.querySelector("#patient-search")'), 'search input missing');
  return `real list rendered, count badge present`;
});

await step('R2 patient list matches API truth exactly', async () => {
  const rows = await evaluate(`Array.from(document.querySelectorAll('main ul li')).map(li => li.innerText)`);
  const joined = rows.join('\n');
  for (const [, v] of byPatient) {
    assert(joined.includes(v.name), `patient "${v.name}" from API missing in UI. rows=${JSON.stringify(rows)}`);
  }
  // And no extra names: every rendered name must be a known patient.
  const known = new Set([...byPatient.values()].map((v) => v.name));
  const hrefs = await evaluate(`Array.from(document.querySelectorAll('main ul li a[href^="/doctor/patients/"]')).map(a => a.getAttribute('href'))`);
  assert(hrefs.length === byPatient.size, `expected ${byPatient.size} record links, got ${hrefs.length}`);
  for (const h of hrefs) {
    const pid = h.split('/').pop();
    assert(byPatient.has(pid), `link points at unknown patient id ${pid}`);
  }
  return `${byPatient.size} patients, all matching API; ${hrefs.length} record links all server-issued ids`;
});

await step('R3 row link carries a server-issued id', async () => {
  // NOTE: `Button asChild` renders a plain <a>, NOT a <button>. An earlier
  // version searched `a.innerText.includes(name)`, but the patient name lives in
  // a sibling <p> inside the same <li>, not inside the anchor — so the anchor's
  // own innerText is just "View records" and the match returned null. Match at
  // the li level, then read its anchor.
  const href = await evaluate(`(() => {
    const li = Array.from(document.querySelectorAll('main li')).find(l => l.innerText.includes(${JSON.stringify(PRIMARY_NAME)}));
    if (!li) return 'NO_LI';
    const a = li.querySelector('a[href^="/doctor/patients/"]');
    return a ? a.getAttribute('href') : 'NO_A';
  })()`);
  assert(href === `/doctor/patients/${PRIMARY_ID}`, `expected link to primary patient, got ${href}`);
  return `href=${href}`;
});

await step('R4 records screen renders every consultation the API returned', async () => {
  recordCalls.length = 0;
  await navigate(`/doctor/patients/${PRIMARY_ID}`, 2800);
  assert(recordCalls.some((u) => u.includes(`/consultations/records/patient/${PRIMARY_ID}`)), `screen did not call the records endpoint; calls=${JSON.stringify(recordCalls)}`);
  const body = await evaluate('document.body.innerText');
  assert(body.includes(`${primaryRecords.length} consultation`), `expected "${primaryRecords.length} consultation" in summary; body=${body.slice(0, 400)}`);
  for (const r of primaryRecords) {
    assert(body.includes(r.state === 'COMPLETED' ? 'Completed' : r.state === 'IN_PROGRESS' ? 'In progress' : r.state === 'JOINED' ? 'Waiting' : 'Scheduled'), `state badge for ${r.state} missing`);
  }
  return `called endpoint; ${primaryRecords.length} consultations, all state badges present`;
});

await step('R5 EVERY note text appears verbatim', async () => {
  const body = await evaluate('document.body.innerText');
  assert(allNotes.length > 0, 'fixture precondition: expected at least one note from the API');
  for (const n of allNotes) {
    if (n.findings) assert(body.includes(n.findings), `note findings missing verbatim: ${JSON.stringify(n.findings.slice(0, 60))}`);
    if (n.recommendations) assert(body.includes(n.recommendations), `note recommendations missing verbatim: ${JSON.stringify(n.recommendations.slice(0, 60))}`);
  }
  return `${allNotes.length} notes, every findings/recommendations string present verbatim`;
});

await step('R6 EVERY prescription text appears verbatim', async () => {
  const body = await evaluate('document.body.innerText');
  assert(allRx.length > 0, 'fixture precondition: expected at least one prescription from the API');
  for (const rx of allRx) {
    assert(body.includes(rx.details), `prescription missing verbatim: ${JSON.stringify(rx.details.slice(0, 60))}`);
  }
  return `${allRx.length} prescriptions, every details string present verbatim`;
});

await step('R7 upcoming consultation shown but withholds content, worded in domain terms', async () => {
  const upcoming = primaryRecords.filter((r) => r.state !== 'COMPLETED' && r.state !== 'IN_PROGRESS');
  if (upcoming.length === 0) return 'SKIP: no non-readable consultation in fixture';
  const body = await evaluate('document.body.innerText');
  assert(body.includes('has not started') || body.includes('waiting to open'), 'upcoming session explanatory copy missing');
  // The lie we must NOT tell: claiming nothing was recorded for a session that
  // has not happened yet.
  const unreadable = upcoming.filter((r) => r.notes.length === 0 && r.prescriptions.length === 0);
  assert(unreadable.length === upcoming.length, 'API unexpectedly returned content for an unreadable state');
  // Count how many "no notes recorded" strings there are vs readable-empty ones.
  const noContent = (body.match(/No notes or prescriptions were recorded/g) || []).length;
  const notStarted = (body.match(/has not started|waiting to open/g) || []).length;
  assert(notStarted >= upcoming.length, `expected >= ${upcoming.length} "not started/waiting" messages, found ${notStarted}`);
  return `${upcoming.length} upcoming (${upcoming.map((r) => r.state).join(',')}) shown with withheld content; ${notStarted} explanatory messages; ${noContent} genuine empty-record messages`;
});

await step('R8 state badges reflect API states', async () => {
  // NOTE (three wrong selectors before this one): the records cards are not <li>,
  // and `<Badge>` renders a <div> — NOT a <span>. Selecting 'span' therefore
  // returned only the sidebar chrome (9 nodes, 0 inside <main>) and the check was
  // vacuous. Select the badge's own class instead, which is what a real badge is.
  const BADGE = '[class*="rounded-full"][class*="px-2.5"]';
  const badges = await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(BADGE)})).map(s => s.innerText.trim()).filter(Boolean)`);
  const states = new Set(primaryRecords.map((r) => r.state));
  const labelOf = (s) => ({ COMPLETED: 'Completed', IN_PROGRESS: 'In progress', JOINED: 'Waiting', SCHEDULED: 'Scheduled' }[s]);
  const LABELS = ['Scheduled', 'In progress', 'Waiting', 'Completed'];

  // Precondition: the selector must actually find this screen's badges. Without
  // this, a selector that matches nothing would let every check below pass by
  // absence — which is exactly the trap the 'span' version fell into.
  const stateBadgeCount = badges.filter((b) => LABELS.includes(b)).length;
  assert(stateBadgeCount > 0, `selector found no state badges at all; badges=${JSON.stringify(badges)}`);

  for (const s of states) {
    assert(badges.includes(labelOf(s)), `badge "${labelOf(s)}" missing; badges=${JSON.stringify(badges)}`);
  }
  // Negative control: a state NO record has must not be shown.
  const absent = LABELS.filter((l) => ![...states].some((s) => labelOf(s) === l));
  for (const l of absent) {
    assert(!badges.includes(l), `badge "${l}" present but no record has that state; badges=${JSON.stringify(badges)}`);
  }
  // Exactly one badge per record.
  const total = LABELS.reduce((n, l) => n + badges.filter((b) => b === l).length, 0);
  assert(total === primaryRecords.length, `expected ${primaryRecords.length} state badges, found ${total}; badges=${JSON.stringify(badges)}`);
  return `${total} badges for ${primaryRecords.length} records (states ${[...states].join(', ')}); absent states absent`;
});

await step('R9 SCOPING: a doctor with no appointment with the patient gets 403', async () => {
  // dr.chen shares no patient with dr.patel in the seed. Use the id from
  // dr.patel's OWN feed and ask as dr.chen — a real cross-doctor attempt.
  const chenToken = await tokenFor('dr.chen@example.com', 'DoctorPass123!');
  const res = await fetch(`${API}/consultations/records/patient/${PRIMARY_ID}`, {
    headers: { Authorization: `Bearer ${chenToken}` },
  });
  const body = await res.json();
  assert(res.status === 403, `expected 403 for unrelated doctor, got ${res.status} ${JSON.stringify(body)}`);
  assert(/no appointments with this patient/i.test(body.message), `unexpected 403 message: ${body.message}`);
  return `403 + "${body.message}"`;
});

await step('R10 UI surfaces the 403 as specific, not generic copy', async () => {
  // Prove it through the UI by logging in as the OTHER doctor and visiting the
  // same URL — exactly what a shared/guessed link would do.
  await loginAs('dr.chen@example.com', 'DoctorPass123!');
  await navigate(`/doctor/patients/${PRIMARY_ID}`, 2800);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('No appointments with this patient'), `specific 403 heading missing; body=${body.slice(0, 400)}`);
  assert(body.includes('Back to patients'), 'recovery link missing');
  // The patient's actual clinical content must NOT have leaked.
  for (const n of allNotes) {
    if (n.findings) assert(!body.includes(n.findings), `LEAK: unrelated doctor saw note findings ${JSON.stringify(n.findings.slice(0, 40))}`);
  }
  return `specific heading shown; 0/${allNotes.length} note texts leaked to unrelated doctor`;
});

await step('R11 search filters case-insensitively', async () => {
  await loginAs(DOC_EMAIL, DOC_PASS);
  await navigate('/doctor/patients', 2800);
  const before = await evaluate(`document.querySelectorAll('main ul li').length`);
  await evaluate(setValue('#patient-search', PRIMARY_NAME.toUpperCase()));
  await sleep(600);
  const after = await evaluate(`Array.from(document.querySelectorAll('main ul li')).map(li => li.innerText).join('\\n')`);
  assert(after.includes(PRIMARY_NAME), `uppercase query did not match: ${after.slice(0, 200)}`);
  await evaluate(setValue('#patient-search', 'zzzznomatchzzzz'));
  await sleep(600);
  const empty = await evaluate('document.body.innerText');
  assert(empty.includes('No patients match'), `no-match state missing; body=${empty.slice(0, 300)}`);
  await evaluate(setValue('#patient-search', ''));
  await sleep(600);
  const restored = await evaluate(`document.querySelectorAll('main ul li').length`);
  assert(restored === before, `clearing search did not restore list: ${restored} vs ${before}`);
  return `${before} rows -> uppercase match -> no-match state -> ${restored} rows restored`;
});

await step('R12 no cross-patient leak on the primary screen', async () => {
  await navigate(`/doctor/patients/${PRIMARY_ID}`, 2800);
  const body = await evaluate('document.body.innerText');
  // Every other patient's name must be absent from this patient's records view.
  for (const [pid, v] of byPatient) {
    if (pid === PRIMARY_ID) continue;
    assert(!body.includes(v.name), `LEAK: other patient "${v.name}" appears on ${PRIMARY_NAME}'s records screen`);
  }
  // And their clinical text must not appear either: check the OTHER patients'
  // records via the API and assert none of their note text leaked.
  let otherNoteText = 0;
  for (const [pid] of byPatient) {
    if (pid === PRIMARY_ID) continue;
    const recs = await (await fetch(`${API}/consultations/records/patient/${pid}`, { headers: auth })).json();
    for (const r of recs) {
      for (const n of r.notes) {
        if (n.findings) { otherNoteText++; assert(!body.includes(n.findings), `LEAK: ${v?.name ?? pid} note text on primary screen`); }
      }
    }
  }
  return `0 patient-name leaks; 0/${otherNoteText} foreign note texts leaked`;
});

await step('R13 zero uncaught exceptions', async () => {
  const real = uncaught.filter((u) => !/ResizeObserver loop|ERR_ABORTED/.test(u));
  assert(real.length === 0, `uncaught: ${JSON.stringify(real.slice(0, 3))}`);
  return `${uncaught.length} raw, 0 unexpected`;
});

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
console.log(`records endpoint calls observed: ${recordCalls.length}`);
chrome.kill();
process.exit(failed ? 1 : 0);
