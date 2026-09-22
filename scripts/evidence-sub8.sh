#!/bin/zsh
# Sub-item 8 end-to-end evidence. Drives the REAL API against the seeded DB.
# Writes all output to /tmp/evidence-sub8.txt (cat it back as a separate step).
BASE=http://localhost:3000
OUTFILE=/tmp/evidence-sub8.txt

# pick <json-field>  -> reads JSON on stdin, prints j[field] (no eval).
pick() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d)[process.argv[1]])}catch(e){console.log('PARSE_ERR')}})" "$1"; }

exec > "$OUTFILE" 2>&1

line() { echo "=============================================="; echo "$1"; echo "=============================================="; }

line "1. AUTH — login seeded patient (Jordan Lee) and two doctors"
PTOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"jordan.lee@example.com","password":"PatientPass123!"}' | pick accessToken)
DTOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"dr.patel@example.com","password":"DoctorPass123!"}' | pick accessToken)
D2TOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"dr.chen@example.com","password":"DoctorPass123!"}' | pick accessToken)
echo "patient token len: ${#PTOK}"
echo "doctor  token len: ${#DTOK}"
echo "doctor2 token len: ${#D2TOK}"

line "2. DOCTOR creates 3 future availability slots"
SLOT1=$(curl -s -X POST $BASE/doctors/me/availability -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' -d '{"startTime":"2027-05-01T09:00:00.000Z","endTime":"2027-05-01T09:30:00.000Z"}' | pick id)
SLOT2=$(curl -s -X POST $BASE/doctors/me/availability -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' -d '{"startTime":"2027-05-02T09:00:00.000Z","endTime":"2027-05-02T09:30:00.000Z"}' | pick id)
SLOT3=$(curl -s -X POST $BASE/doctors/me/availability -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' -d '{"startTime":"2027-05-03T09:00:00.000Z","endTime":"2027-05-03T09:30:00.000Z"}' | pick id)
echo "slot1=$SLOT1 slot2=$SLOT2 slot3=$SLOT3"

line "3. BOOK — patient books slot1; both parties must get a Notification"
APPT=$(curl -s -X POST $BASE/appointments -H "Authorization: Bearer $PTOK" -H 'Content-Type: application/json' -d "{\"availabilityId\":\"$SLOT1\"}" | pick id)
echo "appointment=$APPT"
echo "-- patient notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $PTOK"; echo
echo "-- doctor notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $DTOK"; echo

line "4. RESCHEDULE — patient moves appt to slot2; both parties notified"
curl -s -X PATCH $BASE/appointments/$APPT/reschedule -H "Authorization: Bearer $PTOK" -H 'Content-Type: application/json' -d "{\"availabilityId\":\"$SLOT2\"}" >/dev/null
echo "-- patient notifications (most recent first) --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $PTOK"; echo
echo "-- doctor notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $DTOK"; echo

line "5. CANCEL — patient cancels; both parties notified"
curl -s -X PATCH $BASE/appointments/$APPT/cancel -H "Authorization: Bearer $PTOK" >/dev/null
echo "-- patient notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $PTOK"; echo
echo "-- doctor notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $DTOK"; echo

line "6. SCOPING + ORDERING — patient GET /notifications/me"
curl -s $BASE/notifications/me -H "Authorization: Bearer $PTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('count:',j.length);console.log('types:',j.map(n=>n.type).join(','));const ts=j.map(n=>n.createdAt);const sorted=[...ts].sort().reverse();console.log('most-recent-first:',JSON.stringify(ts)===JSON.stringify(sorted));})"

line "7. MARK READ — own ok; another user's -> 403"
PID=$(curl -s $BASE/notifications/me -H "Authorization: Bearer $PTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d)[0].id)})")
echo "patient notification id: $PID"
echo "-- PATCH own (expect read:true) --"
curl -s -o /tmp/r1.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/notifications/$PID/read -H "Authorization: Bearer $PTOK"; cat /tmp/r1.json; echo
DID=$(curl -s $BASE/notifications/me -H "Authorization: Bearer $DTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d)[0].id)})")
echo "doctor notification id: $DID"
echo "-- patient PATCHes DOCTOR's notification (expect 403) --"
curl -s -o /tmp/r2.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/notifications/$DID/read -H "Authorization: Bearer $PTOK"; cat /tmp/r2.json; echo

line "8. FLAG 1 — editing/blocking/deleting a CONSUMED slot -> 409"
APPT2=$(curl -s -X POST $BASE/appointments -H "Authorization: Bearer $PTOK" -H 'Content-Type: application/json' -d "{\"availabilityId\":\"$SLOT3\"}" | pick id)
echo "live appointment on slot3: $APPT2"
echo "-- doctor PATCHes slot3 (edit time) while consumed (expect 409) --"
curl -s -o /tmp/r3.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/doctors/me/availability/$SLOT3 -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' -d '{"startTime":"2027-05-03T10:00:00.000Z","endTime":"2027-05-03T10:30:00.000Z"}'; cat /tmp/r3.json; echo
echo "-- doctor DELETEs slot3 while consumed (expect 409) --"
curl -s -o /tmp/r4.json -w 'HTTP %{http_code}\n' -X DELETE $BASE/doctors/me/availability/$SLOT3 -H "Authorization: Bearer $DTOK"; cat /tmp/r4.json; echo
echo "-- doctor PATCHes a FREE slot2 (freed by reschedule) — expect 200 --"
curl -s -o /tmp/r5.json -w 'HTTP %{http_code}\n' -X PATCH $BASE/doctors/me/availability/$SLOT2 -H "Authorization: Bearer $DTOK" -H 'Content-Type: application/json' -d '{"isBlocked":true}'; cat /tmp/r5.json; echo

echo
echo "DONE"
