#!/usr/bin/env bash
# Sub-item 7 REST verification: consultation notes & prescriptions.
# Real HTTP against the running backend on :3000. Transcript -> stdout.
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0
hdr() { printf '\n===== %s =====\n' "$1"; }
check() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then printf 'PASS  %-58s (got %s)\n' "$desc" "$actual"; PASS=$((PASS+1))
  else printf 'FAIL  %-58s (got %s, expected %s)\n' "$desc" "$actual" "$expected"; FAIL=$((FAIL+1)); fi
}
http() {
  local method="$1" url="$2" token="$3" body="${4:-}"
  if [ -n "$body" ]; then curl -s -w '\n%{http_code}' -X "$method" "$url" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data-binary "$body"
  else curl -s -w '\n%{http_code}' -X "$method" "$url" -H "Authorization: Bearer $token"; fi
}
split_status() { STATUS="${1##*$'\n'}"; BODY="${1%$'\n'*}"; }
jget() { printf '%s' "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print($2)" 2>/dev/null; }

hdr "0. LOGIN"
PL=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' --data-binary "$(printf '{"email":"%s","password":"%s"}' 'jordan.lee@example.com' 'PatientPass123!')")
DL=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' --data-binary "$(printf '{"email":"%s","password":"%s"}' 'dr.chen@example.com' 'DoctorPass123!')")
OL=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' --data-binary "$(printf '{"email":"%s","password":"%s"}' 'sam.rivera@example.com' 'PatientPass123!')")
ODL=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' --data-binary "$(printf '{"email":"%s","password":"%s"}' 'dr.patel@example.com' 'DoctorPass123!')")
PT=$(jget "$PL" "d['accessToken']"); DT=$(jget "$DL" "d['accessToken']"); OT=$(jget "$OL" "d['accessToken']"); ODT=$(jget "$ODL" "d['accessToken']")
PID=$(jget "$PL" "str(d['userId'])")
check "patient token present" "$(jget "$PL" "str(bool(d.get('accessToken')))")" "True"
check "doctor token present" "$(jget "$DL" "str(bool(d.get('accessToken')))")" "True"
check "other doctor token present" "$(jget "$ODL" "str(bool(d.get('accessToken')))")" "True"

hdr "1. Book a session (patient) -- try open slots until one books"
AV=$(http GET "$BASE/doctors/me/availability" "$DT"); split_status "$AV"
SLOTS_RAW=$(printf '%s' "$BODY" | python3 -c "import sys,json; s=json.load(sys.stdin); print(' '.join(x['id'] for x in s if not x.get('isBlocked')))" 2>/dev/null)
if [ -z "$SLOTS_RAW" ]; then echo ABORT no open slot; exit 2; fi
SID=""; BOOK_STATUS=""
for SLOT in $SLOTS_RAW; do
  BOOK=$(http POST "$BASE/appointments" "$PT" "$(printf '{"availabilityId":"%s"}' "$SLOT")"); split_status "$BOOK"
  if [ "$STATUS" = "201" ]; then SID=$(jget "$BODY" "d['consultationSession']['id']"); BOOK_STATUS="201"; break; fi
done
check "booking eventually 201 (skipping already-consumed slots)" "$BOOK_STATUS" "201"
if [ -z "$SID" ] || [ "$SID" = "None" ]; then echo ABORT no session after trying all slots; exit 2; fi
# patientProfileId (NOT userId) is the identifier the doctor-records route keys on
PID=$(jget "$BODY" "d['patientProfileId']")
printf 'session: %s  patientProfileId: %s\n' "$SID" "$PID"

hdr "2. SCHEDULED gate: write + patient-read blocked (409)"
N=$(http POST "$BASE/consultations/$SID/notes" "$DT" "$(printf '{"findings":"%s"}' 'premature')"); split_status "$N"
check "note write in SCHEDULED -> 409" "$STATUS" "409"
R=$(http GET "$BASE/consultations/$SID/records" "$PT"); split_status "$R"
check "patient read in SCHEDULED -> 409" "$STATUS" "409"

hdr "3. Patient joins -> JOINED; gates still block"
http POST "$BASE/consultations/$SID/join" "$PT" >/dev/null
N=$(http POST "$BASE/consultations/$SID/notes" "$DT" "$(printf '{"findings":"%s"}' 'x')"); split_status "$N"
check "note write in JOINED -> 409" "$STATUS" "409"

hdr "4. Doctor joins -> IN_PROGRESS; writes allowed"
J=$(http POST "$BASE/consultations/$SID/join" "$DT"); split_status "$J"
check "doctor join -> IN_PROGRESS" "$(jget "$BODY" "d['state']")" "IN_PROGRESS"

