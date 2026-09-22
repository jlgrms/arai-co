import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DoctorsService } from './doctors.service';

// Sub-item 8 / Flag 1: a slot consumed by a live appointment is sealed —
// editing or deleting it must 409 until the appointment is cancelled/rescheduled.
describe('DoctorsService availability guard (Flag 1)', () => {
  const ownProfile = { id: 'doc-1', userId: 'user-doc' };
  const availableSlot = {
    id: 'slot-1',
    doctorProfileId: 'doc-1',
    startTime: new Date('2026-05-01T09:00:00.000Z'),
    endTime: new Date('2026-05-01T10:00:00.000Z'),
    isBlocked: false,
  };

  it('updateAvailability: 409 when a non-cancelled appointment consumes the slot', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: { findFirst: jest.fn().mockResolvedValue(availableSlot), update: jest.fn() },
      appointment: { findFirst: jest.fn().mockResolvedValue({ id: 'appt-1' }) },
    };
    const svc = new DoctorsService(prisma);
    await expect(
      svc.updateAvailability('user-doc', 'slot-1', { isBlocked: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.availability.update).not.toHaveBeenCalled();
    // The consumption check excludes CANCELLED appointments.
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ availabilityId: 'slot-1', status: { not: 'CANCELLED' } }),
      }),
    );
  });

  it('updateAvailability: succeeds when the slot has no live consumer', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: {
        findFirst: jest.fn().mockResolvedValue(availableSlot),
        update: jest.fn().mockImplementation(({ data }) => ({ ...availableSlot, ...data })),
      },
      appointment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new DoctorsService(prisma);
    const res = await svc.updateAvailability('user-doc', 'slot-1', {
      startTime: '2026-05-01T11:00:00.000Z',
      endTime: '2026-05-01T12:00:00.000Z',
    });
    expect(prisma.availability.update).toHaveBeenCalledTimes(1);
    expect(res).toBeDefined();
  });

  it('updateAvailability: end-before-start still -> 400 (window validation intact)', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: { findFirst: jest.fn().mockResolvedValue(availableSlot), update: jest.fn() },
      appointment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new DoctorsService(prisma);
    await expect(
      svc.updateAvailability('user-doc', 'slot-1', { endTime: '2026-05-01T08:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deleteAvailability: 409 when consumed', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: { findFirst: jest.fn().mockResolvedValue(availableSlot), delete: jest.fn() },
      appointment: { findFirst: jest.fn().mockResolvedValue({ id: 'appt-1' }) },
    };
    const svc = new DoctorsService(prisma);
    await expect(svc.deleteAvailability('user-doc', 'slot-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.availability.delete).not.toHaveBeenCalled();
  });

  it('deleteAvailability: 200 when free', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: {
        findFirst: jest.fn().mockResolvedValue(availableSlot),
        delete: jest.fn().mockResolvedValue(availableSlot),
      },
      appointment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new DoctorsService(prisma);
    const res = await svc.deleteAvailability('user-doc', 'slot-1');
    expect(res).toEqual({ deleted: true, id: 'slot-1' });
  });

  it('updateAvailability: slot not owned / missing -> 404 before any consume check', async () => {
    const prisma: any = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue(ownProfile) },
      availability: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      appointment: { findFirst: jest.fn() },
    };
    const svc = new DoctorsService(prisma);
    await expect(svc.updateAvailability('user-doc', 'slot-x', { isBlocked: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
  });
});

// Layer 6 sub-item 2: discovery must stay scoped to APPROVED doctors, and the
// search filter must broaden within that scope without ever escaping it.
describe('DoctorsService discovery filters', () => {
  function makePrisma() {
    return {
      doctorProfile: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  /** The `where` handed to Prisma on the last findMany call. */
  function lastWhere(prisma: any) {
    return prisma.doctorProfile.findMany.mock.calls[0][0].where;
  }

  it('always restricts to APPROVED, even with no filters', async () => {
    const prisma = makePrisma();
    await new DoctorsService(prisma).discover({});
    expect(lastWhere(prisma)).toEqual({ approvalStatus: 'APPROVED' });
  });

  it('search matches name OR biography, case-insensitively', async () => {
    const prisma = makePrisma();
    await new DoctorsService(prisma).discover({ search: 'cardio' });
    const where = lastWhere(prisma);
    expect(where.approvalStatus).toBe('APPROVED');
    expect(where.OR).toEqual([
      { name: { contains: 'cardio', mode: 'insensitive' } },
      { biography: { contains: 'cardio', mode: 'insensitive' } },
    ]);
  });

  it('search is trimmed; blank/whitespace-only search adds no filter', async () => {
    const prisma = makePrisma();
    await new DoctorsService(prisma).discover({ search: '   ' });
    const where = lastWhere(prisma);
    // No OR clause: an empty box must not exclude doctors with a null biography.
    expect(where.OR).toBeUndefined();
    expect(where).toEqual({ approvalStatus: 'APPROVED' });
  });

  it('trims surrounding whitespace before matching', async () => {
    const prisma = makePrisma();
    await new DoctorsService(prisma).discover({ search: '  Chen  ' });
    expect(lastWhere(prisma).OR[0].name.contains).toBe('Chen');
  });

  it('search AND specialization AND available compose together', async () => {
    const prisma = makePrisma();
    await new DoctorsService(prisma).discover({
      search: 'heart',
      specialization: 'Cardiology',
      available: true,
    });
    const where = lastWhere(prisma);
    expect(where.approvalStatus).toBe('APPROVED');
    expect(where.specialization).toEqual({ equals: 'Cardiology', mode: 'insensitive' });
    expect(where.OR).toHaveLength(2);
    expect(where.availabilities.some).toEqual(
      expect.objectContaining({ isBlocked: false, appointment: null }),
    );
  });

  it('available=false does not add an availability filter', async () => {
    const prisma = makePrisma();
    await new DoctorsService(prisma).discover({ available: false });
    expect(lastWhere(prisma).availabilities).toBeUndefined();
  });
});

// Layer 6 sub-item 3: the quick-pick chips are served from the matching table, so
// they must never advertise a phrase that leads to a dead end, and chips sitting
// under one specialty must resolve to exactly that specialty.
describe('DoctorsService match options', () => {
  function makePrisma(rows: Array<{ symptomOrConcern: string; specialty: string }>) {
    return {
      symptomSpecialtyMap: { findMany: jest.fn().mockResolvedValue(rows) },
    } as any;
  }

  const rows = [
    { symptomOrConcern: 'chest pain', specialty: 'Cardiology' },
    { symptomOrConcern: 'palpitations', specialty: 'Cardiology' },
    { symptomOrConcern: 'rash', specialty: 'Dermatology' },
    // A phrase whose text does not occur in any other phrase — still fine.
    { symptomOrConcern: 'cough', specialty: 'General Medicine' },
  ];

  it('returns one option per distinct phrase, each with its matching specialty', async () => {
    const svc = new DoctorsService(makePrisma(rows));
    const { options } = await svc.listMatchOptions();
    expect(options).toHaveLength(4);
    const bySymptom = Object.fromEntries(options.map((o) => [o.symptom, o.specialties]));
    expect(bySymptom['chest pain']).toEqual(['Cardiology']);
    expect(bySymptom['rash']).toEqual(['Dermatology']);
    expect(bySymptom['cough']).toEqual(['General Medicine']);
  });

  it('a phrase matching multiple specialties lists all of them', async () => {
    // "fever" is a substring of "child fever", so the bidirectional contains-match
    // pulls in BOTH General Medicine and Pediatrics — a chip that yields 2 groups.
    const svc = new DoctorsService(
      makePrisma([
        { symptomOrConcern: 'fever', specialty: 'General Medicine' },
        { symptomOrConcern: 'child fever', specialty: 'Pediatrics' },
      ]),
    );
    const { options } = await svc.listMatchOptions();
    const fever = options.find((o) => o.symptom === 'fever');
    expect(fever?.specialties).toEqual(['General Medicine', 'Pediatrics']);
  });

  it('drops any phrase that resolves to zero specialties (no dead-end chips)', async () => {
    // A row whose own text can never match itself would be a chip that always
    // lands on the empty state. Here the phantom row is unreachable because its
    // phrase normalizes to empty.
    const svc = new DoctorsService(makePrisma([{ symptomOrConcern: '   ', specialty: 'Cardiology' }]));
    const { options } = await svc.listMatchOptions();
    expect(options).toEqual([]);
  });

  it('returns an empty list (not an error) when the map is empty', async () => {
    const svc = new DoctorsService(makePrisma([]));
    await expect(svc.listMatchOptions()).resolves.toEqual({ options: [] });
  });

  it('preserves the specialty casing from the stored map (no re-casing)', async () => {
    const svc = new DoctorsService(makePrisma([{ symptomOrConcern: 'acne', specialty: 'Dermatology' }]));
    const { options } = await svc.listMatchOptions();
    expect(options[0].specialties).toEqual(['Dermatology']);
  });
});

// Layer 6 sub-item 3: match() must keep returning 200 + empty arrays on no-match
// (a valid outcome the UI renders as a non-error empty state), and must scope
// doctor lookup to APPROVED and to the matched specialties only.
describe('DoctorsService match()', () => {
  const mapRows = [
    { symptomOrConcern: 'chest pain', specialty: 'Cardiology' },
    { symptomOrConcern: 'rash', specialty: 'Dermatology' },
  ];

  function makePrisma(doctors: unknown[] = []) {
    return {
      symptomSpecialtyMap: { findMany: jest.fn().mockResolvedValue(mapRows) },
      doctorProfile: { findMany: jest.fn().mockResolvedValue(doctors) },
    } as any;
  }

  it('no match -> 200 semantics: empty specialties, empty doctors, no doctor query', async () => {
    const prisma = makePrisma();
    const res = await new DoctorsService(prisma).match('something nobody mapped');
    expect(res).toEqual({
      symptom: 'something nobody mapped',
      matchedSpecialties: [],
      doctors: [],
    });
    // Important: don't hit the DB for doctors when there is nothing to look up.
    expect(prisma.doctorProfile.findMany).not.toHaveBeenCalled();
  });

  it('blank symptom -> empty result, never an error', async () => {
    const prisma = makePrisma();
    const res = await new DoctorsService(prisma).match('');
    expect(res.matchedSpecialties).toEqual([]);
    expect(res.doctors).toEqual([]);
  });

  it('queries only APPROVED doctors in the matched specialties', async () => {
    const prisma = makePrisma([{ id: 'd1', name: 'Dr. A', specialization: 'Cardiology' }]);
    const res = await new DoctorsService(prisma).match('chest pain');
    expect(res.matchedSpecialties).toEqual(['Cardiology']);
    expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          approvalStatus: 'APPROVED',
          specialization: { in: ['Cardiology'], mode: 'insensitive' },
        },
      }),
    );
    expect(res.doctors).toHaveLength(1);
  });

  it('echoes the original symptom text back verbatim (not normalized)', async () => {
    const prisma = makePrisma();
    const res = await new DoctorsService(prisma).match('  Chest   Pain  ');
    expect(res.symptom).toBe('  Chest   Pain  ');
    expect(res.matchedSpecialties).toEqual(['Cardiology']);
  });
});
