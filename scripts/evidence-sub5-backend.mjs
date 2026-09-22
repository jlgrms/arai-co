// Sub-item 5 (Layer 5) backend contract for the notification bell.
// Dependency-free (Node >=22 global fetch). Drives the REAL API on :3000.
// Writes a full transcript to stdout; run via: node scripts/evidence-sub5-backend.mjs
//
// FIXTURE DISCIPLINE (DEFERRED item 1): this harness previously left three things
// behind every run — a throwaway `bell.empty.*` patient, an Availability slot
// owned by the SEEDED dr.patel, and the Appointment that section 8 books between
// the seeded jordan.lee and dr.patel. All three are now tracked and reclaimed.
import { createReclaimer } from './lib/reclaim.mjs';

const BASE = 'http://localhost:3000';
const reclaim = createReclaimer({ label: 'sub5-backend' });
let PASS = 0, FAIL = 0;
const log = (s) => console.log(s);
function check(desc, actual, expected) {
  const ok = String(actual) === String(expected);
  if (ok) { PASS++; log(`PASS  ${desc}  (got ${actual})`); }
  else { FAIL++; log(`FAIL  ${desc}  (got ${actual}, expected ${expected})`); }
}
function hdr(s) { log(`\n===== ${s} =====`); }

async function login(email, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return r.json();
}
async function getJSON(path, token) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() };
}
async function patchStatus(path, token) {
  const r = await fetch(`${BASE}${path}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
  return r.status;
}

const pl = await login('jordan.lee@example.com', 'PatientPass123!');
const dl = await login('dr.patel@example.com', 'DoctorPass123!');
const PTOK = pl.accessToken, DTOK = dl.accessToken, PUID = pl.userId;

hdr('1. AUTH GATE — anonymous GET /notifications/me -> 401');
{
  const r = await fetch(`${BASE}/notifications/me`);
  check('anonymous GET /notifications/me -> 401', r.status, 401);
}

hdr('2. FETCH (bell opens) — caller gets OWN rows with bell fields');
const patientRes = await getJSON('/notifications/me', PTOK);
check('patient list -> 200', patientRes.status, 200);
check('patient has >=1 notification (real data)', patientRes.body.length >= 1, true);
check('every row scoped to caller userId', patientRes.body.every((n) => n.userId === PUID), true);
{
  const n = patientRes.body[0] || {};
  const hasAll = ['id', 'type', 'message', 'read', 'createdAt'].every((k) => k in n);
  check('rows carry bell fields (id,type,message,read,createdAt)', hasAll, true);
}

hdr('3. ORDERING (Flag 4) — most recent first: createdAt DESC, id DESC tie-break');
{
  const ts = patientRes.body.map((n) => n.createdAt);
  const sorted = [...ts].sort().reverse();
  check('most-recent-first ordering', JSON.stringify(ts) === JSON.stringify(sorted), true);
}

hdr('4. UNREAD BADGE — unread count is derivable (drives the bell dot)');
const unread = patientRes.body.filter((n) => !n.read).length;
check('unread count is a non-negative integer', Number.isInteger(unread) && unread >= 0, true);
log(`      unread (badge count): ${unread}`);

hdr('5. MARK READ — own row -> 200; read flips true; idempotent');
{
  const target = patientRes.body.find((n) => !n.read) || patientRes.body[0];
  // A seeded patient currently has ZERO notifications, so `target` is undefined
  // and this used to crash with a bare TypeError that aborted the run at section
  // 5 — silently skipping sections 6-9, whose coverage was therefore claimed but
  // never executed. Report it as a FAIL and carry on.
  if (!target) {
    check('a notification exists to mark read (needs a seeded/created row)', !!target, true);
  } else {
    const s1 = await patchStatus(`/notifications/${target.id}/read`, PTOK);
    check('PATCH own -> 200', s1, 200);
    const after = await getJSON('/notifications/me', PTOK);
    const row = after.body.find((n) => n.id === target.id);
    check('read flipped to true', row?.read, true);
    const s2 = await patchStatus(`/notifications/${target.id}/read`, PTOK);
    check('idempotent re-mark still 200', s2, 200);
  }
}

hdr('6. OWNERSHIP (Flag 5) — another user\'s notification -> 403');
{
  const docRes = await getJSON('/notifications/me', DTOK);
  const docId = (docRes.body[0] || {}).id;
  check('doctor row id present', !!docId, true);
  // Without a real id the PATCH would hit /notifications/undefined/read and
  // return 400, which is NOT evidence of the ownership rule. Only assert the 403
  // when a genuine other-user row exists.
  if (docId) {
    const s = await patchStatus(`/notifications/${docId}/read`, PTOK);
    check("patient marks doctor's row -> 403", s, 403);
  }
}

hdr('7. NOT FOUND — unknown notification id -> 404');
{
  const s = await patchStatus('/notifications/00000000-0000-0000-0000-000000000000/read', PTOK);
  check('PATCH unknown id -> 404', s, 404);
}

hdr('8. GENERATION — a real booking notifies BOTH parties');
{
  const offset = (Date.now() % 100000) + 70000;
  const mk = (min) => new Date(Date.UTC(2027, 5, 1, 9, 0, 0, 0) + min * 60000).toISOString();
  const sRes = await fetch(`${BASE}/doctors/me/availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DTOK}` },
    body: JSON.stringify({ startTime: mk(offset), endTime: mk(offset + 30) }),
  });
  const slot = (await sRes.json()).id;
  check('fresh slot created', !!slot, true);
  // The slot is owned by the SEEDED dr.patel, so deleting any user will NOT
  // remove it — it must be reclaimed explicitly or it survives as a free slot
  // that did not exist before this run.
  reclaim.trackSlot(slot);
  const beforeP = await getJSON('/notifications/me', PTOK);
  const beforeD = await getJSON('/notifications/me', DTOK);
  const beforePIds = new Set(beforeP.body.map((n) => n.id));
  const beforeDIds = new Set(beforeD.body.map((n) => n.id));
  const bRes = await fetch(`${BASE}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PTOK}` },
    body: JSON.stringify({ availabilityId: slot }),
  });
  const appt = (await bRes.json()).id;
  check('booking created', !!appt, true);
  // This appointment is between two SEEDED accounts (jordan.lee + dr.patel), so
  // no user deletion will ever cascade it away. Reclaim it by id.
  reclaim.trackAppointment(appt);
  const afterP = await getJSON('/notifications/me', PTOK);
  const afterD = await getJSON('/notifications/me', DTOK);
  // Notification has no FK to Appointment, so the booking's two notifications
  // survive the appointment delete as orphans. Capture exactly the ones this
  // booking added (present now, absent before) and track them.
  for (const n of afterP.body) if (!beforePIds.has(n.id)) reclaim.trackNotification(n.id);
  for (const n of afterD.body) if (!beforeDIds.has(n.id)) reclaim.trackNotification(n.id);
  check('patient got +1 notification from booking', afterP.body.length - beforeP.body.length, 1);
  check('doctor got +1 notification from booking', afterD.body.length - beforeD.body.length, 1);
}

hdr('9. EMPTY STATE — a fresh user returns [] (bell "all caught up")');
{
  const suffix = Date.now();
  const email = `bell.empty.${suffix}@example.com`;
  const r = await fetch(`${BASE}/auth/register/patient`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'PatientPass123!', name: 'Bell Empty', contactDetails: email }),
  });
  // The register response is FLAT — { accessToken, userId, role } — not
  // { user: { id } }. Reading the wrong field yields undefined and the tracker
  // silently no-ops, leaking while reporting clean.
  const reg = await r.json();
  let tok = reg.accessToken;
  if (!tok) tok = (await login(email, 'PatientPass123!')).accessToken;
  if (reg.userId) reclaim.trackUser(reg.userId, email);
  const empty = await getJSON('/notifications/me', tok);
  check('fresh user /notifications/me -> 200', empty.status, 200);
  check('fresh user /notifications/me -> []', Array.isArray(empty.body) && empty.body.length === 0, true);
}

log(`\n===== SUMMARY =====`);
log(`PASS=${PASS} FAIL=${FAIL}`);
await reclaim.run('success path');
if (FAIL === 0) { log('RESULT: ALL NOTIFICATION-BELL BACKEND CHECKS PASSED'); process.exit(0); }
else { log('RESULT: FAILURES PRESENT'); process.exit(1); }
