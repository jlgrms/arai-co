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

## 3. Notification timestamps render in UTC

`Notification` is a frozen leaf table with only a `string message`, so the server
has no user locale and messages embed UTC times (e.g. "8 Jun 2028, 06:03 UTC").
Notifications are append-only, so pre-fix rows keep their ISO strings forever.
A fix is forward-only; no scope was agreed for it.

## 4. No screen has ever been visually inspected

Verification is DOM/behavioural only. Layout, spacing, colour, and overflow are
unverified — PNGs cannot be read back for review.
