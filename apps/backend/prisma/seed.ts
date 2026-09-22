import { PrismaClient, Role, AccountState, ApprovalStatus } from '@prisma/client';
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
//     dr.chen@example.com     Dr. Wei Chen       Cardiology
//     dr.okafor@example.com   Dr. Amara Okafor   Dermatology
//     dr.patel@example.com    Dr. Rohan Patel    General Medicine
//     dr.reyes@example.com    Dr. Camila Reyes   General Medicine
//     dr.nguyen@example.com   Dr. Linh Nguyen    Pediatrics
//     dr.silva@example.com    Dr. Mateo Silva    Psychiatry
//
//   PATIENTS (all share PatientPass123!)
//     jordan.lee@example.com   Jordan Lee
//     sam.rivera@example.com   Sam Rivera
//     alex.kim@example.com     Alex Kim
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

  // --- patients ---
  const patientPasswordHash = await bcrypt.hash(PATIENT_PASSWORD, BCRYPT_ROUNDS);
  const patientSeeds = [
    { email: 'jordan.lee@example.com', name: 'Jordan Lee', contactDetails: 'jordan.lee@example.com', basicMedicalHistory: 'No known chronic conditions. Seasonal allergies.', birthday: new Date('1990-04-12'), weight: 72.5, height: 178 },
    { email: 'sam.rivera@example.com', name: 'Sam Rivera', contactDetails: '+1-555-0142', basicMedicalHistory: 'Mild asthma, managed with inhaler.', birthday: new Date('1985-11-02'), weight: 64.0, height: 165 },
    { email: 'alex.kim@example.com', name: 'Alex Kim', contactDetails: 'alex.kim@example.com', basicMedicalHistory: 'Hypertension, on medication.', birthday: new Date('1978-07-23'), weight: 81.2, height: 172 },
  ];

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
    await prisma.patientProfile.create({
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
  }

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
    { symptomOrConcern: 'child fever', specialty: 'Pediatrics' },
    { symptomOrConcern: 'vaccination', specialty: 'Pediatrics' },
    { symptomOrConcern: 'anxiety', specialty: 'Psychiatry' },
    { symptomOrConcern: 'depression', specialty: 'Psychiatry' },
    { symptomOrConcern: 'insomnia', specialty: 'Psychiatry' },
  ];
  await prisma.symptomSpecialtyMap.createMany({ data: symptomMap });

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
