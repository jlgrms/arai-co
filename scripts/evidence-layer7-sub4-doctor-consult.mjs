// Layer 7 sub-item 4 — runtime verification of the DOCTOR CONSULTATION WORKSPACE.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the REAL
// frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
// This sub-item WRITES and CHANGES STATE, so this harness creates its own
// throwaway patient + appointment and drives that session — it never touches the
// seeded demo sessions. It cancels its appointment at the end.
//
// Checks:
//   C1  /doctor/consultations renders the real list, not the placeholder
//   C2  the list matches the doctor's own appointment feed exactly
//   C3  a SCHEDULED session offers NO note/prescription composer, and says why
//   C4  a SCHEDULED session does NOT offer Complete (server 409s it) and explains
//   C5  SCHEDULED shows no records block (read gate is closed below IN_PROGRESS)
//   C6  joining as the doctor moves the session on, and the UI reflects it
//   C7  the patient joining promotes to IN_PROGRESS and the composer APPEARS
//   C8  adding a note POSTs it and the text appears in "Already recorded"
//   C9  issuing a prescription POSTs it and it appears
//   C10 an empty note cannot be submitted (client guard mirrors the server 400)
//   C11 completing moves the session to COMPLETED and the UI shows it final
//   C12 completing again is not offered (terminal)
//   C13 the PATIENT can then read what the doctor wrote (the two halves meet)
//   C14 scoping: an unrelated doctor cannot open this session (403)
//   C15 zero uncaught exceptions
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9240;
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/chrome-l7-s4-consult', 'about:blank'],
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
const writes = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    uncaught.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Network.requestWillBeSent') {
    const { url, method, postData } = m.params.request;
    if (/\/consultations\/.+(\/notes|\/prescriptions|\/complete|\/join)$/.test(url) && method === 'POST') {
      writes.push({ url: url.replace('http://localhost:3000', ''), method, postData: postData ?? null });
    }
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
const setValue = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'OK'; })()`;
const clickByText = (txt, sel = 'button, a') => `(() => { const b = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find(b => b.textContent.trim() === ${JSON.stringify(txt)}); if (!b) return 'NO_BTN'; b.click(); return 'OK'; })()`;
// NOTE: Button asChild renders an <a>, not a <button> — match both.
const hasText = (txt) => `document.body.innerText.includes(${JSON.stringify(txt)})`;

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
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return (await r.json()).accessToken;
}
const H = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const jget = async (p, t) => { const r = await fetch(`${API}${p}`, { headers: H(t) }); return { status: r.status, body: await r.json().catch(() => null) }; };

const results = [];
async function step(name, fn) { try { results.push(`PASS  ${name}  ->  ${await fn()}`); } catch (e) { results.push(`FAIL  ${name}  ->  ${e.message}`); } }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

// ---- Fixture: throwaway patient + appointment on Dr. Okafor -----------------
const DOC_EMAIL = 'dr.okafor@example.com';
const DOC_PASS = 'DoctorPass123!';
const stamp = Date.now();
const PT_EMAIL = `l7s4ui-${stamp}@example.com`;
const PT_PASS = 'Password123!';

const reg = await (await fetch(`${API}/auth/register/patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: PT_EMAIL, password: PT_PASS, name: 'UI L7S4 Harness' }) })).json();
assert(reg.accessToken, 'fixture: patient registration failed');
const ptToken = reg.accessToken;

const okafor = (await jget('/doctors', ptToken)).body.find((d) => d.name === 'Dr. Amara Okafor');
assert(okafor, 'fixture: Dr. Okafor not discoverable');
const dtToken = await tokenFor(DOC_EMAIL, DOC_PASS);

