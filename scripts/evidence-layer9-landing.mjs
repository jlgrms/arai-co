// Layer 9 — runtime verification of the PUBLIC PRODUCT WEBSITE landing page.
// Dependency-free CDP driver (Node >=22 global WebSocket + fetch). Runs the
// REAL frontend at :5173 against the REAL backend at :3000 in headless Chrome.
//
//   R1  / renders the real landing page, not the retired placeholder
//   R2  the page is PUBLIC — it loads with no session and fires NO guarded call
//   R3  the header logo is the existing asset at its native aspect ratio
//   R4  the trust disclaimer is present (Layer 9 scope requirement)
//   R5  the widget offers exactly the 7 designed body parts
//   R6  the CTA is DISABLED until there is a concern (the design's state machine)
//   R7  selecting a body part enables the CTA
//   R8  typing a concern enables the CTA (the free-text path)
//   R9  the step indicator is HONEST: only step 1 is ever claimed
//   R10 submitting stores the concern and routes to auth — it does NOT match
//   R11 the handoff concern does NOT appear in the URL (health data, no history)
//   R12 after a real patient login the concern survives and the match FIRES
//   R13 the post-login match produces the same UI as a typed query (Layer 6 reuse)
//   R14 the concern is SINGLE-USE — a refresh does not re-fire it
//   R15 no uncaught exceptions during the run
//   R16 a CANNED body-part concern resolves to real doctors (not a dead end)
//   R17 the canned concerns route to a CLINICALLY SENSIBLE specialty
//
// WHY R16 EXISTS: R10-R14 exercise the widget with TYPED free text, which is the
// one path that cannot dead-end — the user supplies the words. The canned
// concerns are the other path, and they are a PROMISE: tapping "Tiyan" is
// supposed to produce doctors. The first version of this harness shipped a real
// bug straight through, because R13 accepts an empty match as a valid outcome
// (correct for free text, wrong for a canned chip) and nothing ever submitted
// one. The body parts were Filipino ("masakit ang tiyan") and the seeded
// vocabulary is English ("fever"), so all six chips matched zero doctors while
// every assertion still passed. R16 closes that hole by driving the actual
// button the visitor would tap.
//
// WHY R17 EXISTS: R16 alone is not enough. A second, subtler version of the same
// bug passed R16 cleanly — the chips were pointed at the nearest seeded phrase,
// so "Ulo" ("head") sent "anxiety" and showed a PSYCHIATRIST, and "Tiyan"
// ("stomach") sent "fever". Those matched real doctors, so R16 was satisfied.
// "Returns results" and "returns the RIGHT results" are different claims, and
// only the second one is what the visitor was promised. R17 asserts the
// resolved SPECIALTY, not just the doctor count.
//
// WHY R2 MATTERS MOST: the whole design of this layer rests on the landing page
// being unauthenticated. If it ever started calling /doctors/match directly the
// handoff would be pointless AND the page would 401 for every real visitor. R2
// records the network to prove no guarded call happens.
//
// NOTE ON THE `options` CALL COUNT: R14 reports 2 calls to /doctors/match/options
// on mount. That is React StrictMode double-invoking Layer 6's mount effect in
// dev (apps/frontend/src/main.tsx wraps the app in <StrictMode>), not a Layer 9
// defect and not a double-fetch bug. Don't chase it.
//
// FIXTURE DISCIPLINE: this harness logs in as a seeded patient but creates
// nothing. It is a read-only, record-only run — no reclaimer, no destroy step.
// The concern handoff is per-tab sessionStorage and is cleared by the app itself.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9246; // 9226, 9231-9245 are taken by earlier harnesses.
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

