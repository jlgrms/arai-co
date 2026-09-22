#!/bin/zsh
# Generate REAL notification data for dr.chen@example.com (and Jordan Lee) by
# driving the actual booking flow through the API. Dr. Chen is a doctor, so a
# notification is created for the doctor when a patient books one of Chen's
# availability slots.
BASE=http://localhost:3000

# pick <json-field> -> print j[field] from stdin.
pick() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d)[process.argv[1]])}catch(e){console.log('PARSE_ERR')}})" "$1"; }

# Unique per-run minute offset so reruns don't collide with earlier slots.
RUN_OFFSET=$(( ($(date +%s) % 100000) + 50000 ))
slot_time() { node -e "const d=new Date(Date.UTC(2027,5,1,9,0,0));d.setUTCMinutes(d.getUTCMinutes()+Number(process.argv[1]));console.log(d.toISOString())" "$1"; }
slot_end()  { node -e "const d=new Date(Date.UTC(2027,5,1,9,0,0));d.setUTCMinutes(d.getUTCMinutes()+Number(process.argv[1])+30);console.log(d.toISOString())" "$1"; }

PTOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"jordan.lee@example.com","password":"PatientPass123!"}' | pick accessToken)
CTOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"dr.chen@example.com","password":"DoctorPass123!"}' | pick accessToken)
echo "patient token len: ${#PTOK}"
echo "chen    token len: ${#CTOK}"

ST=$(slot_time $RUN_OFFSET); EN=$(slot_end $RUN_OFFSET)
SLOT=$(curl -s -X POST $BASE/doctors/me/availability -H "Authorization: Bearer $CTOK" -H 'Content-Type: application/json' -d "{\"startTime\":\"$ST\",\"endTime\":\"$EN\"}" | pick id)
echo "chen slot id: $SLOT"

APPT=$(curl -s -X POST $BASE/appointments -H "Authorization: Bearer $PTOK" -H 'Content-Type: application/json' -d "{\"availabilityId\":\"$SLOT\"}" | pick id)
echo "chen booking appointment id: $APPT"

echo "-- dr.chen notifications --"
curl -s $BASE/notifications/me -H "Authorization: Bearer $CTOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('count:',j.length);console.log('latest:',JSON.stringify(j[0]||null))})"