NOTE_BODY=$(printf '{"findings":"%s","recommendations":"%s"}' 'Patient reports intermittent chest tightness, no radiation.' 'Order ECG; follow up in 2 weeks.')
N1=$(http POST "$BASE/consultations/$SID/notes" "$DT" "$NOTE_BODY"); split_status "$N1"
check "note write in IN_PROGRESS -> 201" "$STATUS" "201"
NOTE1_ID=$(jget "$BODY" "d['id']")
check "note returned findings" "$(jget "$BODY" "d['findings']")" "Patient reports intermittent chest tightness, no radiation."

P1=$(http POST "$BASE/consultations/$SID/prescriptions" "$DT" "$(printf '{"details":"%s"}' 'Aspirin 81mg PO daily; cardiology follow-up.')"); split_status "$P1"
check "prescription write in IN_PROGRESS -> 201" "$STATUS" "201"
check "prescription details echoed" "$(jget "$BODY" "d['details']")" "Aspirin 81mg PO daily; cardiology follow-up."

hdr "5. Read gating in IN_PROGRESS"
R=$(http GET "$BASE/consultations/$SID/records" "$PT"); split_status "$R"
check "patient read in IN_PROGRESS -> 409 (not COMPLETED)" "$STATUS" "409"
R=$(http GET "$BASE/consultations/$SID/records" "$DT"); split_status "$R"
check "doctor read in IN_PROGRESS -> 200" "$STATUS" "200"
check "doctor sees 1 note" "$(jget "$BODY" "len(d['notes'])")" "1"
check "doctor sees 1 prescription" "$(jget "$BODY" "len(d['prescriptions'])")" "1"

hdr "6. Doctor completes -> COMPLETED; writes still allowed; patient read opens"
C=$(http POST "$BASE/consultations/$SID/complete" "$DT"); split_status "$C"
check "complete -> COMPLETED" "$(jget "$BODY" "d['state']")" "COMPLETED"

N2=$(http POST "$BASE/consultations/$SID/notes" "$DT" "$(printf '{"recommendations":"%s"}' 'Consult summary: stable, continue aspirin.')"); split_status "$N2"
check "append-only: 2nd note in COMPLETED -> 201" "$STATUS" "201"
R=$(http GET "$BASE/consultations/$SID/records" "$DT"); split_status "$R"
check "doctor now sees 2 notes" "$(jget "$BODY" "len(d['notes'])")" "2"
R=$(http GET "$BASE/consultations/$SID/records" "$PT"); split_status "$R"
check "patient read in COMPLETED -> 200" "$STATUS" "200"
check "patient sees 2 notes" "$(jget "$BODY" "len(d['notes'])")" "2"
check "patient sees prescription" "$(jget "$BODY" "len(d['prescriptions'])")" "1"

hdr "7. Patient medical-records view (GET /consultations/records/me)"
MR=$(http GET "$BASE/consultations/records/me" "$PT"); split_status "$MR"
check "patient records/me -> 200" "$STATUS" "200"
check "records/me includes this session" "$(jget "$BODY" "str(any(s['sessionId'] == '$SID' for s in d))")" "True"

hdr "8. RBAC + validation"
W=$(http POST "$BASE/consultations/$SID/notes" "$PT" "$(printf '{"findings":"%s"}' 'patient trying to write')"); split_status "$W"
check "patient writing a note -> 403 (doctor-only)" "$STATUS" "403"
O=$(http GET "$BASE/consultations/$SID/records" "$OT"); split_status "$O"
check "non-participant patient read -> 403" "$STATUS" "403"
OD=$(http GET "$BASE/consultations/records/patient/$PID" "$ODT"); split_status "$OD"
check "unrelated doctor reads patient records -> 403" "$STATUS" "403"
E=$(http POST "$BASE/consultations/$SID/notes" "$DT" '{}'); split_status "$E"
check "empty note -> 400" "$STATUS" "400"
E=$(http POST "$BASE/consultations/$SID/prescriptions" "$DT" '{"details":""}'); split_status "$E"
check "empty prescription details -> 400" "$STATUS" "400"

hdr "9. Doctor views this patient's records (own appointment relation)"
DR=$(http GET "$BASE/consultations/records/patient/$PID" "$DT"); split_status "$DR"
check "related doctor reads patient records -> 200" "$STATUS" "200"
check "related doctor sees >=1 session" "$(jget "$BODY" "str(len(d) >= 1)")" "True"

hdr "SUMMARY"
printf 'PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then echo "RESULT: ALL NOTES/PRESCRIPTION CHECKS PASSED"; exit 0; else echo "RESULT: FAILURES PRESENT"; exit 1; fi
