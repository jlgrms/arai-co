# Deferred work / known debt

Running record of work that was deliberately postponed. Each entry says what is
owed, why it was postponed, and what it would take — so it can be picked up
without re-deriving the reasoning.

## 1. Self-cleaning harnesses — DEFERRED to Layer 10 (Hardening & delivery)

**Status:** deferred by explicit stakeholder decision (not dropped).

**What is owed.** Eight harnesses register a throwaway account per run via
`POST /auth/register/patient` and never delete it:

- `scripts/evidence-layer6-sub2-discover.mjs`
- `scripts/evidence-layer6-sub3-matching.mjs`
- `scripts/evidence-layer6-sub4-booking.mjs`
- `scripts/evidence-layer7-sub4-doctor-consult.mjs`
- `scripts/evidence-sub3-auth.mjs`
- `scripts/evidence-sub3-happy.mjs`
- `scripts/evidence-sub5-backend.mjs`
- `scripts/evidence-sub5-bell-ui.mjs`

Commit `a513584` brought *slots* under the "put it back" rule but not accounts,
so accounts accumulate. A second leak is that account-*reusing* harnesses book a
fixture against the real seeded patient (Jordan) and cancel it, leaving a
`CANCELLED` appointment row on a real account.

**Why it matters.** `GET /admin/users` lists every PATIENT/DOCTOR account ordered
`createdAt desc` and `GET /admin/appointments` lists everything ordered
`scheduledAt desc`. Untended, harness residue sorts to the *top* of both, so the
admin console (Layer 8) degrades into a wall of test junk — and a reviewer cannot
tell a rendering fault from leftover noise.

**Observed scale.** By the start of Layer 8 the database held 69 accounts, of
which **58 were harness orphans (84%)**, plus 29 cancelled-appointment residue
rows on seeded accounts and 10 sessions whose state contradicted their
appointment.

**What it would take.** Give each harness a cleanup path that runs on exit
(including on failure): capture the account id at registration, then delete that
user and any fixture appointment/slot it created. There is no user-DELETE
endpoint in the API — only `Availability` has one — so harness clean-up must
shell out to SQL (as `scripts/db-clean-harness-users.sh` does) or a delete
endpoint must be added and justified. Clean-up must be **per-item and reported**,
and must only delete what that run created.

## Interim mitigation in place

`scripts/db-clean-harness-users.sh` restores the documented baseline on demand.
Dry run by default; `--apply` performs the deletion. It is idempotent and covers:

- **Section 1** — harness-owned accounts (cascade removes their profiles,
  appointments, sessions, notes, prescriptions).
- **Section 2a** — cancelled-appointment residue on seed accounts.
- **Section 2b** — sessions whose state contradicts a CANCELLED appointment
  (normalised down to SCHEDULED, never up; ordered before 2a because deleting an
  appointment cascades its session away and would otherwise make 2b dead code).

`john@test.com` and its appointments are **deliberately never matched** — not
attributable to a harness, so treated as hand-made data.

**Stakeholder process during Layer 8:** run
`scripts/db-clean-harness-users.sh --apply` manually before reviewing each admin
sub-item.

## Documented baseline (post-clean)

| Table | Count |
| --- | --- |
| User | 11 (1 admin, 6 doctors, 3 seed patients, john@test.com) |
| PatientProfile | 4 |
| DoctorProfile | 6 |
| Appointment | 7 |
| ConsultationSession | 7 |
| Availability | 31 (Patel 6, others 5; 0 stray far-future) |