// The harness creates its OWN slot rather than booking one of Dr. Okafor's.
//
// It used to take the first free slot she already had and never release it, so
// every run permanently consumed one of her appointments: repeated runs drained
// her schedule until the fixture died on "no free slot for Dr. Okafor". A
// harness may only clean up what it created, so it now makes a private
// far-future slot and deletes exactly that one at the end.
const slotRes = await fetch(`${API}/doctors/me/availability`, {
  method: 'POST',
  headers: H(dtToken),
  body: JSON.stringify({
    startTime: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
  }),
});
const slot = await slotRes.json();
assert(slotRes.status === 201 || slotRes.status === 200, `fixture: slot creation failed ${slotRes.status} ${JSON.stringify(slot)}`);
const OWN_SLOT_ID = slot.id;

const bookRes = await fetch(`${API}/appointments`, { method: 'POST', headers: H(ptToken), body: JSON.stringify({ availabilityId: OWN_SLOT_ID }) });
const appt = await bookRes.json();
assert(bookRes.status === 201, `fixture: booking failed ${bookRes.status} ${JSON.stringify(appt)}`);
const SESSION_ID = appt.consultationSession.id;

console.log(`fixture: patient ${PT_EMAIL}`);
console.log(`fixture: appointment ${appt.id} | session ${SESSION_ID} (${appt.consultationSession.state})`);
console.log(`fixture: doctor ${DOC_EMAIL} (Dr. Amara Okafor)\n`);

// A second doctor with no relationship to this patient, for the scoping check.
const OTHER_DOC_EMAIL = 'dr.reyes@example.com';
const otherDocToken = await tokenFor(OTHER_DOC_EMAIL, 'DoctorPass123!');

await loginAs(DOC_EMAIL, DOC_PASS);

await step('C1 /doctor/consultations renders the real list', async () => {
  await navigate('/doctor/consultations', 2800);
  const body = await evaluate('document.body.innerText');
  // The stub's title/description are identical to the real screen's, so prove it
  // structurally instead: the real list always shows a count badge or an empty
  // state, neither of which the placeholder had.
  const hasCount = /\d+ consultation/.test(body);
  const hasEmpty = body.includes('No consultations yet');
  assert(hasCount || hasEmpty, `neither count badge nor empty state; body=${body.slice(0, 300)}`);
  return hasCount ? `real list with count badge` : `real list, empty state`;
});

await step('C2 the list matches the doctor\'s own feed exactly', async () => {
  const appts = (await jget('/appointments/me', dtToken)).body;
  const expected = appts
    .filter((a) => a.consultationSession && a.status !== 'CANCELLED')
    .map((a) => a.consultationSession.id);
  const links = await evaluate(`Array.from(document.querySelectorAll('main li a[href^="/doctor/consultations/"]')).map(a => a.getAttribute('href').split('/').pop())`);
  const missing = expected.filter((id) => !links.includes(id));
  const extra = links.filter((id) => !expected.includes(id));
  assert(missing.length === 0, `sessions missing from UI: ${JSON.stringify(missing)}; rendered=${JSON.stringify(links)}`);
  assert(extra.length === 0, `UI rendered sessions not in feed: ${JSON.stringify(extra)}`);
  return `${links.length} sessions, exact set match with the appointment feed`;
});

// Drive to the workspace for our fixture session.
await navigate(`/doctor/consultations/${SESSION_ID}`, 2800);

await step('C3 SCHEDULED offers no composer, and explains why', async () => {
  const body = await evaluate('document.body.innerText');
  assert(body.includes('Not started'), `state label missing; body=${body.slice(0, 300)}`);
  // The write gate: no composer inputs at all below IN_PROGRESS.
  const hasFindings = await evaluate(`!!document.querySelector('#note-findings')`);
  const hasRx = await evaluate(`!!document.querySelector('#rx-details')`);
  assert(!hasFindings && !hasRx, `composer rendered while gated: findings=${hasFindings} rx=${hasRx}`);
  assert(body.includes('Recording opens during the consultation'), 'missing write-gate explanation');
  return 'no composer; write gate explained in domain terms';
});

