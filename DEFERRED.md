# Deferred work / known debt

Running record of work that was deliberately postponed. Each entry says what is
owed, why it was postponed, and what it would take — so it can be picked up
without re-deriving the reasoning.

## 1. Self-cleaning harnesses — RESOLVED

**Status:** RESOLVED. All eight harnesses now reclaim what they create through
`scripts/lib/reclaim.mjs`.

**The fix.** `scripts/lib/reclaim.mjs` exports `createReclaimer({ label })`, which
tracks users, appointments, availability slots and notifications **by id**, deletes
them with SQL in dependency order, and reports a per-item outcome
(`reclaimed` / `absent` / `failed`). It installs its own `process.on('exit')` and
`SIGINT` hooks, so an uncaught throw or Ctrl-C still reclaims. Harnesses call
`reclaim.run()` explicitly on the success path so the count appears in their own
output.

The one rule, enforced by the helper's API: **a harness may only remove what that
run created.** Nothing deletes by email pattern or date range.

**Measured result.** Running all eight in sequence now leaves the database at the
exact pure-seed baseline after *every* run:

```
User=10 PatientProfile=3 DoctorProfile=6 Appointment=4
ConsultationSession=4 Availability=31 Notification=5 SymptomSpecialtyMap=18
```

Reclaimed per run: sub3-happy 2/2, sub3-auth — (below), l6s2 1/1, l6s3 1/1,
l6s4 5/5, l7s4 3/3, sub5-backend 5/5, sub5-bell-ui 10/10.

**Bugs found in the migration — recorded because each was a silent-liar class.**

1. **The helper's first version always claimed success.** It used
   `DELETE ... RETURNING id` and treated non-empty stdout as success. Under
   `-t -A`, psql emits the command tag `DELETE 0` for a zero-row delete, so stdout
   is *never* empty and a no-op printed `reclaimed 1/1`. Fixed by parsing the row
   count out of the command tag.
2. **The register response is flat — `{ accessToken, userId, role }`, not
   `{ user: { id } }`.** Reading `reg.user.id` yields `undefined`; the tracker's
   `if (id)` guard silently no-ops, so a harness would leak while reporting clean.
   The captured field is **`reg.userId`**.
3. **`Notification` has no foreign key to `Appointment`.** `\d "Notification"`
   shows only `Notification_userId_fkey`. Deleting an appointment therefore does
   **not** remove its notifications, and booking against a *seeded* doctor leaves
   rows on that doctor's feed forever. `trackNotification()` exists for this, and
   `Notification` is deleted first in the plan. Found by watching the Notification
   count drift 5 → 10 across a full-sequence run.
4. **`evidence-sub3-auth.mjs` was already broken** before this work: its "403
   account unavailable" step used a seeded **ACTIVE** patient, so the login
   succeeded and the step passed on an empty alert string; the leftover session
   then got every later step bounced by the auth guard, crashing 5 of 7 steps with
   `Cannot read properties of null (reading 'tagName')` — while the harness exited
   **0**. Steps now reset session state first, the 403 step asserts that a 403 was
   actually observed, and the harness exits non-zero on any FAIL.
5. **`evidence-sub5-bell-ui.mjs` reported `reclaimed 2/2 slots`** while leaving
   User 10→12, Appointment 4→6, Notification 5→13. The slot-only count hid two
   accounts, two `CANCELLED` appointments and eight notifications.

The canonical harness pattern is now `scripts/lib/reclaim.mjs`; items 3 and 7
describe the two legitimate variants (reclaim-by-captured-id and zero-fixture).

**Why it matters.** `GET /admin/users` lists every PATIENT/DOCTOR account ordered
`createdAt desc` and `GET /admin/appointments` lists everything ordered
`scheduledAt desc`. Untended, harness residue sorts to the *top* of both, so the
admin console (Layer 8) degrades into a wall of test junk — and a reviewer cannot
tell a rendering fault from leftover noise.

**Observed scale (before the fix).** By the start of Layer 8 the database held 69
accounts, of which **58 were harness orphans (84%)**, plus 29 cancelled-appointment
residue rows on seeded accounts and 10 sessions whose state contradicted their
appointment.

**What it took.** `scripts/lib/reclaim.mjs`, adopted by all eight harnesses. There
is no user-DELETE endpoint in the API — only `Availability` has one — so cleanup
shells out to SQL (as `scripts/db-clean-harness-users.sh` does). Clean-up is
**per-item and reported**, and only deletes what that run created.