Session states after clean: BOOKED+SCHEDULED (1, Sam↔Okafor), BOOKED+JOINED (1,
seeded live Patel↔Jordan), BOOKED+IN_PROGRESS (1, Jordan↔Silva),
CANCELLED+SCHEDULED (1, john's), COMPLETED+COMPLETED (3, seeded).

## 2. `evidence-cancelled-join.mjs` over-reports its cleanup — DEFERRED to Layer 10

**Status:** found during Layer 8 sub-item 1; deferred with the rest of the
harness work (not dropped). Not fixed, per the "don't touch the harnesses yet"
decision.

**The defect.** In the cleanup block, cancelling a harness-owned appointment is
counted as reclaimed for `status === 200 || 201 || 409`:

```js
const res = await request('PATCH', `/appointments/${id}/cancel`, { token: patientToken });
// Already-cancelled counts as reclaimed: the slot FK is free either way.
if (res.status === 200 || res.status === 201 || res.status === 409) reclaimed += 1;
```

The comment's premise is wrong for this route. `PATCH /appointments/:id/cancel`
returns **409 when the cancel is refused** because the slot is still consumed
(`assertSlotNotConsumed`), not when it is already cancelled. A 409 therefore means
the appointment is **still live and still holding its slot** — the opposite of
reclaimed.

**Observed effect.** The run reports `reclaim 4/4 harness-owned fixtures
released`, while leaving one live `BOOKED` appointment (Jordan ↔ Patel,
2027-07-28) and its slot behind. Verified by reading the code and then observing
the residue in the database: the doctor's slot count came back as Patel 7
(baseline 6) and the appointment table as 8 rows (baseline 7).

**Why it matters.** This is the same "reports attempts, not successes" defect
that `a513584` fixed elsewhere — it makes the harness's own cleanup claim
untrustworthy, which is worse than reporting nothing. It also silently erodes the
doctor's schedule: Patel's slot count drifts up and the admin Appointments screen
(baseline 7) gains a phantom row per run.

**What it would take.** Treat only 200/201 as reclaimed; treat 409 as a failure
to reclaim and surface it. Better, cancel-by-SQL or delete the appointment
directly so the slot FK is definitely freed.

**Interim mitigation.** `scripts/db-clean-harness-users.sh` reclaims this residue
via section 2a (it is a `BOOKED` row, not `CANCELLED`, so check the predicate if
this recurs). The far-future slot itself is left; it must be deleted by hand or
by extending the script.

## 3. No seeded PENDING/REJECTED doctor — the review queue is empty by default

**Status:** accepted by explicit stakeholder decision (option B1, Layer 8
sub-item 2), with a named leak risk. Not dropped.

**What is owed.** `seed.ts` writes `approvalStatus: APPROVED` for all six seeded
doctors (the only `approvalStatus` write in the seed). The schema default is
`PENDING`, but nothing is ever seeded in that state. Consequence: on a fresh
`docker compose up`, the admin Doctor Review screen's **pending queue is empty**,
so the first thing a reviewer sees is the empty state rather than the review
workflow the sub-item exists to demonstrate.

**Why it was accepted rather than fixed.** Seeding a `PENDING` doctor was option
B3 and was declined because it would change the documented baseline above (6
doctors, all APPROVED) and every harness asserting that count. The stakeholder
chose B1: a harness creates its own throwaway `PENDING` doctor, exercises
approve → reject → reopen → edit, and **reclaims it on exit**.

**Delivered mitigation.** `scripts/evidence-layer8-sub2-admin-doctors.mjs`
registers a doctor via `POST /auth/register/doctor` (which arrives `PENDING`),
exercises the full review lifecycle against it, and deletes it by **user id
captured at registration** — never by email pattern — on the success path, the
failure path (`process.on('exit')`), and `SIGINT`. Because there is no
user-DELETE endpoint, the delete is SQL via `docker exec psql`, matching
`db-clean-harness-users.sh`.

**Leak risk (the accepted cost of B1).** This is the **first harness in the repo
that cleans up after itself**, so its reclaim path is newer and less proven than
the residue-everything pattern it replaces. Specific risks:

1. **`kill -9` or a hard teardown skips `process.on('exit')`.** Node runs exit
   hooks for normal exit, uncaught throws, and SIGINT — but not `SIGKILL`, and
   not if the process dies before the hook's `spawnSync` completes. A fixture
   would then survive as an orphaned `PENDING` doctor sitting in the review queue.
2. **The delete shells out to `docker`.** If the `telehealth-postgres` container
   is renamed or absent, `spawnSync` fails and the fixture survives. The harness
   prints `DELETE FAILED`, and then verifies absence via `GET /admin/doctors`
   rather than trusting the delete's exit code — but it cannot repair.
3. **Audit rows are deliberately NOT reclaimed.** The audit log is append-only by
   design, so each run adds ~4 `DOCTOR_APPROVAL_UPDATE` entries referencing a
   now-deleted profile id. Intended (the log must not be rewritten), but it means
   the admin Audit Log view accumulates rows pointing at a doctor that no longer
   exists.

**Safety net.** `l8s2%` was added to `PREFIXES` in `db-clean-harness-users.sh`,
so even a leaked fixture is reclaimable by
`scripts/db-clean-harness-users.sh --apply`. The prefix is a net, not the
mechanism — the harness is expected to reclaim itself.

**Verification performed at Layer 8 sub-item 2.** Both paths were exercised, not
assumed: the happy path reclaims (fixture verified absent from
`GET /admin/doctors`), and an injected mid-run throw confirmed the exit hook
still deletes the fixture (probe crashed with exit 1, delete ran, row gone).
Post-run `db-clean-harness-users.sh --apply` matched **0** accounts and left the
baseline at User 11 / DoctorProfile 6, confirming zero residue.

**What it would still take.** Fold this harness into the item 1 work at Layer 10
so the eight pre-existing leakers adopt the same reclaim-on-exit pattern, and
decide whether audit rows pointing at deleted profiles should be filtered out of
the Audit Log view.

## 4. Timestamps render in UTC

`Notification` is a frozen leaf table with only a `string message`, so the server
has no user locale and messages embed UTC times (e.g. "8 Jun 2028, 06:03 UTC").
Notifications are append-only, so pre-fix rows keep their ISO strings forever.
A fix is forward-only; no scope was agreed for it.

**Extended at Layer 8 sub-item 5.** The admin audit log renders every timestamp in
UTC, with an explicit ` UTC` suffix on each cell and a "times shown in UTC" note
under the table. This is a deliberate **consistency** choice rather than a fix:
the app has no user-locale handling anywhere, so localising only the audit log
would create a second convention instead of resolving the first. Two notes for
whoever closes this out:

- An audit log is the one place where the choice is defensible long-term. A
  security record is arguably *better* pinned to UTC, because localising it makes
  two viewers disagree about when an action happened — a forensic problem, not a
  cosmetic one. Consider exempting this screen from the eventual fix.
- `formatAuditTimestamp` uses a literal month table, NOT
  `toLocaleString({ month: 'short' })`. Node's ICU renders September as `"Sept"`
  in `en-GB`, which is neither the 3-letter form the rest of the app uses nor
  stable across ICU versions. Found by a failing unit test. Do not "simplify"
  this back to `toLocaleString`.

## 5. No screen has ever been visually inspected

Verification is DOM/behavioural only. Layout, spacing, colour, and overflow are
unverified — PNGs cannot be read back for review. **Re-raised at Layer 8
sub-item 2 (Flag 7) and confirmed by the stakeholder as deferred to the Layer 8
close-out visual pass.** This gap is now four layers deep (Layers 6, 7, 8), and
the doctor-review screen adds a composition — status chips plus inline per-row
actions plus a modal edit form — that DOM assertions cannot validate at all. The
appointment-oversight screen (sub-item 3) adds a second: a six-column table with
stacked badges per cell and a destructive row action. The operational dashboard
(sub-item 4) adds a third and the most layout-sensitive one so far: a two-column
responsive card grid whose tiles wrap on flex, with a headline total right-aligned
against a long description — exactly the arrangement where an assertion proves
the numbers are present and says nothing about whether they fit.

**This entry is DUE NOW.** Sub-item 5 was the last screen in Layer 8, and every
route in the app now renders a real screen — the last `PlaceholderPage` was
retired with the audit log. So the close-out visual pass is unblocked and has a
fixed, known target: **eight compositions across four layers.**

- Layer 6 — discover, guided matching, booking, consultation, records
- Layer 7 — doctor profile, schedule, patient records, consultation workspace
- Layer 8 — users, doctor review, appointments, dashboard, **audit log**

The audit log (sub-item 5) adds a fourth Layer-8 composition and the widest table
in the app: five columns, two of which stack a label over a raw monospace value,
and a Reason column that must wrap rather than overflow. It also renders a
44-row table with no pagination, so vertical length is untested by any assertion
here.

## 6. Inconsistent mutation-response shapes across admin endpoints

**Status:** NOT deferred for fixing — the client now handles both shapes — but
recorded as backend debt worth a follow-up.

**What is owed.** `POST /admin/appointments/:id/cancel` returns the **raw
Appointment row** (the service calls `prisma.appointment.update(...)` with no
`select`), so its payload omits `patientProfile`, `doctorProfile`, and
`consultationSession`. Every other admin read — `GET /admin/appointments`,
`GET /admin/doctors`, `PATCH /admin/doctors/:id/review` — returns the joined
shape. Two endpoints over the same entity therefore disagree about what an
appointment looks like.

**Why it matters.** It caused a real crash. The screen replaced its loaded row
with the cancel response, which dropped the relations, and the next render threw
`TypeError: Cannot read properties of undefined (reading 'state')` — a
**whitescreen on a successfully cancelled appointment**. Fixed on the client by
introducing `CancelledAppointmentRow` (the honest type for what the endpoint
returns) and `mergeCancelledAppointment` (folds only the scalars that can change
onto the row already held), with unit tests that reproduce the crash. See
`apps/frontend/src/features/admin/admin-appointment-types.ts`.

**Why it was not fixed at source.** Changing the backend response shape is Layer 4
scope and would need its own evidence run; sub-item 3 is frontend-only by
decision. The client fix is correct and tested — but the underlying inconsistency
remains, and any future caller of this endpoint can trip the same wire.

**What it would take.** Add the same `select` to the cancel path's `update()`
(and to the returned-from-idempotent-branch `findUnique`, which has the same
omission) so both admin appointment endpoints return one shape. That would let
`CancelledAppointmentRow` and the merge helper be deleted.

## 7. Harness pattern split: zero-fixture vs reclaim-by-id — RECORD ONLY

**Status:** informational. Not debt, not work owed. Recorded so the inconsistency
is not re-derived as a defect.

**What changed.** `scripts/evidence-layer8-sub4-admin-dashboard.mjs` is the first
harness in the repo that creates **no fixtures at all**. It is a read-only
verification of `GET /admin/dashboard`, so it has no mutation to exercise, no
reclaimer, no `process.on('exit')` hook, and deliberately **no `l8s4%` entry in
`db-clean-harness-users.sh`** — there is nothing to reclaim, and adding a prefix
for a harness that cannot leak would misdescribe it.

This is the second distinct harness discipline in the tree, alongside the
reclaim-by-user-id pattern (item 3) and the residue-everything pattern (item 1):

| Pattern | Example | Cleanup |
| --- | --- | --- |
| Residue everything | `evidence-layer6-sub2-discover.mjs` | none — leaks by design (item 1) |
| Reclaim by captured user id | `evidence-layer8-sub2-admin-doctors.mjs` | `process.on('exit')` + SIGINT, SQL delete by id |
| Zero-fixture | `evidence-layer8-sub4-admin-dashboard.mjs` | n/a — creates nothing |

**Why it matters for review.** A reviewer comparing harnesses will notice sub-item
4 lacks a cleanup block and that no `l8s4%` prefix exists. That is correct, not an
oversight. The rule the three patterns share: **a harness may only remove what
that run created** — which reduces to "removes nothing" when it creates nothing.

**The matching assertion rule.** Because the dashboard has no fixture to pin the
data, every assertion is an **equality against a simultaneous live API read**
rather than a hardcoded number. Asserting `users == 11` would be asserting the
fixture database and would pass on a screen rendering a forgotten literal; R2/R3/R4
instead compare the DOM against a `GET /admin/dashboard` taken at the same moment,
so the assertions stay true as the data changes. Also recorded as the design note
in that harness's header.

**One harness bug found and fixed during this run (for the record).** R10 initially
failed because the assertion regex enumerated guessed failure wordings
(`failed to fetch|network|…`) and the screen rendered the api-client's actual text,
`"Cannot reach the server. Is the backend running?"`. The **screen was correct and
the assertion was wrong** — it was testing my recollection rather than the DOM. R10
now asserts the error alert's structure (present, has a title, has a non-empty body
with no raw `undefined`/`null` leak) instead of a guessed sentence. Worth noting as
the general trap: an assertion on invented copy fails for the wrong reason and can
be mistaken for a product defect.


