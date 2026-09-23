import {
  PrismaClient,
  Role,
  AccountState,
  ApprovalStatus,
  AppointmentStatus,
  ConsultationState,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// SEEDED LOGIN CREDENTIALS (fictional prototype data — development only).
// Passwords are hashed with bcrypt below; plaintexts documented here so the app
// is demoable immediately after `docker compose up` + seed.
//
//   ADMIN
//     admin@example.com          AdminPass123!
//
//   DOCTORS (all share DoctorPass123!)
//     dr.chen@example.com     Dr. Wei Chen       Cardiology      APPROVED
//     dr.okafor@example.com   Dr. Amara Okafor   Dermatology     APPROVED
//     dr.patel@example.com    Dr. Rohan Patel    General Medicine APPROVED
//     dr.reyes@example.com    Dr. Camila Reyes   General Medicine APPROVED
//     dr.nguyen@example.com   Dr. Linh Nguyen    Pediatrics      APPROVED
//     dr.silva@example.com    Dr. Mateo Silva    Psychiatry      APPROVED
//
//   BULK APPROVED DOCTORS (same password — 50 generated, for scale/pagination)
//     dr.test001@example.com … dr.test050@example.com
//     Names are drawn deterministically from Filipino given/surname pools; bios
//     are templated per specialty. Specialties cycle across the five above.
//     Emails are zero-padded to three digits (dr.test001, not dr.test1).
//
//   EXPANDED SPECIALTY DOCTORS (same password — 20 more, dr.test051…dr.test070)
//     One per newly-offered specialty, so all 25 specializations in
//     SPECIALIZATIONS have at least one APPROVED doctor behind them. Same
//     generator and naming scheme as the batch above.
//
//   UNREVIEWED DOCTORS (same password — the admin Doctor Review queue fixtures)
//     dr.pending@example.com   Dr. Nadia Haddad   Neurology     PENDING
//     dr.rejected@example.com  Dr. Victor Osei    Orthopedics   REJECTED
//
//   These two exist so the review queue has content on a fresh seed rather than
//   only after a harness has run (DEFERRED item 3). Both are correctly absent
//   from patient-facing discovery, which filters `approvalStatus: APPROVED`.
//
//   PATIENTS (all share PatientPass123!)
//     jordan.lee@example.com   Jordan Lee
//     sam.rivera@example.com   Sam Rivera
//     alex.kim@example.com     Alex Kim
//
//   SUSPENDED PATIENT (same password — the login-403 fixture)
//     suspended.patient@example.com   Suspended Demo
//
//   CONSULTATION HISTORY (Jordan Lee only — see the block at the end of main()).
//   Jordan has 3 COMPLETED consultations with notes and prescriptions across
//   General Medicine, Psychiatry and Dermatology, plus 1 upcoming SCHEDULED
//   session. Sign in as jordan.lee@example.com to demo the patient consultation
//   workspace and the medical records view. Other patients intentionally have no
//   history so the empty states are also reachable.
// ---------------------------------------------------------------------------

const ADMIN_PASSWORD = 'AdminPass123!';
const DOCTOR_PASSWORD = 'DoctorPass123!';
const PATIENT_PASSWORD = 'PatientPass123!';

async function main(): Promise<void> {
  console.log('Seeding database...');

  // Clear in dependency order (safe idempotent re-seed).
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.prescription.deleteMany();
  await prisma.consultationNote.deleteMany();
  await prisma.consultationSession.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.doctorProfile.deleteMany();
  await prisma.patientProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.symptomSpecialtyMap.deleteMany();

  // --- admin (pre-provisioned; no public admin-registration route exists) ---
  await prisma.user.create({
    data: {
      email: 'admin@example.com',
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS),
      role: Role.ADMIN,
      accountState: AccountState.ACTIVE,
    },
  });

  // --- doctors across different specializations ---
  const doctorPasswordHash = await bcrypt.hash(DOCTOR_PASSWORD, BCRYPT_ROUNDS);
  const doctorSeeds = [
    { email: 'dr.chen@example.com', name: 'Dr. Wei Chen', specialization: 'Cardiology', biography: 'Board-certified cardiologist with 12 years of experience in preventive and interventional care.' },
    { email: 'dr.okafor@example.com', name: 'Dr. Amara Okafor', specialization: 'Dermatology', biography: 'Dermatologist focused on chronic skin conditions and procedural dermatology.' },
    { email: 'dr.patel@example.com', name: 'Dr. Rohan Patel', specialization: 'General Medicine', biography: 'Primary-care physician handling general consultations and chronic disease management.' },
    // Second General Medicine doctor. Added for Layer 6 sub-item 3 (guided
    // matching): every other seeded specialty has exactly one doctor, so the
    // "multiple doctors match your symptom" grouping case would not be
    // demoable without a second doctor sharing a specialty.
    { email: 'dr.reyes@example.com', name: 'Dr. Camila Reyes', specialization: 'General Medicine', biography: 'Family physician focused on preventive care and long-term condition management for adults.' },
    { email: 'dr.nguyen@example.com', name: 'Dr. Linh Nguyen', specialization: 'Pediatrics', biography: 'Pediatrician caring for infants, children, and adolescents.' },
    { email: 'dr.silva@example.com', name: 'Dr. Mateo Silva', specialization: 'Psychiatry', biography: 'Psychiatrist specialising in anxiety, mood disorders, and telehealth follow-ups.' },
  ];

  const doctorProfiles = [];
  for (const d of doctorSeeds) {
    const user = await prisma.user.create({
      data: {
        email: d.email,
        passwordHash: doctorPasswordHash,
        role: Role.DOCTOR,
        accountState: AccountState.ACTIVE,
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: user.id,
        name: d.name,
        biography: d.biography,
        specialization: d.specialization,
        approvalStatus: ApprovalStatus.APPROVED,
      },
    });
    doctorProfiles.push(profile);
  }

  // -------------------------------------------------------------------------
  // BULK APPROVED DOCTORS — 50 generated, for scale/pagination demos.
  //
  // WHY APPEND-ONLY: `doctorProfiles` is indexed POSITIONALLY further down this
  // file — `consultationSeeds` reads `doctorProfiles[2]`, `[5]` and `[1]`, and
  // the upcoming-consultation block reads `doctorProfiles[2]` directly. Those
  // are ABSOLUTE indices, so this block may only PUSH onto the end of the array.
  // Inserting, prepending, sorting, or splicing anywhere above would silently
  // repoint Jordan's three consultations and their notes/prescriptions, and the
  // seeded upcoming session, at the wrong doctors — with no error, because every
  // index would still be in range.
  //
  // WHY BEFORE THE AVAILABILITY LOOP: that loop iterates `doctorProfiles` and
  // creates 5 weekday slots per entry. Pushing here means these 50 inherit the
  // existing slot pattern for free rather than duplicating that logic, and they
  // land AFTER the six originals, so the original doctors' slots are unchanged.
  //
  // Scope: APPROVED only. The PENDING/REJECTED review-queue fixtures and the
  // SUSPENDED login fixture are deliberately left alone — those states exist to
  // make specific UI branches reachable and inflating them would change what
  // those screens demonstrate.
  //
  // Note this ADDS 50 x 5 = 250 availability rows on top of the documented
  // baseline. Anything asserting a hard doctor or slot count must be updated.
  // -------------------------------------------------------------------------
  const BULK_DOCTOR_COUNT = 50;

  // Short templated bios, one per specialty. Kept generic on purpose — these are
  // backdrop volume, not characters, so no bio should claim a specific
  // credential that would look odd repeated.
  const bulkSpecialtyBios: Record<string, string> = {
    Cardiology:
      'Cardiologist providing outpatient assessment for chest pain, palpitations, and blood-pressure management.',
    Dermatology:
      'Dermatologist treating common skin complaints including acne, eczema, and rashes.',
    'General Medicine':
      'Primary-care physician for general consultations, minor illness, and long-term condition follow-up.',
    Pediatrics:
      'Pediatrician providing routine care and assessment for infants, children, and adolescents.',
    Psychiatry:
      'Psychiatrist supporting patients with anxiety, low mood, and sleep difficulties.',
  };

  // Realistic Filipino given/surname pools. Combined deterministically below so
  // the generated set is stable across re-seeds (a random pick would churn the
  // fixtures on every seed and make any name-based assertion flaky).
  const filipinoFirstNames = [
    'Maria', 'Jose', 'Ana', 'Ramon', 'Lourdes', 'Carlos', 'Teresa', 'Miguel',
    'Rosario', 'Antonio', 'Cristina', 'Eduardo', 'Josefina', 'Ricardo',
    'Bella', 'Fernando', 'Corazon', 'Alfredo', 'Marilou', 'Rogelio',
    'Editha', 'Benigno', 'Luzviminda', 'Arturo', 'Remedios', 'Danilo',
  ];
  const filipinoLastNames = [
    'Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza',
    'Torres', 'Villanueva', 'Aquino', 'Castillo', 'Ramos', 'Del Rosario',
    'Mercado', 'Salazar', 'Domingo', 'Navarro', 'Gutierrez',
    'Fernandez', 'Pascual',
  ];

  const bulkSpecialties = Object.keys(bulkSpecialtyBios);
  for (let i = 0; i < BULK_DOCTOR_COUNT; i++) {
    // Deterministic spread across specialties, then across the name pools, so a
    // given index always yields the same doctor. Coprime strides keep the pairs
    // from cycling together and repeating a full name early.
    const specialization = bulkSpecialties[i % bulkSpecialties.length]!;
    const first = filipinoFirstNames[(i * 7) % filipinoFirstNames.length]!;
    const last = filipinoLastNames[(i * 3) % filipinoLastNames.length]!;
    const num = String(i + 1).padStart(3, '0');

    const user = await prisma.user.create({
      data: {
        email: `dr.test${num}@example.com`,
        passwordHash: doctorPasswordHash,
        role: Role.DOCTOR,
        accountState: AccountState.ACTIVE,
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: user.id,
        name: `Dr. ${first} ${last}`,
        biography: bulkSpecialtyBios[specialization]!,
        specialization,
        approvalStatus: ApprovalStatus.APPROVED,
      },
    });
    // PUSH ONLY — see the positional warning above.
    doctorProfiles.push(profile);
  }

  // -------------------------------------------------------------------------
  // EXPANDED SPECIALTY LIST — one doctor per newly-offered specialty.
  //
  // The product's specialty list grew from 5 to 25 (see SPECIALIZATIONS in
  // apps/frontend/src/features/doctor/doctor-types.ts). A specialty with no
  // doctor behind it is a dead end twice over: the guided-matching result is
  // empty, and discovery's specialization filter returns nothing. So every
  // newly-listed specialty gets at least one APPROVED doctor here.
  //
  // The AI matcher needs no separate list: `DoctorsService.availableSpecialties()`
  // derives the model's options from the distinct specializations of APPROVED
  // doctors. Seeding these doctors IS how the AI list is updated.
  //
  // SAME APPEND-ONLY RULE as the block above: push, never insert. The positional
  // reads (`doctorProfiles[1|2|5]`) are further down and must keep resolving to
  // the original Dr. Okafor / Dr. Patel / Dr. Silva.
  // -------------------------------------------------------------------------
  const expandedSpecialtyBios: Record<string, string> = {
    'Internal Medicine':
      'Internist managing complex adult conditions, multimorbidity, and coordinated care.',
    Neurology: 'Neurologist assessing headache, seizure, and movement disorders.',
    Orthopedics: 'Orthopedic specialist for joint, bone, and musculoskeletal complaints.',
    Gastroenterology: 'Gastroenterologist treating digestive and liver conditions.',
    Endocrinology: 'Endocrinologist managing diabetes, thyroid, and hormonal disorders.',
    Pulmonology: 'Pulmonologist treating asthma, COPD, and other respiratory conditions.',
    'Otolaryngology (ENT)':
      'ENT specialist for ear, nose, throat, and sinus complaints.',
    Ophthalmology: 'Ophthalmologist for vision problems and eye disease.',
    Urology: 'Urologist treating urinary tract and male reproductive conditions.',
    Nephrology: 'Nephrologist managing kidney disease and related conditions.',
    Rheumatology: 'Rheumatologist for arthritis, autoimmune, and joint disease.',
    'Obstetrics & Gynecology':
      'OB-GYN providing women\u2019s health, prenatal, and reproductive care.',
    'Allergy & Immunology':
      'Allergist assessing allergies, sensitivities, and immune disorders.',
    'Infectious Disease':
      'Infectious disease specialist for complex and persistent infections.',
    Hematology: 'Hematologist managing blood disorders and related conditions.',
    Geriatrics: 'Geriatrician focused on the health of older adults.',
    Podiatry: 'Podiatrist treating foot, ankle, and lower limb conditions.',
    'Sleep Medicine':
      'Sleep specialist assessing insomnia, sleep apnea, and related disorders.',
    'Physical Therapy & Rehabilitation':
      'Physiotherapist supporting recovery, mobility, and rehabilitation.',
    Urogynecology:
      'Urogynecologist treating pelvic floor disorders and related conditions.',
  };

  const expandedSpecialties = Object.keys(expandedSpecialtyBios);
  for (let i = 0; i < expandedSpecialties.length; i++) {
    // Continue the pool offsets from the 50-doctor batch so expanded names do
    // not collide with it, and stay deterministic across re-seeds.
    const offset = i + BULK_DOCTOR_COUNT;
    const specialization = expandedSpecialties[i]!;
    const first = filipinoFirstNames[(offset * 7) % filipinoFirstNames.length]!;
    const last = filipinoLastNames[(offset * 3) % filipinoLastNames.length]!;
    const num = String(offset + 1).padStart(3, '0');

    const user = await prisma.user.create({
      data: {
        email: `dr.test${num}@example.com`,
        passwordHash: doctorPasswordHash,
        role: Role.DOCTOR,
        accountState: AccountState.ACTIVE,
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: user.id,
        name: `Dr. ${first} ${last}`,
        biography: expandedSpecialtyBios[specialization]!,
        specialization,
        approvalStatus: ApprovalStatus.APPROVED,
      },
    });
    // PUSH ONLY — see the positional warning above.
    doctorProfiles.push(profile);
  }

  // -------------------------------------------------------------------------
  // UNREVIEWED DOCTORS — the doctor-review queue's own fixtures (DEFERRED item 3).
  //
  // WHY: every doctor above is written APPROVED. The schema default is PENDING,
  // but nothing was ever *seeded* in that state, so on a fresh `docker compose
  // up` the admin Doctor Review screen's pending queue was EMPTY and the first
  // thing a reviewer saw was the empty state rather than the workflow the screen
  // exists to demonstrate. `evidence-layer8-sub2-admin-doctors.mjs` covered this
  // by registering a throwaway doctor per run, which works but means the
  // demonstration depends on a harness having run.
  //
  // WHY THESE ARE NOT IN `doctorProfiles`: that array drives two things this pair
  // must stay out of. (1) Availability is seeded per entry — an unreviewed doctor
  // with bookable slots would be reachable by booking if it were ever approved
  // by accident, and PENDING/REJECTED doctors are correctly excluded from patient
  // discovery (`doctors.service.ts` filters `approvalStatus: APPROVED` on both
  // `discover` and `getPublicDoctor`). (2) `consultationSeeds` indexes into it by
  // position, so appending here would silently repoint those consultations at the
  // wrong doctors. They are created separately and pushed to neither.
  //
  // WHY BOTH STATES: PENDING is the queue's default content; REJECTED is the other
  // non-approved status the review UI must render, and having one of each means
  // the status filter discriminates between three buckets instead of two. The
  // biography of the rejected one records the decision so the screen's inline
  // reason has something real to show, matching how the SUSPENDED fixture above
  // carries a `stateReason`.
  //
  // These ARE documented baseline accounts (DoctorProfile 6 -> 8, User 11 -> 13).
  // Anything asserting a hard doctor count must now expect 8.
  // -------------------------------------------------------------------------
  const unreviewedDoctorSeeds = [
    {
      email: 'dr.pending@example.com',
      name: 'Dr. Nadia Haddad',
      specialization: 'Neurology',
      approvalStatus: ApprovalStatus.PENDING,
      biography:
        'Neurologist with a focus on headache disorders and migraine management. Registration submitted and awaiting review.',
    },
    {
      email: 'dr.rejected@example.com',
      name: 'Dr. Victor Osei',
      specialization: 'Orthopedics',
      approvalStatus: ApprovalStatus.REJECTED,
      biography:
        'Orthopedic surgeon. Registration was rejected during review — the submitted credentials could not be verified against the licensing register. Kept so the rejected state is reachable without a harness.',
    },
  ];

  for (const d of unreviewedDoctorSeeds) {
    const user = await prisma.user.create({
      data: {
        email: d.email,
        passwordHash: doctorPasswordHash,
        role: Role.DOCTOR,
        accountState: AccountState.ACTIVE,
      },
    });
    await prisma.doctorProfile.create({
      data: {
        userId: user.id,
        name: d.name,
        biography: d.biography,
        specialization: d.specialization,
        approvalStatus: d.approvalStatus,
      },
    });
  }

  // --- patients ---
  const patientPasswordHash = await bcrypt.hash(PATIENT_PASSWORD, BCRYPT_ROUNDS);
  const patientSeeds = [
    { email: 'jordan.lee@example.com', name: 'Jordan Lee', contactDetails: 'jordan.lee@example.com', basicMedicalHistory: 'No known chronic conditions. Seasonal allergies.', birthday: new Date('1990-04-12'), weight: 72.5, height: 178 },
    { email: 'sam.rivera@example.com', name: 'Sam Rivera', contactDetails: '+1-555-0142', basicMedicalHistory: 'Mild asthma, managed with inhaler.', birthday: new Date('1985-11-02'), weight: 64.0, height: 165 },
    { email: 'alex.kim@example.com', name: 'Alex Kim', contactDetails: 'alex.kim@example.com', basicMedicalHistory: 'Hypertension, on medication.', birthday: new Date('1978-07-23'), weight: 81.2, height: 172 },
  ];

  const patientProfiles = [];
  for (const p of patientSeeds) {
    const user = await prisma.user.create({
      data: {
        email: p.email,
        passwordHash: patientPasswordHash,
        role: Role.PATIENT,
        accountState: AccountState.ACTIVE,
      },
    });
    const initials = p.name.split(' ').map((n) => n[0]).join('').toUpperCase();
    const profile = await prisma.patientProfile.create({
      data: {
        userId: user.id,
        name: p.name,
        birthday: p.birthday,
        weight: p.weight,
        height: p.height,
        contactDetails: p.contactDetails,
        basicMedicalHistory: p.basicMedicalHistory,
        avatarInitialsOrRef: initials,
      },
    });
    patientProfiles.push(profile);
  }

  // -------------------------------------------------------------------------
  // SUSPENDED ACCOUNT — the login-403 fixture (DEFERRED item 12).
  //
  // WHY: `auth.service.ts` rejects a login with 403 when the credentials are
  // VALID but `accountState !== ACTIVE`. Every other seeded account is ACTIVE, so
  // that branch was unreachable by any harness — `evidence-sub3-auth.mjs`'s
  // "403 account unavailable" step had nothing to hit and could not pass for a
  // real reason. This account exists solely so that branch has a genuine target.
  //
  // WHY A PATIENT: the step drives the same login form as the other auth steps
  // and uses the patient password, so a PATIENT keeps the step's shape unchanged.
  // The 403 logic is role-independent — it keys off `accountState`, not `role` —
  // so a suspended patient exercises exactly the same code path a suspended
  // doctor would.
  //
  // WHY `stateReason` IS SET: the admin console renders the reason inline, and a
  // suspension with no recorded reason renders an empty cell — which would look
  // like a rendering bug when it is actually missing fixture data.
  //
  // This IS a documented baseline account (User 10 -> 11). It is deliberately
  // seeded rather than created by a harness: a login fixture must exist BEFORE
  // any harness runs and must survive independent of any run.
  // -------------------------------------------------------------------------
  const suspendedEmail = 'suspended.patient@example.com';
  const suspendedUser = await prisma.user.create({
    data: {
      email: suspendedEmail,
      passwordHash: patientPasswordHash,
      role: Role.PATIENT,
      accountState: AccountState.SUSPENDED,
      stateReason: 'Suspended by an administrator — see the demo notice.',
    },
  });
  await prisma.patientProfile.create({
    data: {
      userId: suspendedUser.id,
      name: 'Suspended Demo',
      contactDetails: suspendedEmail,
      basicMedicalHistory: 'Account suspended for demonstration of the 403 login path.',
      avatarInitialsOrRef: 'SD',
    },
  });

  // --- availability slots for each doctor (next 5 weekdays, 09:00-10:00) ---
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (const profile of doctorProfiles) {
    for (let day = 1; day <= 5; day++) {
      const start = new Date(base);
      start.setDate(base.getDate() + day);
      start.setHours(9, 0, 0, 0);
      const end = new Date(start);
      end.setHours(10, 0, 0, 0);
      await prisma.availability.create({
        data: {
          doctorProfileId: profile.id,
          startTime: start,
          endTime: end,
          isBlocked: false,
        },
      });
    }
  }

  // --- symptom -> specialty mapping (deterministic matching table, Layer 4) ---
  //
  // NOTE ON SPECIALTIES: only five specializations have doctors behind them
  // (Cardiology, Dermatology, General Medicine x2, Pediatrics, Psychiatry).
  // A symptom mapped to anything else would resolve to a specialty with ZERO
  // doctors — a different dead end, not a fix. So `headache` and `stomach ache`
  // both route to General Medicine, which is where a primary-care physician
  // would in fact see them.
  //
  // `headache` / `migraine` / `stomach ache` / `sore throat` (Layer 9) exist so
  // the landing page's Ulo / Lalamunan / Tiyan chips resolve to a real doctor
  // rather than the nearest-available phrase. Verified disjoint from every other
  // row: matchSymptomToSpecialties does a contains-match in BOTH directions, so
  // a phrase that was a substring of another row would silently over-match.
  const symptomMap = [
    { symptomOrConcern: 'chest pain', specialty: 'Cardiology' },
    { symptomOrConcern: 'palpitations', specialty: 'Cardiology' },
    { symptomOrConcern: 'high blood pressure', specialty: 'Cardiology' },
    { symptomOrConcern: 'rash', specialty: 'Dermatology' },
    { symptomOrConcern: 'acne', specialty: 'Dermatology' },
    { symptomOrConcern: 'eczema', specialty: 'Dermatology' },
    { symptomOrConcern: 'fever', specialty: 'General Medicine' },
    { symptomOrConcern: 'cough', specialty: 'General Medicine' },
    { symptomOrConcern: 'fatigue', specialty: 'General Medicine' },
    { symptomOrConcern: 'headache', specialty: 'General Medicine' },
    { symptomOrConcern: 'migraine', specialty: 'General Medicine' },
    { symptomOrConcern: 'stomach ache', specialty: 'General Medicine' },
    { symptomOrConcern: 'sore throat', specialty: 'General Medicine' },
    { symptomOrConcern: 'child fever', specialty: 'Pediatrics' },
    { symptomOrConcern: 'vaccination', specialty: 'Pediatrics' },
    { symptomOrConcern: 'anxiety', specialty: 'Psychiatry' },
    { symptomOrConcern: 'depression', specialty: 'Psychiatry' },
    { symptomOrConcern: 'insomnia', specialty: 'Psychiatry' },
    // --- expanded specialty list (25 total) ---
    { symptomOrConcern: 'diabetes', specialty: 'Internal Medicine' },
    { symptomOrConcern: 'numbness', specialty: 'Neurology' },
    { symptomOrConcern: 'seizure', specialty: 'Neurology' },
    { symptomOrConcern: 'back pain', specialty: 'Orthopedics' },
    { symptomOrConcern: 'joint pain', specialty: 'Orthopedics' },
    { symptomOrConcern: 'heartburn', specialty: 'Gastroenterology' },
    { symptomOrConcern: 'abdominal pain', specialty: 'Gastroenterology' },
    { symptomOrConcern: 'thyroid problem', specialty: 'Endocrinology' },
    { symptomOrConcern: 'shortness of breath', specialty: 'Pulmonology' },
    { symptomOrConcern: 'asthma', specialty: 'Pulmonology' },
    { symptomOrConcern: 'ear pain', specialty: 'Otolaryngology (ENT)' },
    { symptomOrConcern: 'sinus infection', specialty: 'Otolaryngology (ENT)' },
    { symptomOrConcern: 'blurred vision', specialty: 'Ophthalmology' },
    { symptomOrConcern: 'eye redness', specialty: 'Ophthalmology' },
    { symptomOrConcern: 'painful urination', specialty: 'Urology' },
    { symptomOrConcern: 'kidney stones', specialty: 'Urology' },
    { symptomOrConcern: 'swollen ankles', specialty: 'Nephrology' },
    { symptomOrConcern: 'arthritis', specialty: 'Rheumatology' },
    { symptomOrConcern: 'prenatal checkup', specialty: 'Obstetrics & Gynecology' },
    { symptomOrConcern: 'irregular period', specialty: 'Obstetrics & Gynecology' },
    { symptomOrConcern: 'allergy', specialty: 'Allergy & Immunology' },
    { symptomOrConcern: 'hives', specialty: 'Allergy & Immunology' },
    { symptomOrConcern: 'persistent infection', specialty: 'Infectious Disease' },
    { symptomOrConcern: 'anemia', specialty: 'Hematology' },
    { symptomOrConcern: 'bruising easily', specialty: 'Hematology' },
    { symptomOrConcern: 'memory loss', specialty: 'Geriatrics' },
    { symptomOrConcern: 'foot pain', specialty: 'Podiatry' },
    { symptomOrConcern: 'ingrown toenail', specialty: 'Podiatry' },
    { symptomOrConcern: 'sleep apnea', specialty: 'Sleep Medicine' },
    { symptomOrConcern: 'snoring', specialty: 'Sleep Medicine' },
    { symptomOrConcern: 'knee rehabilitation', specialty: 'Physical Therapy & Rehabilitation' },
    { symptomOrConcern: 'pelvic pain', specialty: 'Urogynecology' },
    { symptomOrConcern: 'bladder leakage', specialty: 'Urogynecology' },
  ];
  await prisma.symptomSpecialtyMap.createMany({ data: symptomMap });

  // -------------------------------------------------------------------------
  // Consultation history for Jordan Lee (Layer 6 sub-item 6 demo data).
  //
  // WHY THIS EXISTS: the consultation state machine is doctor-terminated —
  // `complete` is DOCTOR-only and the terminal COMPLETED state is the ONLY
  // state in which a patient may read their records (READ_PATIENT gate). A
  // patient-only flow can therefore never produce a record. Without seeded
  // history the Medical Records view (sub-item 6) is permanently empty and the
  // patient workspace has no finished consultation to show.
  //
  // These are backdated: the appointment sits in the past, the session's
  // joinedAt/completedAt are set, and the notes/prescriptions are authored as
  // the treating doctor would have written them. Dates are derived from "now"
  // at seed time so the history never drifts into the future.
  // -------------------------------------------------------------------------
  const jordan = patientProfiles[0];
  const completedAt = (daysAgo: number, hour: number): Date => {
    const d = new Date(base);
    d.setDate(base.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  // [doctor index, daysAgo, start hour, note/prescription payload]
  const consultationSeeds = [
    {
      doctorIndex: 2, // Dr. Rohan Patel — General Medicine
      daysAgo: 21,
      hour: 10,
      findings:
        'Patient presented with a persistent dry cough for three weeks, worse at night. Chest clear on auscultation, no fever, no wheeze. Likely post-viral airway irritation.',
      recommendations:
        'Rest, adequate fluids, and a humidifier at night. Avoid smoke and other airway irritants. Return if the cough persists beyond two more weeks or is accompanied by fever, breathlessness, or blood.',
      prescriptions: [
        { details: 'Chlorphenamine 4mg — 1 tablet at night for 5 nights, for sleep disruption from coughing' },
      ],
    },
    {
      doctorIndex: 5, // Dr. Mateo Silva — Psychiatry
      daysAgo: 12,
      hour: 15,
      findings:
        'Follow-up for anxiety with work-related triggers. Reports improved sleep since the last review but continued low-level worry through the working week. No panic episodes in the last month.',
      recommendations:
        'Continue the current dose. Introduce a brief daily breathing exercise. Review again in four weeks; consider referral for talking therapy if symptoms plateau.',
      prescriptions: [
        { details: 'Sertraline 50mg — 1 tablet daily, continue for 4 weeks then review' },
      ],
    },
    {
      doctorIndex: 1, // Dr. Amara Okafor — Dermatology
      daysAgo: 5,
      hour: 11,
      findings:
        'Eczema flare across both forearms and the dorsum of the hands, consistent with a contact irritant trigger. Skin dry with mild lichenification, no evidence of secondary infection.',
      recommendations:
        'Emollient twice daily even when the skin is clear. Use the topical steroid for up to 10 days, then stop. Identify and avoid the suspected irritant; a review is not needed unless the flare recurs.',
      prescriptions: [
        { details: 'Hydrocortisone 1% cream — apply a thin layer to affected areas twice daily for up to 10 days' },
        { details: 'Emollient cream 500g — apply liberally twice daily, continue indefinitely' },
      ],
    },
  ];

  for (const c of consultationSeeds) {
    const doctor = doctorProfiles[c.doctorIndex];
    const when = completedAt(c.daysAgo, c.hour);

    // Past appointment, marked COMPLETED to match its session's terminal state
    // (the two must agree or the records view and the appointment list disagree).
    const appointment = await prisma.appointment.create({
      data: {
        patientProfileId: jordan.id,
        doctorProfileId: doctor.id,
        // No availabilityId: the slot it occupied is long past and leaving it
        // linked would make a historical booking appear to consume a live slot.
        availabilityId: null,
        scheduledAt: when,
        status: AppointmentStatus.COMPLETED,
      },
    });

    const session = await prisma.consultationSession.create({
      data: {
        appointmentId: appointment.id,
        state: ConsultationState.COMPLETED,
        joinedAt: when,
        patientJoinedAt: when,
        doctorJoinedAt: when,
        completedAt: when,
      },
    });

    await prisma.consultationNote.create({
      data: {
        sessionId: session.id,
        findings: c.findings,
        recommendations: c.recommendations,
        recordedAt: when,
      },
    });

    for (const rx of c.prescriptions) {
      await prisma.prescription.create({
        data: { sessionId: session.id, details: rx.details, issuedAt: when },
      });
    }
  }

  // An upcoming consultation for Jordan so the workspace has a joinable session
  // (SCHEDULED) to demonstrate, without waiting for a booking to be made by hand.
  const upcomingDoctor = doctorProfiles[2]; // Dr. Rohan Patel
  const upcomingSlot = new Date(base);
  upcomingSlot.setDate(base.getDate() + 2);
  upcomingSlot.setHours(14, 0, 0, 0);
  const upcomingEnd = new Date(upcomingSlot);
  upcomingEnd.setHours(15, 0, 0, 0);

  const upcomingAvailability = await prisma.availability.create({
    data: {
      doctorProfileId: upcomingDoctor.id,
      startTime: upcomingSlot,
      endTime: upcomingEnd,
      isBlocked: false,
    },
  });

  const upcomingAppointment = await prisma.appointment.create({
    data: {
      patientProfileId: jordan.id,
      doctorProfileId: upcomingDoctor.id,
      availabilityId: upcomingAvailability.id,
      scheduledAt: upcomingSlot,
      status: AppointmentStatus.BOOKED,
    },
  });

  await prisma.consultationSession.create({
    data: { appointmentId: upcomingAppointment.id, state: ConsultationState.SCHEDULED },
  });

  // -------------------------------------------------------------------------
  // NOTIFICATION FIXTURE — drive a REAL booking through the running API.
  //
  // WHY: `evidence-sub5-backend.mjs` asserts the bell's read paths (mark-read,
  // unread count, ownership 403) against `jordan.lee@example.com`. The seed gave
  // NO patient any notification — only `dr.okafor` had rows — so section 2 was
  // false by construction and sections 3-6 passed vacuously (an empty array is
  // trivially sorted; there is no row to mark or to be refused). See DEFERRED
  // item 11.
  //
  // WHY AN HTTP CALL AND NOT `prisma.notification.createMany`: the point is to
  // produce rows that the REAL Layer 4 sub-item 8 path generated, so the fixture
  // cannot silently drift from what `AppointmentsService.book()` actually
  // writes. `notifyBothParties` is a PRIVATE method, so a Prisma-only script
  // cannot call it. Driving POST /appointments is the only way to execute it.
  // Replicating the two-row write here would reproduce today's output and
  // diverge the moment the service changes — exactly the class of bug this
  // fixture exists to catch.
  //
  // >>> OPERATIONAL DEPENDENCY, READ THIS BEFORE MOVING THE SEED <<<
  // This step REQUIRES THE BACKEND TO BE RUNNING ON :3000. Every other part of
  // this file talks to Postgres directly and works cold. If the API is
  // unreachable this step SKIPS (it does not fail the seed), and the seeded
  // notification fixture is then ABSENT — which silently reintroduces the
  // vacuous-harness problem this block exists to fix. `docker compose up` starts
  // Postgres, backend and frontend together, so the normal path is fine; a bare
  // `prisma db seed` against a stopped backend is the case to watch. The skip is
  // loud on stdout for that reason.
  //
  // The appointment this creates is a legitimate seeded BOOKED appointment, so
  // it is part of the documented baseline (Appointment and ConsultationSession
  // go up by one, Notification by two — one per party on the BOOKING_CONFIRMED
  // event). Do not hand-delete it; reseed instead.
  // -------------------------------------------------------------------------
  const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
  const jordanUser = await prisma.user.findUnique({
    where: { email: 'jordan.lee@example.com' },
    select: { id: true },
  });
  async function issueToken(email: string, password: string): Promise<string | null> {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken?: string };
      return body.accessToken ?? null;
    } catch {
      return null;
    }
  }

  if (!jordanUser) {
    console.warn('  ! notification fixture skipped: jordan.lee has no User row');
  } else {
    // The doctor MUST be dr.patel: `evidence-sub5-backend.mjs` section 6 signs in
    // as dr.patel to obtain "another user's notification" for the ownership 403.
    // Booking with any other doctor leaves dr.patel's feed empty and section 6
    // fails for want of a row — which is how this was caught. The choice of
    // doctor is therefore load-bearing for that harness, not arbitrary.
    const doctorToken = await issueToken('dr.patel@example.com', DOCTOR_PASSWORD);
    const patientToken = await issueToken('jordan.lee@example.com', PATIENT_PASSWORD);

    if (!doctorToken || !patientToken) {
      console.warn(
        `  ! notification fixture SKIPPED — backend not reachable at ${API_BASE}.\n` +
          '    The bell harness will report vacuous sections until this runs.\n' +
          '    Start the backend and re-run `pnpm --filter backend prisma:seed`.',
      );
    } else {
      // Far-future slot so it cannot collide with the live next-5-days schedule
      // above, and so the fixture never consumes a slot a demo would want.
      const fixtureStart = new Date(base);
      fixtureStart.setDate(base.getDate() + 120);
      fixtureStart.setHours(9, 0, 0, 0);
      const fixtureEnd = new Date(fixtureStart);
      fixtureEnd.setHours(10, 0, 0, 0);

      const slotRes = await fetch(`${API_BASE}/doctors/me/availability`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${doctorToken}`,
        },
        body: JSON.stringify({
          startTime: fixtureStart.toISOString(),
          endTime: fixtureEnd.toISOString(),
        }),
      });
      const slot = (await slotRes.json()) as { id?: string };

      if (!slot.id) {
        console.warn(
          `  ! notification fixture SKIPPED — slot creation failed (${slotRes.status}).`,
        );
      } else {
        const bookRes = await fetch(`${API_BASE}/appointments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${patientToken}`,
          },
          body: JSON.stringify({ availabilityId: slot.id }),
        });
        const booked = (await bookRes.json()) as { id?: string };
        if (!booked.id) {
          console.warn(
            `  ! notification fixture SKIPPED — booking failed (${bookRes.status}).`,
          );
        } else {
          const notifCount = await prisma.notification.count({
            where: { userId: jordanUser.id },
          });
          console.log(
            `  + notification fixture: real booking ${booked.id} via POST /appointments; ` +
              `jordan.lee now has ${notifCount} notification(s)`,
          );
        }
      }
    }
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
