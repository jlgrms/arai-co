#!/bin/zsh
# Sub-item 8 end-to-end evidence. Drives the REAL API against the seeded DB.
# Writes all output to /tmp/evidence-sub8.txt (cat it back as a separate step).
#
# IDEMPOTENCY: this script must NOT depend on a clean DB. Every slot it needs is
# created fresh within the run, using a per-run unique time offset so reruns do
# not collide with slots (or leftover appointments) from a previous run. Every
# id it depends on is asserted non-empty before use; a missing id aborts the run
# loudly rather than silently exercising the wrong DB state.
BASE=http://localhost:3000
OUTFILE=/tmp/evidence-sub8.txt

# pick <json-field>  -> reads JSON on stdin, prints j[field] (no eval).
pick() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d)[process.argv[1]])}catch(e){console.log('PARSE_ERR')}})" "$1"; }

# require_id <label> <value>  -> abort if value is empty/undefined/PARSE_ERR.
require_id() { case "$2" in ""|"undefined"|"null"|"PARSE_ERR") echo "FATAL: expected non-empty id for [$1], got [$2]. Aborting."; exit 1;; esac; }

# Unique per-run minute offset so slot times differ on every invocation,
# avoiding collisions with leftover availability from earlier runs.
RUN_OFFSET=$(( $(date +%s) % 100000 ))
slot_time() { node -e "const d=new Date(Date.UTC(2027,5,1,9,0,0));d.setUTCMinutes(d.getUTCMinutes()+Number(process.argv[1]));console.log(d.toISOString())" "$1"; }
slot_end()  { node -e "const d=new Date(Date.UTC(2027,5,1,9,0,0));d.setUTCMinutes(d.getUTCMinutes()+Number(process.argv[1])+30);console.log(d.toISOString())" "$1"; }

exec > "$OUTFILE" 2>&1

line() { echo "=============================================="; echo "$1"; echo "=============================================="; }

line "1. AUTH — login seeded patient (Jordan Lee) and two doctors"
PTOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"jordan.lee@example.com","password":"PatientPass123!"}' | pick accessToken)
DTOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"dr.patel@example.com","password":"DoctorPass123!"}' | pick accessToken)
D2TOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"dr.chen@example.com","password":"DoctorPass123!"}' | pick accessToken)
echo "patient token len: ${#PTOK}"
echo "doctor  token len: ${#DTOK}"
echo "doctor2 token len: ${#D2TOK}"
require_id "patient token" "$PTOK"
require_id "doctor token" "$DTOK"

# create_slot <offset-minutes>  -> POSTs a fresh slot, prints its id.
create_slot() {
  local off=$1 st en
  st=$(slot_time "$off"); en=$(slot_end "$off")
  curl -s -X POST $BASE/doctors/me/availability -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' \
    -d "{\"startTime\":\"$st\",\"endTime\":\"$en\"}" | pick id
}

line "2. DOCTOR creates 3 future availability slots (fresh per run)"
SLOT1=$(create_slot $((RUN_OFFSET)))
SLOT2=$(create_slot $((RUN_OFFSET + 1000)))
SLOT3=$(create_slot $((RUN_OFFSET + 2000)))
echo "run offset: $RUN_OFFSET"
echo "slot1=$SLOT1 slot2=$SLOT2 slot3=$SLOT3"
require_id "slot1" "$SLOT1"
require_id "slot2" "$SLOT2"
require_id "slot3" "$SLOT3"

line "3. BOOK — patient books slot1; both parties must get a Notification"
APPT=$(curl -s -X POST $BASE/appointments -H "Authorization: Bearer $PTOK" -H 'Content-Type: application/json' -d "{\"availabilityId\":\"$SLOT1\"}" | pick id)
echo "appointment=$APPT"
require_id "appointment (booking slot1)" "$APPT"
echo "-- patient notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $PTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('count:',j.length);console.log('latest:',JSON.stringify(j[0]||null))})"
echo "-- doctor notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $DTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('count:',j.length);console.log('latest:',JSON.stringify(j[0]||null))})"