## 8. The audit log has one administrator, so multi-admin behaviour is untested

**Status:** coverage gap, not a defect. No fix owed — recorded so the weakness in
this sub-item's evidence is not mistaken for strength.

**What is unproven.** Every one of the 44 rows in the live log was written by
`admin@example.com`. The seed creates exactly one ADMIN account. Consequences for
`scripts/evidence-layer8-sub5-admin-audit.mjs`:

- **R8 is vacuous.** It selects the admin facet and asserts the rendered set
  matches that admin's rows — but since there is only one admin, the facet
  matches all 44 rows. The assertion therefore cannot distinguish "the admin
  facet works" from "the admin facet does nothing". It proves the control is
  wired, not that it discriminates.
- **`filterOptions().admins` is never exercised with more than one entry**, so its
  dedup-and-sort-by-email path is covered only by unit tests, not end-to-end.

The action and record-type facets (R9/R10) are **not** affected — those have 3
values each and do discriminate; R9 even asserts the chosen facet matched more
than one row so it cannot pass on a single-row match.

**Why it was not fixed.** Creating a second admin would mean either seeding one
(changing the documented baseline of User 11) or having a harness register one,
which for a read-only sub-item would be a fixture created solely to make an
assertion non-vacuous. Jean's Flag 8 decision for this sub-item family was to
refuse exactly that. The gap is recorded rather than papered over.

