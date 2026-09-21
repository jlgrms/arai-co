#!/usr/bin/env bash
# Sub-item 6 REST verification: consultation session state machine.
# Exercises the REAL HTTP contract of ConsultationsController against the
# running backend on :3000. Transcript goes to stdout (caller redirects to a file).
set -u
BASE="http://localhost:3000"
PASS=0
FAIL=0

hdr() { printf '\n===== %s =====\n' "$1"; }
check() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    printf 'PASS  %-58s (got %s)\n' "$desc" "$actual"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  %-58s (got %s, expected %s)\n' "$desc" "$actual" "$expected"
    FAIL=$((FAIL + 1))
  fi
}
print_json() { printf '%s\n' "$1"; printf '%s' "$2" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$2"; }
http() {
  local method="$1" url="$2" token="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -w '\n%{http_code}' -X "$method" "$url" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data-binary "$body"
  else
    curl -s -w '\n%{http_code}' -X "$method" "$url" -H "Authorization: Bearer $token"
  fi
}
split_status() { STATUS="${1##*$'\n'}"; BODY="${1%$'\n'*}"; }
jget() { printf '%s' "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print($2)" 2>/dev/null; }

hdr "0. LOGIN"
PATIENT_LOGIN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' --data-binary "$(printf '{"email":"%s","password":"%s"}' 'jordan.lee@example.com' 'PatientPass123!')")
DOCTOR_LOGIN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' --data-binary "$(printf '{"email":"%s","password":"%s"}' 'dr.chen@example.com' 'DoctorPass123!')")
OTHER_LOGIN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' --data-binary "$(printf '{"email":"%s","password":"%s"}' 'sam.rivera@example.com' 'PatientPass123!')")
P_TOKEN=$(jget "$PATIENT_LOGIN" "d['accessToken']")
D_TOKEN=$(jget "$DOCTOR_LOGIN" "d['accessToken']")
O_TOKEN=$(jget "$OTHER_LOGIN" "d['accessToken']")
print_json "patient login:" "$PATIENT_LOGIN"
print_json "doctor  login:" "$DOCTOR_LOGIN"
check "patient role is PATIENT" "$(jget "$PATIENT_LOGIN" "d['role']")" "PATIENT"
check "doctor role is DOCTOR" "$(jget "$DOCTOR_LOGIN" "d['role']")" "DOCTOR"

hdr "1. GET /doctors/me/availability (doctor)"
AV=$(http GET "$BASE/doctors/me/availability" "$D_TOKEN")
split_status "$AV"
check "availability status 200" "$STATUS" "200"
print_json "availability:" "$BODY"
SLOT_ID=$(printf '%s' "$BODY" | python3 -c "import sys,json; s=json.load(sys.stdin); o=[x for x in s if not x.get('isBlocked')]; print(o[0]['id'] if o else '')" 2>/dev/null)
if [ -z "$SLOT_ID" ]; then echo "ABORT: no open availability slot"; exit 2; fi
printf 'chosen open slot: %s\n' "$SLOT_ID"

hdr "2. POST /appointments (patient) -> creates session atomically"
BOOK_BODY=$(printf '{"availabilityId":"%s"}' "$SLOT_ID")
printf 'request body: %s\n' "$BOOK_BODY"
BOOK=$(http POST "$BASE/appointments" "$P_TOKEN" "$BOOK_BODY")
split_status "$BOOK"
check "booking status 201" "$STATUS" "201"
print_json "booking:" "$BODY"
SESSION_ID=$(jget "$BODY" "d['consultationSession']['id']")
INITIAL_STATE=$(jget "$BODY" "d['consultationSession']['state']")
if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "None" ]; then echo "ABORT: no consultationSession id returned"; exit 2; fi
printf 'session id: %s\n' "$SESSION_ID"
check "session created atomically at booking (SCHEDULED)" "$INITIAL_STATE" "SCHEDULED"

hdr "3. GET /consultations/:id (patient)"
GETS=$(http GET "$BASE/consultations/$SESSION_ID" "$P_TOKEN")
split_status "$GETS"
check "read status 200" "$STATUS" "200"
check "state is SCHEDULED" "$(jget "$BODY" "d['state']")" "SCHEDULED"
check "patientJoinedAt null" "$(jget "$BODY" "str(d['patientJoinedAt']).lower()")" "none"
check "doctorJoinedAt null" "$(jget "$BODY" "str(d['doctorJoinedAt']).lower()")" "none"

hdr "4. POST /consultations/:id/join (patient, first joiner)"
J1=$(http POST "$BASE/consultations/$SESSION_ID/join" "$P_TOKEN")
split_status "$J1"
check "join status 201" "$STATUS" "201"
check "state JOINED after first join" "$(jget "$BODY" "d['state']")" "JOINED"
check "patientJoinedAt set" "$(jget "$BODY" "str(d['patientJoinedAt'] != None)")" "True"
check "doctorJoinedAt still null" "$(jget "$BODY" "str(d['doctorJoinedAt']).lower()")" "none"

hdr "5. POST /consultations/:id/join (patient re-join, idempotent)"
J2=$(http POST "$BASE/consultations/$SESSION_ID/join" "$P_TOKEN")
split_status "$J2"
check "re-join status 201 (no-op)" "$STATUS" "201"
check "state still JOINED after re-join" "$(jget "$BODY" "d['state']")" "JOINED"

hdr "6. POST /consultations/:id/join (doctor, second party)"
J3=$(http POST "$BASE/consultations/$SESSION_ID/join" "$D_TOKEN")
split_status "$J3"
check "doctor join status 201" "$STATUS" "201"
check "state IN_PROGRESS (both present)" "$(jget "$BODY" "d['state']")" "IN_PROGRESS"
check "doctorJoinedAt set" "$(jget "$BODY" "str(d['doctorJoinedAt'] != None)")" "True"

hdr "7. POST /consultations/:id/complete (doctor)"
C1=$(http POST "$BASE/consultations/$SESSION_ID/complete" "$D_TOKEN")
split_status "$C1"
check "complete status 201" "$STATUS" "201"
check "state COMPLETED (doctor-only)" "$(jget "$BODY" "d['state']")" "COMPLETED"
check "completedAt set" "$(jget "$BODY" "str(d['completedAt'] != None)")" "True"

hdr "8. POST /consultations/:id/complete again (expect 409)"
C2=$(http POST "$BASE/consultations/$SESSION_ID/complete" "$D_TOKEN")
split_status "$C2"
check "re-complete status 409" "$STATUS" "409"
print_json "re-complete error body:" "$BODY"

hdr "9. Non-participant (sam.rivera) read+join -> 403"
R1=$(http GET "$BASE/consultations/$SESSION_ID" "$O_TOKEN")
split_status "$R1"
check "other patient READ status 403" "$STATUS" "403"
print_json "other-patient read error:" "$BODY"
R2=$(http POST "$BASE/consultations/$SESSION_ID/join" "$O_TOKEN")
split_status "$R2"
check "other patient JOIN status 403" "$STATUS" "403"
print_json "other-patient join error:" "$BODY"

hdr "SUMMARY"
printf 'PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then echo "RESULT: ALL CONSULTATION SESSION STATE-MACHINE CHECKS PASSED"; exit 0; else echo "RESULT: FAILURES PRESENT"; exit 1; fi