**Residual risk (accepted).** `kill -9` / `SIGKILL` does not run exit hooks, so a
hard kill still leaks. A fresh run of the same harness reclaims its own new
fixtures but cannot know about the older orphan; `db-clean-harness-users.sh` is
the recovery path for that case.

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

## Documented baseline (pure seed state — no `john@test.com` residue)

A reseed during Layer 9 returned the database to its canonical seed content. This
is what `pnpm --filter backend prisma:seed` produces with nothing else added, and
it is the correct baseline to compare against *immediately after a reseed*:

| Table | Count |
| --- | --- |
| User | 10 (1 admin, 6 doctors, 3 seed patients) |
| PatientProfile | 3 |
| DoctorProfile | 6 |
| Appointment | 4 (3 COMPLETED history + 1 upcoming BOOKED, all Jordan's) |
| ConsultationSession | 4 |
| Availability | 31 |
| SymptomSpecialtyMap | 18 (14 original + `headache`, `migraine`, `sore throat`, `stomach ache`) |

**Two baselines, and the difference matters.** `john@test.com` and its three
appointments are hand-made data that the cleaner deliberately never matches, so
they exist in the *post-clean* baseline but not in a fresh seed. Any harness that
asserts a hard count must say which of the two it expects. A reseed silently
drops the post-clean baseline to the seed baseline — which is what happened here,
and why User reads 10 rather than 11.

## 2. `evidence-cancelled-join.mjs` over-reports its cleanup — RESOLVED

**Status:** RESOLVED (Layer 10 harness task 3). Fixed by adopting
`scripts/lib/reclaim.mjs`, the same helper item 1 introduced.

**The defect (as originally recorded).** In the cleanup block, cancelling a
harness-owned appointment is counted as reclaimed for
`status === 200 || 201 || 409`:

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

**The fix.** The whole cancel-dance cleanup block was removed, not patched. Its
premise was wrong for this route: `PATCH /appointments/:id/cancel` returns **409
when the cancel is refused** because the slot is still consumed, so 409 means the
appointment is *still live and still holding its slot* — the opposite of
reclaimed. Treating "only 200/201 as reclaimed" would have been the minimal
repair, but it still leaves the appointment row, its session and its notifications
behind after a successful cancel. The harness now books against the two private
slots it creates itself, tracks every id it produces
(`trackSlot` / `trackAppointment` / `trackNotification`), and lets the shared
reclaimer delete them by id and report per-item outcomes. Only ids created by the
run are known to the reclaimer, so the doctor's pre-existing schedule is never
touched.

**Notification coverage — the second bug, and the interesting one.** Adopting the
reclaimer is not sufficient here, because `Notification` has no FK to
`Appointment` (item 1, bug 3) and both parties are **seeded** accounts, so nothing
cascades. The harness must therefore snapshot each party's feed and track the
*new* rows. It had to be done for **every mutation**, and the first two attempts
got it wrong in the same way — tracking a later snapshot's delta while a *prior*
mutation's rows sat inside the baseline:

1. First pass tracked only Leg 2's cancel. Leg 1's live-join booking and Leg 2's
   booking each write a `BOOKING_CONFIRMED` to both parties, so **+4** rows were
   left behind. Reported `reclaimed 8/8` while Notification drifted 5 → 9.
2. Second pass snapshotted both feeds *before Leg 2's booking* and used that
   snapshot to isolate the cancel — which by construction includes the booking's
   two rows in the baseline. **+2** left behind, printed `reclaimed 8/8`,
   Notification 5 → 7.

The correct ordering, now in the file: snapshot both feeds **before any booking**,
then after *each* booking call `trackNewNotifications` (isolating that booking's
rows), and only then re-snapshot for the cancel. The rows are tagged
`BOOKING_CONFIRMED` (×4: two per booking, one per party) and
`APPOINTMENT_CANCELLED` (×2) — six notifications, all tracked.

**Measured result.** Three consecutive runs:

```
run 1  exit 0   13 passed, 0 failed   reclaimed 10/10   baseline restored
run 2  exit 0   13 passed, 0 failed   reclaimed 10/10   baseline restored
run 3  exit 0   13 passed, 0 failed   reclaimed 10/10   baseline restored
```

After each run the database is back at the exact pure-seed baseline (User 10,
PatientProfile 3, DoctorProfile 6, Appointment 4, ConsultationSession 4,
Availability 31, Notification 5, SymptomSpecialtyMap 18). Before the fix the same
harness printed `reclaim 4/4 harness-owned fixtures released` while leaving +2
appointments, +2 sessions and +8 notifications.

**Regression check.** vitest 415/415, jest 143/143, `pnpm lint` exit 0, and
`tsc -b` exit 0 for both packages after the change (the harness is unbuilt script
code, so these confirm no collateral damage rather than exercising it).

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
| Reclaim via shared helper | all eight item-1 harnesses | `scripts/lib/reclaim.mjs` |
| Reclaim by captured user id (pre-helper, retained) | `evidence-layer8-sub2-admin-doctors.mjs` | `process.on('exit')` + SIGINT, SQL delete by id |
| Zero-fixture | `evidence-layer8-sub4-admin-dashboard.mjs` | n/a — creates nothing |

**Why it matters for review.** A reviewer comparing harnesses will notice sub-item
4 lacks a cleanup block and that no `l8s4%` prefix exists. That is correct, not an
oversight. The rule the three patterns share: **a harness may only remove what
that run created** — which reduces to "removes nothing" when it creates nothing.

**Superseded note.** The former "residue everything" row (`l6s2` and friends,
which leaked by design) is gone — those harnesses now use the shared helper. See
item 1.

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

## 10. The landing widget's canned concerns — RESOLVED, kept for the reasoning

**Status:** RESOLVED (Layer 9 follow-up commit). Kept because the *verification*
lesson is still live: the bug passed three separate rounds of green tests.

**What was wrong.** The quick-book widget on the public landing page offers the
design's 7 Filipino body parts (Ulo, Lalamunan, Dibdib, Tiyan, Likod, Balat,
Iba pa). The first implementation gave each part a natural Filipino concern —
Ulo → `masakit ang ulo`, Tiyan → `masakit ang tiyan`. The seeded
symptom→specialty table is entirely **English**, and
`matchSymptomToSpecialties` does a normalized contains-match in **both**
directions, which tolerates noise ("chest" matches "chest pain") but **cannot
cross languages**. All six canned paths returned **zero doctors** while the
widget looked wired end to end.

