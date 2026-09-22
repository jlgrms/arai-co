#!/bin/zsh
# Sub-item 9 end-to-end evidence — ADMIN SERVICES (S5.4). Drives the REAL API.
# Writes all output to /tmp/evidence-sub9.txt (cat it back as a separate step).
#
# IDEMPOTENCY: never depends on a clean DB. Every slot/appointment it needs is
# created fresh within the run with a per-run unique minute offset, so reruns do
# not collide with slots (or leftover appointments) from earlier runs. Every id
# it relies on is asserted non-empty before use (require_id); a missing id aborts
# loudly rather than silently exercising the wrong DB state.
BASE=http://localhost:3000
OUTFILE=/tmp/evidence-sub9.txt

# pick <json-field>  -> reads JSON on stdin, prints j[field] (no eval).
pick() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d)[process.argv[1]])}catch(e){console.log('PARSE_ERR')}})" "$1"; }

# require_id <label> <value>  -> abort if value is empty/undefined/PARSE_ERR.
require_id() { case "$2" in ""|"undefined"|"null"|"PARSE_ERR") echo "FATAL: expected non-empty id for [$1], got [$2]. Aborting."; exit 1;; esac; }

# Unique per-run minute offset so slot times differ on every invocation.
RUN_OFFSET=$(( $(date +%s) % 100000 ))
slot_time() { node -e "const d=new Date(Date.UTC(2027,5,1,9,0,0));d.setUTCMinutes(d.getUTCMinutes()+Number(process.argv[1]));console.log(d.toISOString())" "$1"; }
slot_end()  { node -e "const d=new Date(Date.UTC(2027,5,1,9,0,0));d.setUTCMinutes(d.getUTCMinutes()+Number(process.argv[1])+30);console.log(d.toISOString())" "$1"; }

# extract array element field: el <index> <field>  (reads JSON array on stdin)
el() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log((j[Number(process.argv[1])]||{})[process.argv[2]]??'')}catch(e){console.log('PARSE_ERR')}})" "$1" "$2"; }
# count of array on stdin
len() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).length)}catch(e){console.log('PARSE_ERR')}})"; }

exec > "$OUTFILE" 2>&1

line() { echo "=============================================="; echo "$1"; echo "=============================================="; }

line "1. AUTH — login seeded ADMIN, patient, doctor"
ATOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"AdminPass123!"}' | pick accessToken)
PTOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"jordan.lee@example.com","password":"PatientPass123!"}' | pick accessToken)
DTOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"dr.patel@example.com","password":"DoctorPass123!"}' | pick accessToken)
echo "admin   token len: ${#ATOK}"
echo "patient token len: ${#PTOK}"
echo "doctor  token len: ${#DTOK}"
require_id "admin token" "$ATOK"
require_id "patient token" "$PTOK"
require_id "doctor token" "$DTOK"

# create_slot <offset-minutes> -> POSTs a fresh slot as the doctor, prints its id.
create_slot() {
  local off=$1 st en
  st=$(slot_time "$off"); en=$(slot_end "$off")
  curl -s -X POST $BASE/doctors/me/availability -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' \
    -d "{\"startTime\":\"$st\",\"endTime\":\"$en\"}" | pick id
}

line "2. GET /admin/users — admin lists users (patients + doctors; no admins leaked)"
curl -s $BASE/admin/users -H "Authorization: Bearer $ATOK" > /tmp/u.json
echo "HTTP body bytes: $(wc -c < /tmp/u.json)"
echo "user count: $(cat /tmp/u.json | len)"
echo "roles present: $(node -e "const j=require('/tmp/u.json');console.log([...new Set(j.map(u=>u.role))].join(','))")"
echo "any ADMIN row leaked?: $(node -e "const j=require('/tmp/u.json');console.log(j.some(u=>u.role==='ADMIN'))")"
echo "passwordHash leaked in any row?: $(node -e "const j=require('/tmp/u.json');console.log(j.some(u=>'passwordHash' in u))")"
echo "-- filter role=DOCTOR --"
curl -s "$BASE/admin/users?role=DOCTOR" -H "Authorization: Bearer $ATOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('count:',j.length,'allDoctors:',j.every(u=>u.role==='DOCTOR'))})"

line "3. PATCH /admin/users/:id/state — suspend a user (reason optional), audit written"
# Self-provision: pick a PATIENT row (not the caller, not an admin).

TARGET_USER=$(curl -s "$BASE/admin/users?role=PATIENT" -H "Authorization: Bearer $ATOK" | el 0 id)
echo "target user id: $TARGET_USER"
require_id "target user id" "$TARGET_USER"
echo "-- suspend WITH reason (expect 200 + accountState SUSPENDED) --"
curl -s -o /tmp/s1.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/admin/users/$TARGET_USER/state -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"accountState":"SUSPENDED","reason":"evidence run"}'; cat /tmp/s1.json; echo
echo "-- reactivate WITHOUT reason (reason optional; expect 200) --"
curl -s -o /tmp/s2.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/admin/users/$TARGET_USER/state -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"accountState":"ACTIVE"}'; cat /tmp/s2.json; echo
echo "-- invalid accountState (expect 400) --"
curl -s -o /tmp/s3.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/admin/users/$TARGET_USER/state -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"accountState":"NOPE"}'; cat /tmp/s3.json; echo