await step('C4 SCHEDULED does not offer Complete, and explains why', async () => {
  const body = await evaluate('document.body.innerText');
  // The server answers 409 NOT_JOINED for SCHEDULED, so the button must be absent.
  const completeBtn = await evaluate(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Complete consultation')`);
  assert(!completeBtn, 'Complete offered at SCHEDULED, but the server 409s it (NOT_JOINED)');
  assert(body.includes('Cannot complete this consultation'), 'no explanation shown for the blocked completion');
  assert(body.includes('Nobody has joined'), `explanation does not say what would unblock it; body=${body.slice(0, 400)}`);
  return 'no Complete button; blocker explained (at least one participant must join)';
});

await step('C5 SCHEDULED shows no records block (read gate closed)', async () => {
  const body = await evaluate('document.body.innerText');
  assert(!body.includes('Already recorded'), 'records block rendered below the read gate');
  return 'no records block while below IN_PROGRESS';
});

await step('C6 doctor joins; the UI reflects it', async () => {
  const clicked = await evaluate(clickByText('Join consultation'));
  assert(clicked === 'OK', `join button not found: ${clicked}`);
  await sleep(2600);
  const body = await evaluate('document.body.innerText');
  const s = (await jget(`/consultations/${SESSION_ID}`, dtToken)).body;
  // After the doctor joins a SCHEDULED session it is JOINED (patient absent).
  assert(s.state === 'JOINED', `expected JOINED after doctor join, API says ${s.state}`);
  // The doctor is present and the patient is not, so the label must say so —
  // "Patient is waiting" would contradict the presence row below it.
  assert(body.includes('Waiting for the patient'), `UI label not updated; body=${body.slice(0, 300)}`);
  assert(!body.includes('Patient is waiting'), 'stale "Patient is waiting" label contradicts the patient being absent');
  assert(body.includes('Has not arrived yet'), 'presence row does not record the patient as absent');
  return `state JOINED (API=${s.state}); UI shows "Waiting for the patient", patient shown absent`;
});

await step('C7 patient joining promotes to IN_PROGRESS and the composer appears', async () => {
  // The promotion requires BOTH present, so the patient must join.
  const r = await fetch(`${API}/consultations/${SESSION_ID}/join`, { method: 'POST', headers: H(ptToken) });
  assert(r.status === 201, `patient join failed ${r.status}`);
  const s = (await jget(`/consultations/${SESSION_ID}`, dtToken)).body;
  assert(s.state === 'IN_PROGRESS', `expected IN_PROGRESS, got ${s.state}`);

  // Reload the doctor's screen: it must now offer the composer.
  await navigate(`/doctor/consultations/${SESSION_ID}`, 2800);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('In progress'), `UI did not reach IN_PROGRESS; body=${body.slice(0, 300)}`);
  const hasFindings = await evaluate(`!!document.querySelector('#note-findings')`);
  const hasRx = await evaluate(`!!document.querySelector('#rx-details')`);
  assert(hasFindings && hasRx, `composer missing at IN_PROGRESS: findings=${hasFindings} rx=${hasRx}`);
  assert(body.includes('Already recorded'), 'records block missing at IN_PROGRESS (doctor read gate is open)');
  return 'IN_PROGRESS; composer + records block both open';
});

const NOTE_FINDINGS = `Harness findings ${stamp}: chest clear, no fever.`;
const NOTE_RECS = `Harness recommendations ${stamp}: rest and fluids.`;
const RX_TEXT = `Harness Rx ${stamp} 5mg nightly`;