**What it would take.** Either seed a second ADMIN account (updating the baseline
and every harness that asserts 11 users), or accept that multi-admin grouping is
verified by unit test only. Note this is also the seam where a real deployment
would diverge: with several admins, the `administrators have acted` line under the
table and the admin facet both become load-bearing.

## 9. The audit log is unbounded — no pagination, and it grows forever

**Status:** accepted for Layer 8 (read-only scope); a real limit worth naming.

**What is owed.** `GET /admin/audit-logs` is `findMany` with **no `take`, no
`skip`, and no filters**, so the response grows without bound. The log is
append-only, so nothing removes rows. Every admin action on every admin screen
adds one. The screen fetches the whole log on mount and filters locally.

**Current scale.** 44 rows — trivially fine.

**Why it matters.** Unlike the other four admin screens, whose row counts are
bounded by the number of patients/doctors/appointments, this table's size is a
function of *how much administration has ever happened*. It is the only screen in
the app that is guaranteed to degrade with normal use rather than with data
growth. At tens of thousands of rows the payload becomes the bottleneck and the
local "filter" scans the full array on every keystroke-free interaction.

**Why it was not fixed.** The endpoint pre-exists from Layer 4 sub-item 9 and
sub-item 5 is frontend-only by decision. Adding `take`/`skip` or a server-side
filter changes the backend contract and would need its own evidence run — the same
reasoning as item 6.