line "4. GET /admin/doctors — list doctor profiles"
curl -s $BASE/admin/doctors -H "Authorization: Bearer $ATOK" > /tmp/d.json
echo "doctor profile count: $(cat /tmp/d.json | len)"
DOCID=$(cat /tmp/d.json | el 0 id)
echo "first doctor profile id: $DOCID"
require_id "doctor profile id" "$DOCID"

# --- Reversibility: snapshot + trap-based restore of the doctor we mutate below.
# Sections 5/6 mutate specialization + approvalStatus on $DOCID. Only biography is
# left untouched, so we snapshot just those two fields from /tmp/d.json and restore
# them via the review endpoint on ANY exit (success or failure).
recur() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const o=(j.find(x=>x.id===process.argv[1]))||{};console.log(o[process.argv[2]]??'')}catch(e){console.log('')}})" "$1" "$2"; }
SNAP_SPEC=$(cat /tmp/d.json | recur "$DOCID" specialization)
SNAP_STATUS=$(cat /tmp/d.json | recur "$DOCID" approvalStatus)
echo "snapshot for $DOCID — specialization:[$SNAP_SPEC] approvalStatus:[$SNAP_STATUS]"

restore_doctor() {
  echo "-- [trap] restoring doctor $DOCID (specialization + approvalStatus) --"
  # Build payload with only non-empty string values (DTO @IsNotEmpty rejects "").
  local payload
  payload=$(node -e "const s=process.argv[1],a=process.argv[2];const o={};if(typeof s==='string'&&s.length>0)o.specialization=s;if(typeof a==='string'&&a.length>0)o.approvalStatus=a;console.log(JSON.stringify(o))" "$SNAP_SPEC" "$SNAP_STATUS")
  curl -s -o /dev/null -w 'restore HTTP %{http_code}\n' -X PATCH $BASE/admin/doctors/$DOCID/review -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d "$payload"
}
trap restore_doctor EXIT

line "5. PATCH /admin/doctors/:id/review — approve + direct edit (Flag 2), audit written"
echo "-- approve current first doctor (expect 200, approvalStatus APPROVED) --"
curl -s -o /tmp/rv1.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/admin/doctors/$DOCID/review -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"approvalStatus":"APPROVED","reason":"evidence approve"}'; cat /tmp/rv1.json; echo
echo "-- direct edit specialization (expect 200) --"
curl -s -o /tmp/rv2.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/admin/doctors/$DOCID/review -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"specialization":"General Medicine"}'; cat /tmp/rv2.json; echo

line "6. REGRESSION R2 — admin review DTO validation PARITY with doctor self-service (no bypass)"
echo "-- empty name (IsNotEmpty) — expect 400 --"
curl -s -o /tmp/rv3.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/admin/doctors/$DOCID/review -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"name":""}'; cat /tmp/rv3.json; echo
echo "-- empty specialization — expect 400 --"
curl -s -o /tmp/rv4.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/admin/doctors/$DOCID/review -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"specialization":""}'; cat /tmp/rv4.json; echo
echo "-- unknown field (forbidNonWhitelisted) — expect 400 --"
curl -s -o /tmp/rv5.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/admin/doctors/$DOCID/review -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"approvalStatus":"APPROVED","email":"hacker@evil.com"}'; cat /tmp/rv5.json; echo
echo "-- empty payload — expect 400 (service rejects no-review-fields) --"
curl -s -o /tmp/rv6.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/admin/doctors/$DOCID/review -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{}'; cat /tmp/rv6.json; echo

line "7. GET /admin/appointments — full oversight view (all appointments)"
curl -s $BASE/admin/appointments -H "Authorization: Bearer $ATOK" > /tmp/ap.json
echo "appointment count: $(cat /tmp/ap.json | len)"
echo "sample row keys: $(node -e "const j=require('/tmp/ap.json');console.log(Object.keys(j[0]||{}).join(','))")"

line "8. ADMIN CANCEL PATH — book a slot, then PATCH cancel via /admin (Flag 3)"
SLOT_A=$(create_slot $((RUN_OFFSET + 5000)))
echo "slot_a=$SLOT_A"
require_id "slot_a" "$SLOT_A"
APPT_A=$(curl -s -X POST $BASE/appointments -H "Authorization: Bearer $PTOK" -H 'Content-Type: application/json' -d "{\"availabilityId\":\"$SLOT_A\"}" | pick id)
echo "appointment_a=$APPT_A"
require_id "appointment_a" "$APPT_A"
echo "-- admin cancels appointment (expect 200, status CANCELLED, availabilityId null) --"
curl -s -o /tmp/ac.json -w 'HTTP %{http_code}\n' -X POST $BASE/admin/appointments/$APPT_A/cancel -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"reason":"invalid booking"}'; cat /tmp/ac.json; echo
echo "-- idempotent re-cancel (expect 200, still CANCELLED, no error) --"
curl -s -o /tmp/ac2.json -w 'HTTP %{http_code}\n' -X POST $BASE/admin/appointments/$APPT_A/cancel -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{}'; cat /tmp/ac2.json; echo

