// Sub-item 5 (Layer 5) backend contract for the notification bell.
// Dependency-free (Node >=22 global fetch). Drives the REAL API on :3000.
// Writes a full transcript to stdout; run via: node scripts/evidence-sub5-backend.mjs
const BASE = 'http://localhost:3000';
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
  const s1 = await patchStatus(`/notifications/${target.id}/read`, PTOK);
  check('PATCH own -> 200', s1, 200);
  const after = await getJSON('/notifications/me', PTOK);
  const row = after.body.find((n) => n.id === target.id);
  check('read flipped to true', row.read, true);
  const s2 = await patchStatus(`/notifications/${target.id}/read`, PTOK);
  check('idempotent re-mark still 200', s2, 200);
}

hdr('6. OWNERSHIP (Flag 5) — another user\'s notification -> 403');
{
  const docRes = await getJSON('/notifications/me', DTOK);
  const docId = (docRes.body[0] || {}).id;
  check('doctor row id present', !!docId, true);
  const s = await patchStatus(`/notifications/${docId}/read`, PTOK);
  check("patient marks doctor's row -> 403", s, 403);
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
  const beforeP = (await getJSON('/notifications/me', PTOK)).body.length;
  const beforeD = (await getJSON('/notifications/me', DTOK)).body.length;
  const bRes = await fetch(`${BASE}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PTOK}` },
    body: JSON.stringify({ availabilityId: slot }),
  });
  const appt = (await bRes.json()).id;
  check('booking created', !!appt, true);
  const afterP = (await getJSON('/notifications/me', PTOK)).body.length;
  const afterD = (await getJSON('/notifications/me', DTOK)).body.length;
  check('patient got +1 notification from booking', afterP - beforeP, 1);
  check('doctor got +1 notification from booking', afterD - beforeD, 1);
}

hdr('9. EMPTY STATE — a fresh user returns [] (bell "all caught up")');
{
  const suffix = Date.now();
  const email = `bell.empty.${suffix}@example.com`;
  const r = await fetch(`${BASE}/auth/register/patient`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'PatientPass123!', name: 'Bell Empty', contactDetails: email }),
  });
  let tok = (await r.json()).accessToken;
  if (!tok) tok = (await login(email, 'PatientPass123!')).accessToken;
  const empty = await getJSON('/notifications/me', tok);
  check('fresh user /notifications/me -> 200', empty.status, 200);
  check('fresh user /notifications/me -> []', Array.isArray(empty.body) && empty.body.length === 0, true);
}

log(`\n===== SUMMARY =====`);
log(`PASS=${PASS} FAIL=${FAIL}`);
if (FAIL === 0) { log('RESULT: ALL NOTIFICATION-BELL BACKEND CHECKS PASSED'); process.exit(0); }
else { log('RESULT: FAILURES PRESENT'); process.exit(1); }