line "4. RESCHEDULE — patient moves appt to slot2; both parties notified"
curl -s -X PATCH $BASE/appointments/$APPT/reschedule -H "Authorization: Bearer $PTOK" -H 'Content-Type: application/json' -d "{\"availabilityId\":\"$SLOT2\"}" >/dev/null
echo "-- patient notifications (most recent first) --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $PTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('latest type:',(j[0]||{}).type)})"
echo "-- doctor notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $DTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('latest type:',(j[0]||{}).type)})"

line "5. CANCEL — patient cancels; both parties notified"
curl -s -X PATCH $BASE/appointments/$APPT/cancel -H "Authorization: Bearer $PTOK" >/dev/null
echo "-- patient notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $PTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('latest type:',(j[0]||{}).type)})"
echo "-- doctor notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $DTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('latest type:',(j[0]||{}).type)})"

line "6. SCOPING + ORDERING — patient GET /notifications/me"
curl -s $BASE/notifications/me -H "Authorization: Bearer $PTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('count:',j.length);console.log('types:',j.map(n=>n.type).join(','));const ts=j.map(n=>n.createdAt);const sorted=[...ts].sort().reverse();console.log('most-recent-first:',JSON.stringify(ts)===JSON.stringify(sorted));})"

line "7. MARK READ — own ok; another user's -> 403"
PID=$(curl -s $BASE/notifications/me -H "Authorization: Bearer $PTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log((JSON.parse(d)[0]||{}).id||'')})")
echo "patient notification id: $PID"
require_id "patient notification id" "$PID"
echo "-- PATCH own (expect read:true) --"
curl -s -o /tmp/r1.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/notifications/$PID/read -H "Authorization: Bearer $PTOK"; cat /tmp/r1.json; echo
DID=$(curl -s $BASE/notifications/me -H "Authorization: Bearer $DTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log((JSON.parse(d)[0]||{}).id||'')})")
echo "doctor notification id: $DID"
require_id "doctor notification id" "$DID"
echo "-- patient PATCHes DOCTOR's notification (expect 403) --"
curl -s -o /tmp/r2.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/notifications/$DID/read -H "Authorization: Bearer $PTOK"; cat /tmp/r2.json; echo

line "8. FLAG 1 — editing/blocking/deleting a CONSUMED slot -> 409"
# Create a dedicated slot AND its own consuming appointment in this section,
# so the guard is exercised regardless of what earlier sections/runs left behind.
CONSUMED=$(create_slot $((RUN_OFFSET + 3000)))
echo "consumed slot: $CONSUMED"
require_id "consumed slot" "$CONSUMED"
APPT2=$(curl -s -X POST $BASE/appointments -H "Authorization: Bearer $PTOK" -H 'Content-Type: application/json' -d "{\"availabilityId\":\"$CONSUMED\"}" | pick id)
echo "live appointment consuming that slot: $APPT2"
require_id "live appointment on consumed slot" "$APPT2"
echo "-- doctor PATCHes consumed slot (edit time) — expect 409 --"
curl -s -o /tmp/r3.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/doctors/me/availability/$CONSUMED -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' -d "{\"startTime\":\"$(slot_time $((RUN_OFFSET + 9000)))\",\"endTime\":\"$(slot_end $((RUN_OFFSET + 9000)))\"}"; cat /tmp/r3.json; echo
echo "-- doctor DELETEs consumed slot — expect 409 --"
curl -s -o /tmp/r4.json -w 'HTTP %{http_code}\n' -X DELETE $BASE/doctors/me/availability/$CONSUMED -H "Authorization: Bearer $DTOK"; cat /tmp/r4.json; echo
echo "-- doctor PATCHes a FREE slot (fresh, never booked) — expect 200 --"
FREE=$(create_slot $((RUN_OFFSET + 4000)))
require_id "free slot" "$FREE"
curl -s -o /tmp/r5.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/doctors/me/availability/$FREE -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' -d '{"isBlocked":true}'; cat /tmp/r5.json; echo

echo
echo "DONE"