line "9. REGRESSION R3 — cancelled slot is RE-BOOKABLE again (availabilityId nulled)"
echo "-- patient re-books the SAME slot (expect 200/201 + new appointment id) --"
RB=$(curl -s -X POST $BASE/appointments -H "Authorization: Bearer $PTOK" -H 'Content-Type: application/json' -d "{\"availabilityId\":\"$SLOT_A\"}")
echo "$RB"
RBID=$(echo "$RB" | pick id)
echo "rebooked appointment id: $RBID"
require_id "rebooked appointment id" "$RBID"
echo "-- cleanup: cancel the rebooked appt via admin so reruns stay clean --"
curl -s -o /dev/null -w 'cleanup cancel HTTP %{http_code}\n' -X POST $BASE/admin/appointments/$RBID/cancel -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{}'

line "10. REGRESSION R4 — cancelled slot is EDITABLE again (sub-item 8 Flag 1 guard satisfied)"
SLOT_B=$(create_slot $((RUN_OFFSET + 6000)))
echo "slot_b=$SLOT_B"
require_id "slot_b" "$SLOT_B"
APPT_B=$(curl -s -X POST $BASE/appointments -H "Authorization: Bearer $PTOK" -H 'Content-Type: application/json' -d "{\"availabilityId\":\"$SLOT_B\"}" | pick id)
echo "appointment_b=$APPT_B"
require_id "appointment_b" "$APPT_B"
echo "-- while live, doctor editing slot_b must be BLOCKED (expect 409) --"
curl -s -o /tmp/e1.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/doctors/me/availability/$SLOT_B -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' -d '{"isBlocked":true}'; cat /tmp/e1.json; echo
echo "-- admin cancels appointment_b --"
curl -s -o /dev/null -w 'admin cancel HTTP %{http_code}\n' -X POST $BASE/admin/appointments/$APPT_B/cancel -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{}'
echo "-- now doctor editing slot_b must SUCCEED (expect 200) — proves nulling availabilityId released the guard --"
curl -s -o /tmp/e2.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/doctors/me/availability/$SLOT_B -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' -d '{"isBlocked":true}'; cat /tmp/e2.json; echo

line "11. GET /admin/dashboard — DB aggregates via groupBy/count"
curl -s $BASE/admin/dashboard -H "Authorization: Bearer $ATOK" > /tmp/db.json
echo "dashboard bytes: $(wc -c < /tmp/db.json)"
node -e "const j=require('/tmp/db.json');console.log(JSON.stringify(j,null,2))"

line "12. GET /admin/audit-logs — shared AuditService rows, newest first"
curl -s $BASE/admin/audit-logs -H "Authorization: Bearer $ATOK" > /tmp/al.json
echo "audit rows: $(cat /tmp/al.json | len)"
echo "-- latest 5 (action / type / reason) --"
node -e "const j=require('/tmp/al.json');j.slice(0,5).forEach(r=>console.log(r.action,'|',r.affectedRecordType,'|',r.affectedRecordId,'|reason:',r.reason))"
echo "-- ordering newest-first? --"
node -e "const j=require('/tmp/al.json');const ts=j.map(r=>r.timestamp);const s=[...ts].sort().reverse();console.log(JSON.stringify(ts)===JSON.stringify(s))"

line "13. REGRESSION R1 — non-admin is forbidden from admin routes (403)"
echo "-- patient GET /admin/users (expect 403) --"
curl -s -o /tmp/n1.json -w 'HTTP %{http_code}\n' $BASE/admin/users -H "Authorization: Bearer $PTOK"; cat /tmp/n1.json; echo
echo "-- patient GET /admin/dashboard (expect 403) --"
curl -s -o /tmp/n2.json -w 'HTTP %{http_code}\n' $BASE/admin/dashboard -H "Authorization: Bearer $PTOK"; cat /tmp/n2.json; echo
echo "-- doctor PATCH /admin/users/:id/state (expect 403) --"
curl -s -o /tmp/n3.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/admin/users/$TARGET_USER/state -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' -d '{"accountState":"SUSPENDED"}'; cat /tmp/n3.json; echo
echo "-- anonymous GET /admin/users (expect 401) --"
curl -s -o /tmp/n4.json -w 'HTTP %{http_code}\n' $BASE/admin/users; cat /tmp/n4.json; echo

echo
echo "DONE"