**The second bug, which is the interesting one.** The first fix pointed each chip
at the *nearest phrase the table happened to contain*: Ulo → `anxiety`,
Tiyan → `fever`. That made the numbers non-zero, so the harness went green — but
tapping **"Ulo" ("head") showed a PSYCHIATRIST** and "Tiyan" ("stomach") returned
paediatricians. "Returns results" and "returns the *right* results" are different
claims. Only the second is what the button promised.

**Resolution.** Four symptom rows were added to the seed — `headache`,
`migraine`, `sore throat`, `stomach ache` — and the chips re-pointed at them:

| Part | Sends | Resolves to | Doctors |
|---|---|---|---|
| Ulo | `headache` | General Medicine | 2 |
| Lalamunan | `sore throat` | General Medicine | 2 |
| Dibdib | `chest pain` | Cardiology | 1 |
| Tiyan | `stomach ache` | General Medicine | 2 |
| Likod | `fatigue` | General Medicine | 2 |
| Balat | `rash` | Dermatology | 1 |
| Iba pa | *(typed)* | — | — |

No new doctors were added. Only five specializations have doctors
(Cardiology, Dermatology, General Medicine ×2, Pediatrics, Psychiatry); mapping
Ulo→Neurology or Tiyan→Gastroenterology would have resolved to a specialty with
**zero doctors** — a different dead end, not a fix. Headache and stomach ache are
primary-care complaints, so General Medicine is both clinically reasonable and
actually staffed. The four new phrases were checked to be substring-disjoint from
every existing row, since a phrase contained in another row would silently
over-match.

**The verification lesson — three green runs over a broken widget.** This took
three attempts to catch, each pass satisfying the previous assertion:

1. **R10–R14 drove only typed free text** — the one path that cannot dead-end,
   because the user supplies the words. Nothing ever submitted a canned chip.
   R13 *explicitly accepts* an empty match as a valid outcome (correct for free
   text, wrong for a canned chip), so it was satisfied by the failure.
2. **R16** ("each canned chip resolves to >0 doctors") then passed on the
   *second* bug, because `anxiety` and `fever` do return doctors. It only ever
   asked whether results came back, never whether they were sensible.
3. **R17, first version, passed while the widget was still broken.** It queried
   the API with its **own hardcoded phrase list** rather than reading what the
   widget actually sent — so it verified the seed table, not the product. This
   was caught by deliberately reintroducing the bug and observing R17 stay green.

