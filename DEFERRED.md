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

## 2. Notification timestamps render in UTC

`Notification` is a frozen leaf table with only a `string message`, so the server
has no user locale and messages embed UTC times (e.g. "8 Jun 2028, 06:03 UTC").
Notifications are append-only, so pre-fix rows keep their ISO strings forever.
A fix is forward-only; no scope was agreed for it.

## 3. No screen has ever been visually inspected

Verification is DOM/behavioural only. Layout, spacing, colour, and overflow are
unverified — PNGs cannot be read back for review.
