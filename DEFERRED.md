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

## 4. Notification timestamps render in UTC

`Notification` is a frozen leaf table with only a `string message`, so the server
has no user locale and messages embed UTC times (e.g. "8 Jun 2028, 06:03 UTC").
Notifications are append-only, so pre-fix rows keep their ISO strings forever.
A fix is forward-only; no scope was agreed for it.

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

**This entry is due at the end of Layer 8.** Sub-item 4 was the last screen in
the layer to add a new composition, so the close-out visual pass should now cover
all four admin screens plus the four layers of accumulated debt.

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