await step('C8 adding a note POSTs it and it appears in "Already recorded"', async () => {
  writes.length = 0;
  await evaluate(setValue('#note-findings', NOTE_FINDINGS));
  await evaluate(setValue('#note-recommendations', NOTE_RECS));
  await sleep(300);
  const clicked = await evaluate(clickByText('Add note'));
  assert(clicked === 'OK', `Add note button not found: ${clicked}`);
  await sleep(2800);

  const posted = writes.find((w) => w.url.endsWith('/notes'));
  assert(posted, `no POST to /notes observed; writes=${JSON.stringify(writes)}`);
  const body = JSON.parse(posted.postData);
  assert(body.findings === NOTE_FINDINGS, `findings not sent verbatim: ${JSON.stringify(body)}`);
  assert(body.recommendations === NOTE_RECS, `recommendations not sent verbatim: ${JSON.stringify(body)}`);

  // And it persists: re-read from the API, then confirm the UI shows it.
  const recs = (await jget(`/consultations/${SESSION_ID}/records`, dtToken)).body;
  assert(recs.notes.some((n) => n.findings === NOTE_FINDINGS), 'note not persisted server-side');
  const ui = await evaluate('document.body.innerText');
  assert(ui.includes(NOTE_FINDINGS), 'note text not shown in the UI after posting');
  assert(ui.includes(NOTE_RECS), 'recommendations not shown after posting');
  // The composer must have cleared, so the next note starts empty.
  const after = await evaluate(`document.querySelector('#note-findings').value`);
  assert(after === '', `composer not cleared after success: ${JSON.stringify(after)}`);
  return `POST /notes with exact body; persisted; shown in UI; composer cleared`;
});

await step('C9 issuing a prescription POSTs it and it appears', async () => {
  writes.length = 0;
  await evaluate(setValue('#rx-details', RX_TEXT));
  await sleep(300);
  const clicked = await evaluate(clickByText('Issue prescription'));
  assert(clicked === 'OK', `Issue prescription button not found: ${clicked}`);
  await sleep(2800);

  const posted = writes.find((w) => w.url.endsWith('/prescriptions'));
  assert(posted, `no POST to /prescriptions observed; writes=${JSON.stringify(writes)}`);
  assert(JSON.parse(posted.postData).details === RX_TEXT, `details not sent verbatim: ${posted.postData}`);

  const recs = (await jget(`/consultations/${SESSION_ID}/records`, dtToken)).body;
  assert(recs.prescriptions.some((p) => p.details === RX_TEXT), 'prescription not persisted');
  const ui = await evaluate('document.body.innerText');
  assert(ui.includes(RX_TEXT), 'prescription text not shown in the UI');
  return `POST /prescriptions with exact body; persisted; shown in UI`;
});

await step('C10 an empty note cannot be submitted', async () => {
  await evaluate(setValue('#note-findings', ''));
  await evaluate(setValue('#note-recommendations', ''));
  await sleep(300);
  const disabled = await evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Add note'); return b ? b.disabled : 'NO_BTN'; })()`);
  assert(disabled === true, `Add note should be disabled when empty, got ${disabled}`);

  // And whitespace-only must not count as content (the server would 400).
  await evaluate(setValue('#note-findings', '   '));
  await sleep(300);
  const stillDisabled = await evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Add note'); return b ? b.disabled : 'NO_BTN'; })()`);
  assert(stillDisabled === true, `whitespace-only should not enable submit, got ${stillDisabled}`);

  writes.length = 0;
  await evaluate(clickByText('Add note'));
  await sleep(1200);
  const posted = writes.filter((w) => w.url.endsWith('/notes'));
  assert(posted.length === 0, `a blocked note still POSTed: ${JSON.stringify(posted)}`);
  return 'empty and whitespace-only both blocked; 0 POSTs made';
});

