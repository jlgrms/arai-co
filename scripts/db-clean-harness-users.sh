#!/usr/bin/env bash
# Remove harness-created throwaway accounts (and, by cascade, everything they
# own: patient profile -> appointments -> consultation sessions -> notes and
# prescriptions), restoring the documented seed baseline.
#
# WHY THIS EXISTS
#   Eleven harnesses called POST /auth/register/patient once per run and never
#   removed the account. Only SLOTS were brought under the "put it back" rule
#   (commit a513584); accounts were not, so they accumulated silently. By the
#   time Layer 8 (admin console) was started, 58 of 68 accounts in the database
#   were harness leftovers -- and because GET /admin/users orders by
#   createdAt desc, those leftovers sorted ABOVE the three real patients and
#   swamped the admin Users screen. Fixing the screens could not fix that.
#
# SCOPE / SAFETY
#   - Matches ONLY the known harness email prefixes. Anything else is left alone
#     (e.g. john@test.com, which is not attributable to a harness).
#   - There is no user-delete endpoint in the API (only availability DELETE), so
#     this is necessarily SQL. The schema cascades User -> PatientProfile ->
#     Appointment -> ConsultationSession -> Note/Prescription, so deleting the
#     User row removes the whole subtree in one statement.
#   - Verified before first use: every appointment owned by these accounts was
#     CANCELLED (31) or RESCHEDULED (4) -- zero BOOKED, zero COMPLETED -- and no
#     such account owned a doctor-side Availability. No real booking or schedule
#     data is destroyed.
#   - Idempotent: re-running after a clean is a no-op. Safe to run any time.
#
# SECTION 2 -- cancelled-appointment residue on SEED accounts
#   Section 1 removes orphaned accounts. It does NOT remove the damage the
#   ACCOUNT-REUSING harnesses did: those booked their fixture against the real
#   seeded patients (Jordan) and cancelled it, leaving the CANCELLED appointment
#   row on a real account. Deleted accounts cascade away; these rows do not.
#
#   Measured before this section was added: 30 CANCELLED appointments, of which
#   29 sat on seeded patients and 1 on john@test.com. The seed itself creates NO
#   cancelled appointments, so all 29 are residue. The john@test.com row is
#   deliberately LEFT ALONE -- john is not a harness account and is preserved by
#   section 1 too, so its data is treated as hand-made until told otherwise.
#
#   Also normalises session state: 10 sessions carried a state contradicting
#   their appointment (JOINED/IN_PROGRESS on a CANCELLED appointment -- leftovers
#   from the cancelled-join probe). Layer 8 sub-item 3 renders appointment status
#   and session state side by side, so these render as incoherent rows.
#   Normalisation only ever moves a session DOWN to SCHEDULED, never up, and only
#   where the appointment is CANCELLED -- it cannot fabricate progress.
#
#   NOTE (a measurement worth recording): the seeded live session 521c060a is
#   BOOKED + JOINED. That is NOT a contradiction -- it is the intended live
#   consultation -- so 2b scopes strictly to CANCELLED and leaves it alone. An
#   earlier count of 11 conflated the two; the true contradiction count is 10.
#
# USAGE
#   scripts/db-clean-harness-users.sh           # dry run: report only
#   scripts/db-clean-harness-users.sh --apply   # delete
set -euo pipefail

PSQL=(docker exec telehealth-postgres psql -U telehealth -d telehealth)
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

# Prefixes owned by harnesses (see scripts/evidence-*.mjs). `l7s4` covers
# l7s4-, l7s4ui-, l7s4drive-, l7s4msg-; `l8s1` covers l8s1-ui-. Add the Layer 8+
# prefixes here as those harnesses are written, or their fixtures are
# unreclaimable and the admin console degrades again.
PREFIXES=('bell.%' 'l7s4%' 'uibook-%' 'uidisc-%' 'uimatch-%' 'notif-%' 'l8s1%')

WHERE="u.email LIKE '${PREFIXES[0]}'"
for p in "${PREFIXES[@]:1}"; do WHERE="$WHERE OR u.email LIKE '$p'"; done

echo "== Harness-owned accounts =="
"${PSQL[@]}" -c "SELECT u.email, u.role FROM \"User\" u WHERE $WHERE ORDER BY u.email;"

COUNT=$("${PSQL[@]}" -t -A -c "SELECT count(*) FROM \"User\" u WHERE $WHERE;")
echo "Matched: $COUNT account(s)"

if [[ "$APPLY" -eq 1 ]]; then
  echo
  echo "== Deleting (cascades to profiles, appointments, sessions, notes, prescriptions) =="
  "${PSQL[@]}" -c "DELETE FROM \"User\" u WHERE $WHERE;"