**What it would take.** Add cursor or offset pagination to the endpoint, plus
server-side facets to replace the local filter. The frontend's wording ("filtered
locally") and its `filterOptions`-from-loaded-data approach both assume a complete
fetch, so both would change. The screen deliberately says "shown", not "found",
which keeps that change honest whenever it happens.

## 10. The landing widget's canned concerns are the nearest seeded phrase, not the right one

**Status:** fixed to the point of working (Layer 9); the *precision* is owed to a
Layer 6/7 seed change.

**What was wrong.** The quick-book widget on the public landing page offers the
design's 7 Filipino body parts (Ulo, Lalamunan, Dibdib, Tiyan, Likod, Balat,
Iba pa). The first implementation gave each part a natural Filipino concern —
Ulo → `masakit ang ulo`, Tiyan → `masakit ang tiyan` — and sent that to
`GET /doctors/match`.

The seeded symptom→specialty table (`apps/backend/prisma/seed.ts`) is entirely
**English**: `cough`, `chest pain`, `rash`, … `matchSymptomToSpecialties` does a
normalized contains-match in **both** directions, which tolerates noise ("chest"
matches "chest pain") but **cannot cross languages**: no Filipino phrase contains
an English one, or vice versa. Measured against the live API, all six canned
paths returned **zero doctors**. The widget looked wired end to end — CTA
enabled, handoff stored, auth redirect, match fired — and could not produce a
single result. Only `Iba pa` (which takes typed input) ever worked.

**What was done.** The labels keep the design's Filipino voice; the `concern`
strings were changed to phrases that are actually in the seeded table:

| Part | Sends | Resolves to |
|---|---|---|
| Ulo | `anxiety` | Psychiatry (1 doctor) |
| Lalamunan | `cough` | General Medicine (2) |
| Dibdib | `chest pain` | Cardiology (1) |
| Tiyan | `fever` | General Medicine, Pediatrics (3) |
| Likod | `fatigue` | General Medicine (2) |
| Balat | `rash` | Dermatology (1) |
| Iba pa | *(typed)* | — |

**What is still owed.** These are the *nearest available* seeded phrases, not
clinically correct mappings. The seed has no entry for "headache" or "stomach
ache", so **`Ulo` ("head") sends `anxiety` and `Tiyan` ("stomach") sends
`fever`**. A visitor tapping Ulo is shown a psychiatrist. `Balat`→dermatology,
`Dibdib`→cardiology and `Lalamunan`→respiratory are honest; Ulo and Tiyan are
stretches that land in roughly the right area by accident.

**Why it was not fixed properly.** Doing it right means adding symptom rows to
the seed (`headache` → General Medicine/Neurology, `stomach ache` →
Gastroenterology, …), which is a Layer 6/7 data change requiring a reseed and a
re-verification of the earlier layers. Out of scope for a frontend-only layer.

**Why it shipped this far.** R10–R14 of the Layer 9 harness all drive the widget
with **typed free text**, the one path that cannot dead-end because the user
supplies the words. R13 explicitly accepts an empty match as a valid outcome —
correct for free text, wrong for a canned chip — and nothing ever submitted a
canned concern. Every assertion passed while all six buttons were dead. This is
the same "assertion matches the wrong thing" trap as item 7.

**Guards added.** `body-parts.test.ts` asserts every canned concern is drawn from
the seeded vocabulary and rejects the Filipino phrasing that caused this;
`R16` in `scripts/evidence-layer9-landing.mjs` clicks each of the six real
buttons, carries the concern through auth, and asserts it resolves to >0 doctors
against the live API. Both were verified to FAIL when the original phrasing is
reintroduced.