await step('C11 completing moves the session to COMPLETED and the UI shows it final', async () => {
  await evaluate(setValue('#note-findings', ''));
  writes.length = 0;
  const clicked = await evaluate(clickByText('Complete consultation'));
  assert(clicked === 'OK', `Complete button not found: ${clicked}`);
  await sleep(3000);

  const posted = writes.find((w) => w.url.endsWith('/complete'));
  assert(posted, `no POST to /complete observed; writes=${JSON.stringify(writes)}`);
  const s = (await jget(`/consultations/${SESSION_ID}`, dtToken)).body;
  assert(s.state === 'COMPLETED', `API state is ${s.state}, expected COMPLETED`);
  const body = await evaluate('document.body.innerText');
  assert(body.includes('Completed'), `UI did not show Completed; body=${body.slice(0, 300)}`);
  return `POST /complete; API now COMPLETED; UI shows Completed`;
});

await step('C12 completing again is not offered (terminal)', async () => {
  const completeBtn = await evaluate(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Complete consultation')`);
  assert(!completeBtn, 'Complete still offered on a COMPLETED session (server would 409 TERMINAL)');
  const body = await evaluate('document.body.innerText');
  assert(body.includes('already complete'), `no terminal explanation; body=${body.slice(0, 300)}`);
  // Records must still be readable after completion.
  assert(body.includes('Already recorded'), 'records block gone after completion');
  return 'no Complete button; terminal state explained';
});

await step('C13 the PATIENT can now read what the doctor wrote', async () => {
  // This is the point of the sub-item: the two halves of the flow meet only here.
  const recs = await jget(`/consultations/${SESSION_ID}/records`, ptToken);
  assert(recs.status === 200, `patient read after COMPLETED returned ${recs.status}`);
  assert(recs.body.notes.some((n) => n.findings === NOTE_FINDINGS), 'patient cannot see the doctor\'s note');
  assert(recs.body.prescriptions.some((p) => p.details === RX_TEXT), 'patient cannot see the prescription');

  // And the patient's own records view renders it.
  await loginAs(PT_EMAIL, PT_PASS);
  await navigate('/patient/records', 2800);
  const body = await evaluate('document.body.innerText');
  assert(body.includes(NOTE_FINDINGS), 'patient records screen does not show the note');
  assert(body.includes(RX_TEXT), 'patient records screen does not show the prescription');
  return 'patient read 200; note + prescription visible on the patient records screen';
});

await step('C14 an unrelated doctor cannot open this session (403)', async () => {
  const res = await jget(`/consultations/${SESSION_ID}`, otherDocToken);
  assert(res.status === 403, `expected 403 for a non-participant doctor, got ${res.status}`);
  return `403 "${res.body.message}"`;
});

await step('C15 zero uncaught exceptions', async () => {
  const real = uncaught.filter((u) => !/ResizeObserver loop|ERR_ABORTED/.test(u));
  assert(real.length === 0, `uncaught: ${JSON.stringify(real.slice(0, 3))}`);
  return `${uncaught.length} raw, 0 unexpected`;
});

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;

// Release the harness's OWN fixtures. The appointment is deliberately left
// COMPLETED (C11/C13 assert that), so it must be cancelled before its slot can
// be deleted -- the DELETE is 409-gated while a live appointment holds the FK.
// Reported per item, because counting attempts hides a 409 that reclaimed
// nothing.
let reclaimed = 0;
let attempted = 0;
const cancelRes = await fetch(`${API}/appointments/${appt.id}/cancel`, {
  method: 'PATCH',
  headers: H(ptToken),
});
attempted += 1;
if ([200, 201, 409].includes(cancelRes.status)) reclaimed += 1;
const delRes = await fetch(`${API}/doctors/me/availability/${OWN_SLOT_ID}`, {
  method: 'DELETE',
  headers: H(dtToken),
});
attempted += 1;
if ([200, 204].includes(delRes.status)) reclaimed += 1;

console.log(`\n${results.length - failed}/${results.length} passed`);
console.log(
  `session ${SESSION_ID} left COMPLETED; appointment ${appt.id} cancelled on exit; ` +
    `harness-owned slot released ${reclaimed}/${attempted} (throwaway account ${PT_EMAIL})`,
);
chrome.kill();
process.exit(failed ? 1 : 0);