fi

# ---------------------------------------------------------------------------
# Section 2 -- cancelled-appointment residue on SEED accounts.
# Section 1 already cascaded away everything owned by deleted accounts; what
# remains is residue left on accounts that survive (the seeded patients).
# ---------------------------------------------------------------------------

# Residue = CANCELLED appointments on patients that are NOT harness accounts.
# Excluding harness emails keeps this correct whether or not section 1 ran first
# (the account cascade would already have taken them).
SEED_CANCELLED="a.status = 'CANCELLED' AND u.email NOT LIKE 'john@test.com'"
for p in "${PREFIXES[@]}"; do SEED_CANCELLED="$SEED_CANCELLED AND u.email NOT LIKE '$p'"; done

echo
echo "== Section 2a: cancelled-appointment residue on seed accounts =="
"${PSQL[@]}" -c "SELECT a.id, a.status, a.\"scheduledAt\"::date AS when, dp.name AS doctor, pp.name AS patient FROM \"Appointment\" a JOIN \"PatientProfile\" pp ON pp.id=a.\"patientProfileId\" JOIN \"User\" u ON u.id=pp.\"userId\" JOIN \"DoctorProfile\" dp ON dp.id=a.\"doctorProfileId\" WHERE $SEED_CANCELLED ORDER BY a.\"scheduledAt\";"
RESIDUE=$("${PSQL[@]}" -t -A -c "SELECT count(*) FROM \"Appointment\" a JOIN \"PatientProfile\" pp ON pp.id=a.\"patientProfileId\" JOIN \"User\" u ON u.id=pp.\"userId\" WHERE $SEED_CANCELLED;")
echo "Matched: $RESIDUE appointment(s)  (john@test.com rows are never matched)"

echo
echo "== Section 2b: sessions whose state contradicts a CANCELLED appointment =="
"${PSQL[@]}" -c "SELECT cs.id, cs.state, a.status, a.\"scheduledAt\"::date AS when FROM \"ConsultationSession\" cs JOIN \"Appointment\" a ON a.id=cs.\"appointmentId\" WHERE a.status='CANCELLED' AND cs.state <> 'SCHEDULED';"
CONTRADICT=$("${PSQL[@]}" -t -A -c "SELECT count(*) FROM \"ConsultationSession\" cs JOIN \"Appointment\" a ON a.id=cs.\"appointmentId\" WHERE a.status='CANCELLED' AND cs.state <> 'SCHEDULED';")
echo "Matched: $CONTRADICT session(s)"

if [[ "$APPLY" -eq 0 ]]; then
  echo
  echo "DRY RUN -- nothing deleted. Re-run with --apply to delete."
  exit 0
fi

echo
echo "== Section 2b: normalising contradictory session state to SCHEDULED =="
# Runs BEFORE 2a's delete on purpose. Deleting an appointment cascades its
# session away, so if 2b ran second it would match nothing whenever 2a matched
# something -- the statement would silently be dead code. Normalising first also
# keeps the two sections independent: 2b still cleans contradictions sitting on
# cancelled appointments that 2a deliberately spares (e.g. john@test.com).
#
# Only ever FROM a started state TO SCHEDULED, and only on CANCELLED
# appointments -- so this can never invent progress. Clears the join timestamps
# so the row is internally consistent rather than SCHEDULED-with-joinedAt.
"${PSQL[@]}" -c "UPDATE \"ConsultationSession\" cs SET state='SCHEDULED', \"joinedAt\"=NULL, \"patientJoinedAt\"=NULL, \"doctorJoinedAt\"=NULL, \"completedAt\"=NULL FROM \"Appointment\" a WHERE cs.\"appointmentId\"=a.id AND a.status='CANCELLED' AND cs.state <> 'SCHEDULED';"

echo
echo "== Section 2a: deleting residue appointments =="
"${PSQL[@]}" -c "DELETE FROM \"Appointment\" a USING \"PatientProfile\" pp, \"User\" u WHERE a.\"patientProfileId\"=pp.id AND pp.\"userId\"=u.id AND $SEED_CANCELLED;"

echo
echo "== Final state =="
for t in "User" "PatientProfile" "DoctorProfile" "Appointment" "ConsultationSession" "Availability"; do
  printf "%-22s %s\n" "$t" "$("${PSQL[@]}" -t -A -c "SELECT count(*) FROM \"$t\";")"
done
echo
"${PSQL[@]}" -c "SELECT a.status, cs.state, count(*) FROM \"Appointment\" a JOIN \"ConsultationSession\" cs ON cs.\"appointmentId\"=a.id GROUP BY a.status, cs.state ORDER BY a.status, cs.state;"