R17 now reads the concern out of the running page (click the chip, submit, read
`sessionStorage`) and only then asserts it is the expected symptom *and* the
expected specialty. Both R16 and R17 were confirmed to FAIL when the regression
is reintroduced, with exit 1 and a message naming the mis-wired chip.

**Guards now in place.**
- `body-parts.test.ts` pins the concern for each part, asserts every concern is
  in the seeded vocabulary, and forbids the Ulo→anxiety / Tiyan→fever pair.
- `R16` drives all six real buttons through auth and requires >0 doctors.
- `R17` drives all six real buttons and requires the correct *specialty*.

**Baseline note.** Adding four rows to `SymptomSpecialtyMap` changes that table
(14 → 18 rows); it does not change User/PatientProfile/DoctorProfile/Appointment/
ConsultationSession/Availability. A reseed performed during this work also
returned the database to pure seed state — see the baseline section below.

## 11. Patients are seeded with zero notifications, so the bell's read paths are unproven

**Status:** OPEN — a fixture gap found during the harness work, needs a decision.

**What is unproven.** The seed gives **no patient any notifications**. Counts by
user on a fresh seed:

```
dr.okafor@example.com   5
every other account     0
```

The only account with a populated feed is a doctor. Consequences for
`scripts/evidence-sub5-backend.mjs`, which exercises the notification contract as
`jordan.lee@example.com`:

- Section 2 `patient has >=1 notification` is **false by construction**.
- Section 3 (ordering) and section 4 (unread count) therefore pass **vacuously** —
  an empty array is trivially sorted and has a valid count of 0.
- Section 5 (mark-read flips the row) cannot run: there is no row to mark.
- Section 6 (cross-user 403) cannot run: it needs a real row belonging to someone
  else, and it would otherwise PATCH `/notifications/undefined/read` and return
  400, which is *not* evidence of the ownership rule.

Sections 8 (generation) and 9 (empty state) create their own data and **do** pass
genuinely. Section 7 (404) also passes genuinely.

**How this surfaced.** The harness used to *crash* at section 5 —
`TypeError: Cannot read properties of undefined (reading 'id')` — which aborted
the run, so sections 6–9 never executed at all. The harness appeared to exist and
its coverage was assumed. It now reports the gap as named FAILs and continues.
Verified pre-existing by running the pristine `HEAD` version, which crashes at the
same line.

**Why it was not fixed here.** Choosing which account demonstrates the bell is a
product-evidence decision (the harness could be repointed at `dr.okafor` to go
green), and doing that unattended could disguise the fact that **patients receive
no seeded notifications** — which may itself be a seeding defect worth attention.
`db-clean-harness-users.sh` note: the harness is still *clean* — it reclaims
5/5 fixtures and leaves Notification at baseline.

**What it would take.** Decide whether patients should be seeded with
notifications (changing the documented baseline and any harness asserting it), or
whether the harness should authenticate as the account that has them. Either way
the four sections above need a genuine fixture, not a vacuous one.

## 12. `evidence-sub3-auth.mjs` cannot exercise the 403 login branch

**Status:** OPEN — same root cause as item 3 (no non-ACTIVE account is seeded).

**What is unproven.** `auth.service.ts` rejects a login with **403** when the
credentials are valid but `accountState !== ACTIVE`. **Every seeded account is
ACTIVE** (`SELECT email, role, "accountState" FROM "User"` returns ACTIVE for all
10), so the branch cannot be reached by any harness.

**How this surfaced.** The step was passing **vacuously** — it logged in as the
seeded ACTIVE patient `alex.kim@example.com`, the login *succeeded*, and the step
returned an empty alert string, which its pass-condition never checked. The
leftover session then broke five subsequent steps (see item 1, bug 4). The step
now asserts that a 403 was actually observed and **FAILS** with
`expected 403 (stay on /login) but landed on /patient/discover — fixture is
ACTIVE, no 403 observed`.

**What it would take.** Seed a non-ACTIVE account (e.g. a `PENDING` or `REJECTED`
doctor) — the same fixture item 3 identifies as missing — or have the harness
register a doctor and have an admin reject it before attempting the login. Until
then this step is expected to be red, and it is red for a **real** reason.

**Note.** `l8s2-admin-doctors.mjs` already registers a `PENDING` doctor and
reclaims it, so the machinery for creating a non-ACTIVE account exists; the
missing piece is a decision about seeding one.