// Seeded patient (apps/backend/prisma/seed.ts). These are the THREE seeded
// patient logins: jordan.lee@ / sam.rivera@ / alex.kim@. There is no
// `john@test.com` — that address appears nowhere in the seed and returns 401.
// Verified by direct curl before this harness was written.
const PATIENT_EMAIL = 'jordan.lee@example.com';
const PATIENT_PASS = 'PatientPass123!';

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
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/chrome-l9-landing`, 'about:blank'],
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
const requests = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    uncaught.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Network.requestWillBeSent') {
    requests.push(m.params.request.url);
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

/** Click a body-part button by its visible label. */
const clickPart = (label) => `(() => {
  const btns = Array.from(document.querySelectorAll('button[aria-pressed]'));
  const el = btns.find(b => b.textContent.trim() === ${JSON.stringify(label)});
  if (!el) return 'NO_EL';
  el.click();
  return 'OK';
})()`;

const ctaDisabled = `(() => { const b = document.querySelector('form#quick-book, form'); const cta = document.querySelector('button[type=submit]'); return cta ? cta.disabled : 'NO_CTA'; })()`;

const stepState = `Array.from(document.querySelectorAll('ol[aria-label="Booking progress"] li')).map(li => ({ text: li.textContent.trim(), bar: getComputedStyle(li.querySelector('span')).backgroundColor }))`;

async function tokenFor(email, password) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return null;
  return (await r.json()).accessToken;
}

// ---- preconditions ---------------------------------------------------------

const patientToken = await tokenFor(PATIENT_EMAIL, PATIENT_PASS);
assert(patientToken, `could not log in as ${PATIENT_EMAIL} — cannot verify the handoff`);

// The patient's real match result for a known seeded phrase, for R13.
const apiMatch = async (symptom) => {
  const r = await fetch(`${API}/doctors/match?symptom=${encodeURIComponent(symptom)}`, {
    headers: { Authorization: `Bearer ${patientToken}` },
  });
  if (!r.ok) throw new Error(`GET /doctors/match returned HTTP ${r.status}`);
  return r.json();
};

// The seeded vocabulary, mirrored from the live server rather than hardcoded, so
// this cannot silently drift from the DB. Used by R16 to prove the canned
// concerns draw from the table the matcher actually consults.
const cachedOptions = await (async () => {
  const r = await fetch(`${API}/doctors/match/options`, {
    headers: { Authorization: `Bearer ${patientToken}` },
  });
  if (!r.ok) throw new Error(`GET /doctors/match/options returned HTTP ${r.status}`);
  return (await r.json()).options;
})();
const SEEDED_SYMPTOMS = cachedOptions.map((o) => o.symptom);

console.log('\nLayer 9 — public product website (landing page)');
console.log('Read-only harness: logs in as a seeded patient, creates nothing.\n');

await step('R1 / renders the real landing page, not the retired placeholder', async () => {
  await navigate('/');
  const body = await evaluate('document.body.innerText');
  assert(
    !body.includes('Care that starts with how you feel'),
    'the retired PublicHomePlaceholder is still rendering at /',
  );
  assert(body.includes('May aray ka?'), 'the designed headline is missing');
  assert(body.includes('Saan ka umaaray?'), 'the widget heading is missing');
  return 'designed headline + widget present';
});

await step('R2 the page is PUBLIC — no session, and NO guarded call is made', async () => {
  await evaluate('localStorage.clear(); sessionStorage.clear()');
  requests.length = 0;
  await navigate('/', 2800);
  const guarded = requests.filter(
    (u) => u.includes('/doctors/match') || u.includes('/doctors/match/options'),
  );
  assert(
    guarded.length === 0,
    `the public landing page called a guarded endpoint: ${guarded.join(', ')}`,
  );
  // Confirm it really is unauthenticated: the guarded call must be 401 if made.
  const probe = await fetch(`${API}/doctors/match?symptom=headache`);
  assert(probe.status === 401, `expected the match endpoint to be 401 anonymously, got ${probe.status}`);
  const hasToken = await evaluate('!!localStorage.getItem("arai.auth.token") || Object.keys(localStorage).some(k => k.includes("token"))');
  assert(!hasToken, 'a session token was present on the public page');
  return 'no guarded calls; match endpoint confirmed 401 anonymously';
});

await step('R3 the header logo is the existing asset at its native aspect ratio', async () => {
  await navigate('/');
  const logo = await evaluate(`(() => {
    const img = document.querySelector('header img');
    if (!img) return 'NO_IMG';
    return { src: img.getAttribute('src'), naturalW: img.naturalWidth, naturalH: img.naturalHeight, w: img.clientWidth, h: img.clientHeight };
  })()`);
  assert(logo !== 'NO_IMG' && logo.naturalW, 'no logo image found in the header');
  // The project asset is 1312x464 (2.83:1). Assert we are using THAT file, not
  // the design's embedded 900x499 artwork.
  assert(
    Math.abs(logo.naturalW / logo.naturalH - 1312 / 464) < 0.02,
    `logo natural ratio ${logo.naturalW}x${logo.naturalH} is not the 1312x464 project asset`,
  );
  const renderedRatio = logo.w / logo.h;
  assert(
    Math.abs(renderedRatio - 1312 / 464) < 0.05,
    `logo rendered at ${logo.w}x${logo.h} (ratio ${renderedRatio.toFixed(2)}) — not its native 2.83:1`,
  );
  return `rendered ${logo.w}x${logo.h} from the project asset (${logo.naturalW}x${logo.naturalH})`;
});

await step('R4 the trust disclaimer is present', async () => {
  await navigate('/');
  const body = await evaluate('document.body.innerText');
  assert(
    body.includes('prototype for demonstration only. Not for real medical use.'),
    'the mandated "not for real medical use" disclaimer is missing',
  );
  assert(
    body.includes('Fictional prototype'),
    'the fictional-prototype notice is missing',
  );
  return 'both disclaimers present';
});

await step('R5 the widget offers exactly the 7 designed body parts', async () => {
  await navigate('/');
  const labels = await evaluate(
    `Array.from(document.querySelectorAll('button[aria-pressed]')).map(b => b.textContent.trim())`,
  );
  const expected = ['Ulo', 'Lalamunan', 'Dibdib', 'Tiyan', 'Likod', 'Balat', 'Iba pa'];
  assert(
    JSON.stringify(labels) === JSON.stringify(expected),
    `body parts were ${JSON.stringify(labels)}, expected ${JSON.stringify(expected)}`,
  );
  return labels.join(', ');
});

await step('R6 the CTA is DISABLED until there is a concern', async () => {
  await navigate('/');
  const disabled = await evaluate(ctaDisabled);
  assert(disabled === true, `CTA should start disabled, got disabled=${disabled}`);
  return 'CTA starts disabled';
});

await step('R7 selecting a body part enables the CTA', async () => {
  await navigate('/');
  // Clear any restored textarea state first so this isolates the chip path.
  await evaluate(setValue('#concern', ''));
  const before = await evaluate(ctaDisabled);
  assert(before === true, 'CTA was not disabled before selecting');
  const clicked = await evaluate(clickPart('Tiyan'));
  assert(clicked === 'OK', 'could not click the Tiyan part');
  await sleep(220);
  const after = await evaluate(ctaDisabled);
  assert(after === false, 'CTA stayed disabled after selecting a body part');
  const pressed = await evaluate(
    `document.querySelector('button[aria-pressed="true"]')?.textContent.trim()`,
  );
  assert(pressed === 'Tiyan', `expected Tiyan pressed, got ${pressed}`);
  return 'Tiyan selected, CTA enabled';
});

await step('R8 typing a concern enables the CTA (the free-text path)', async () => {
  await navigate('/');
  await evaluate(setValue('#concern', 'masakit ang tiyan ko'));
  await sleep(220);
  const disabled = await evaluate(ctaDisabled);
  assert(disabled === false, 'CTA stayed disabled after typing a concern');
  return 'free-text path enables the CTA';
});

await step('R9 the step indicator is HONEST — only step 1 is claimed', async () => {
  await navigate('/');
  const idle = await evaluate(stepState);
  assert(idle.length === 3, `expected 3 steps, got ${idle.length}`);
  assert(
    idle[0].text.startsWith('1') && idle[1].text.startsWith('2') && idle[2].text.startsWith('3'),
    `step labels are wrong: ${idle.map((s) => s.text).join(' | ')}`,
  );
  // With no concern, no step bar should be coral.
  const coralIdle = idle.filter((s) => s.bar.includes('255, 127, 80')).length;
  assert(coralIdle === 0, `${coralIdle} step(s) highlighted while idle`);

  await evaluate(setValue('#concern', 'masakit ang tiyan ko'));
  await sleep(220);
  const ready = await evaluate(stepState);
  const coralReady = ready.filter((s) => s.bar.includes('255, 127, 80')).length;
  assert(
    coralReady === 1,
    `expected exactly 1 completed step (Concern) once ready, got ${coralReady}`,
  );
  return '0 highlighted idle, exactly 1 (Concern) when ready';
});

await step('R10 submitting stores the concern and routes to auth — it does NOT match', async () => {
  await navigate('/');
  requests.length = 0;
  await evaluate(setValue('#concern', 'masakit ang tiyan ko'));
  await sleep(220);
  await evaluate(`document.querySelector('button[type=submit]').click()`);
  await sleep(1600);
  const path = await evaluate('location.pathname');
  assert(path === '/login', `expected to land on /login, got ${path}`);
  const matchCalls = requests.filter((u) => u.includes('/doctors/match'));
  assert(
    matchCalls.length === 0,
    `submitting called matching directly: ${matchCalls.join(', ')}`,
  );
  const stored = await evaluate('sessionStorage.getItem("arai.pendingConcern")');
  assert(stored === 'masakit ang tiyan ko', `concern not carried across: got ${stored}`);
  return 'routed to /login with the concern carried, no match call';
});

await step('R11 the handoff concern does NOT appear in the URL', async () => {
  const href = await evaluate('location.href');
  assert(!href.includes('masakit'), `the concern leaked into the URL: ${href}`);
  const state = await evaluate('JSON.stringify(history.state)');
  assert(!String(state).includes('masakit'), `the concern leaked into history state: ${state}`);
  return 'URL and history state carry no concern text';
});

async function loginAsPatient() {
  await evaluate(setValue('#login-email', PATIENT_EMAIL));
  await evaluate(setValue('#login-password', PATIENT_PASS));
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(3200);
  return await evaluate('location.pathname');
}

await step('R12 after a real patient login the concern survives and the match FIRES', async () => {
  // Continue from R10's state: at /login with the concern still pending.
  requests.length = 0;
  const landed = await loginAsPatient();
  assert(
    landed === '/patient/book',
    `expected to land in the Layer 6 matching flow at /patient/book, got ${landed}`,
  );
  const queryCalls = requests.filter((u) => u.includes('/doctors/match?'));
  assert(
    queryCalls.length > 0,
    'the real match QUERY never fired after login (only the options call was seen)',
  );
  // The query must carry the handoff concern, not an empty symptom.
  // NOTE: the URL is form-encoded — spaces arrive as `+`, and `decodeURIComponent`
  // does NOT turn `+` back into a space (that is `URLSearchParams`/`decodeURI`+
  // plus-sign handling). Compare on the parsed `symptom` param instead of
  // substring-matching a decoded string, so this cannot false-fail again.
  const sentSymptom = new URL(queryCalls[0]).searchParams.get('symptom');
  assert(
    sentSymptom === 'masakit ang tiyan ko',
    `the post-login match did not carry the handoff concern: got ${JSON.stringify(sentSymptom)} from ${queryCalls[0]}`,
  );
  // The concern must have been consumed (single-use) on arrival.
  const stillStored = await evaluate('sessionStorage.getItem("arai.pendingConcern")');
  assert(stillStored === null, `the concern was not consumed: ${stillStored}`);
  return `${queryCalls.length} real match query call(s), carrying the handoff concern`;
});

await step('R13 the post-login match reuses the Layer 6 UI, not a new one', async () => {
  const body = await evaluate('document.body.innerText');
  assert(body.includes('Find the right doctor'), 'the Layer 6 matching screen did not render');
  // The concern should be echoed into the existing input.
  const filled = await evaluate(`document.querySelector('#symptom-input')?.value`);
  assert(filled === 'masakit ang tiyan ko', `the symptom field was not prefilled: got ${filled}`);
  // And the result must be the true API answer for that phrase.
  const truth = await apiMatch('masakit ang tiyan ko');
  const shown = await evaluate('document.body.innerText');
  if (truth.doctors.length > 0) {
    for (const doctor of truth.doctors) {
      assert(shown.includes(doctor.name), `matched doctor ${doctor.name} is not on screen`);
    }
    return `${truth.doctors.length} API-matched doctor(s) all rendered`;
  }
  assert(
    shown.includes('couldn') || shown.includes('couldn’t'),
    'empty match did not render the non-error empty state',
  );
  return 'API returned no match; the honest empty state rendered';
});

await step('R14 the concern is SINGLE-USE — a reload does not re-fire it', async () => {
  requests.length = 0;
  await navigate('/patient/book', 2800);
  // IMPORTANT: match ONLY the query endpoint. `/doctors/match/options` is fired
  // on mount by the pre-existing Layer 6 screen to load its suggestion chips —
  // that is normal and expected, and it is NOT the handoff re-firing. A naive
  // `includes('/doctors/match')` matches BOTH and reports a false failure.
  const queryCalls = requests.filter(
    (u) => u.includes('/doctors/match?') || /\/doctors\/match(\?|$)/.test(u),
  );
  assert(
    queryCalls.length === 0,
    `a reload re-fired the match query (${queryCalls.length} calls) — not single-use: ${queryCalls.join(', ')}`,
  );
  // The real invariant: nothing left in storage to consume.
  const stored = await evaluate('sessionStorage.getItem("arai.pendingConcern")');
  assert(stored === null, `the concern was still pending after use: ${stored}`);
  const filled = await evaluate(`document.querySelector('#symptom-input')?.value`);
  assert(!filled, `the symptom field repopulated on reload: ${filled}`);
  const optionCalls = requests.filter((u) => u.includes('/doctors/match/options')).length;
  return `no query re-fire; ${optionCalls} expected chip-options call(s) on mount`;
});

await step('R15 no uncaught exceptions during the run', async () => {
  assert(uncaught.length === 0, `uncaught exceptions: ${uncaught.join(' | ').slice(0, 500)}`);
  return 'clean console';
});

await step('R16 a CANNED body-part concern resolves to real doctors, not a dead end', async () => {
  // Log out first: the widget must be driven as a VISITOR, and this is also the
  // only step that exercises the full anonymous → chip → auth → match path.
  await evaluate('localStorage.clear(); sessionStorage.clear()');
  await navigate('/', 2800);

  const expected = ['Ulo', 'Lalamunan', 'Dibdib', 'Tiyan', 'Likod', 'Balat'];
  const seen = [];

  for (const label of expected) {
    // Fresh page each time so we drive the button exactly as a visitor would.
    await evaluate('sessionStorage.clear()');
    await navigate('/', 2400);
    const clicked = await evaluate(clickPart(label));
    assert(clicked === 'OK', `could not click the "${label}" body part`);
    await sleep(200);

    const ctaEnabled = await evaluate(ctaDisabled);
    assert(ctaEnabled === false, `"${label}" did not enable the CTA — it carries no concern`);
    await evaluate(`document.querySelector('button[type=submit]').click()`);
    await sleep(1500);

    const stored = await evaluate('sessionStorage.getItem("arai.pendingConcern")');
    assert(stored, `"${label}" stored no concern to carry across auth`);
    assert(
      SEEDED_SYMPTOMS.includes(stored),
      `"${label}" sends "${stored}", which is NOT in the seeded symptom table (${SEEDED_SYMPTOMS.join(', ')}) — tapping this body part would match nothing`,
    );

    // The decisive check: the concern must actually resolve to doctors.
    const truth = await apiMatch(stored);
    assert(
      truth.doctors.length > 0,
      `"${label}" sends "${stored}" and matches 0 doctors — the widget is a dead end for this body part`,
    );
    seen.push(`${label}→${stored} (${truth.doctors.length})`);
  }

  return seen.join(', ');
});

// The specialty each body part must resolve to. Derived from what a primary-care
// clinician would actually do with the complaint, then checked against the five
// specializations that have doctors (Cardiology, Dermatology, General Medicine
// x2, Pediatrics, Psychiatry). headache / sore throat / stomach ache are not
// specialist referrals, so all three are General Medicine.
const EXPECTED_SPECIALTY = {
  Ulo: 'General Medicine', // headache
  Lalamunan: 'General Medicine', // sore throat
  Dibdib: 'Cardiology', // chest pain
  Tiyan: 'General Medicine', // stomach ache
  Likod: 'General Medicine', // fatigue
  Balat: 'Dermatology', // rash
};

// The concern each part must send. Pinned so a future edit cannot quietly
// re-point a chip at a different (even if still non-empty) symptom.
const EXPECTED_CONCERN = {
  Ulo: 'headache',
  Lalamunan: 'sore throat',
  Dibdib: 'chest pain',
  Tiyan: 'stomach ache',
  Likod: 'fatigue',
  Balat: 'rash',
};

await step('R17 the canned concerns route to a CLINICALLY SENSIBLE specialty', async () => {
  const seen = [];
  for (const [label, symptom] of Object.entries(EXPECTED_CONCERN)) {
    // FIRST: what does the WIDGET actually send? This must be read from the
    // running page, not assumed from EXPECTED_CONCERN. An earlier version of
    // this step queried the API with its own hardcoded phrases and cheerfully
    // passed while the widget was sending something else entirely — it was
    // testing the seed table, not the product.
    await evaluate('sessionStorage.clear()');
    await navigate('/', 2400);
    const clicked = await evaluate(clickPart(label));
    assert(clicked === 'OK', `could not click the "${label}" body part`);
    await sleep(180);
    await evaluate(`document.querySelector('button[type=submit]').click()`);
    await sleep(1400);
    const sent = await evaluate('sessionStorage.getItem("arai.pendingConcern")');
    assert(sent, `"${label}" stored no concern — cannot verify what it sends`);
    assert(
      sent === symptom,
      `"${label}" actually sends "${sent}", but this body part must send "${symptom}" — the chip is wired to the wrong symptom`,
    );

    const truth = await apiMatch(sent);
    const want = EXPECTED_SPECIALTY[label];

    // The concern must be one the visitor would recognise for that body part.
    assert(
      SEEDED_SYMPTOMS.includes(sent),
      `"${label}" sends "${sent}", which is not in the seeded table`,
    );
    // And it must resolve to the right specialty, not merely to somebody.
    assert(
      truth.matchedSpecialties.includes(want),
      `"${label}" ("${sent}") resolved to ${JSON.stringify(truth.matchedSpecialties)}, expected ${want}`,
    );
    // Every reported specialty must have doctors, or the UI groups under a
    // specialty and then renders an empty group.
    assert(
      truth.doctors.length > 0,
      `"${label}" resolves to ${want} but that specialty has no doctors`,
    );
    seen.push(`${label}→${sent}→${want} (${truth.doctors.length})`);
  }

  // The specific regression: Ulo must never reach Psychiatry and Tiyan must
  // never reach a fever/pediatric routing.
  const ulo = await apiMatch('headache');
  assert(
    !ulo.matchedSpecialties.includes('Psychiatry'),
    'Ulo still routes to Psychiatry — the "nearest available phrase" bug is back',
  );
  const tiyan = await apiMatch('stomach ache');
  assert(
    !tiyan.matchedSpecialties.includes('Pediatrics'),
    'Tiyan routes to Pediatrics — a stomach ache is not a paediatric referral',
  );

  return seen.join(', ');
});

// ---- result ----------------------------------------------------------------

const total = pass + failures.length;
console.log(`\n${pass}/${total} PASS`);
if (failures.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
ws.close();
chrome.kill();
process.exit(failures.length === 0 ? 0 : 1);
