import { describe, expect, it } from 'vitest';

import type { DoctorPublic } from './discover-types';
import {
  buildMatchPath,
  groupDoctorsBySpecialty,
  isEmptyMatch,
  type MatchResult,
} from './match-types';

function doctor(name: string, specialization: string): DoctorPublic {
  return {
    id: `id-${name}`,
    userId: `user-${name}`,
    name,
    biography: null,
    specialization,
    approvalStatus: 'APPROVED',
  };
}

function result(overrides: Partial<MatchResult>): MatchResult {
  return { symptom: 'cough', matchedSpecialties: [], doctors: [], ...overrides };
}

describe('groupDoctorsBySpecialty', () => {
  it('groups doctors under the specialty that matched them, preserving backend order', () => {
    const groups = groupDoctorsBySpecialty(
      result({
        matchedSpecialties: ['General Medicine', 'Pediatrics'],
        doctors: [
          doctor('Dr. Camila Reyes', 'General Medicine'),
          doctor('Dr. Linh Nguyen', 'Pediatrics'),
          doctor('Dr. Rohan Patel', 'General Medicine'),
        ],
      }),
    );

    expect(groups.map((g) => g.specialization)).toEqual(['General Medicine', 'Pediatrics']);
    expect(groups[0]?.doctors.map((d) => d.name)).toEqual([
      'Dr. Camila Reyes',
      'Dr. Rohan Patel',
    ]);
    expect(groups[1]?.doctors.map((d) => d.name)).toEqual(['Dr. Linh Nguyen']);
  });

  it('keeps a specialty whose only doctor appears multiple times once', () => {
    const groups = groupDoctorsBySpecialty(
      result({
        matchedSpecialties: ['Cardiology'],
        doctors: [doctor('Dr. Wei Chen', 'Cardiology')],
      }),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.doctors).toHaveLength(1);
  });

  it('drops a matched specialty that has no doctors', () => {
    const groups = groupDoctorsBySpecialty(
      result({
        matchedSpecialties: ['Cardiology', 'Dermatology'],
        doctors: [doctor('Dr. Amara Okafor', 'Dermatology')],
      }),
    );

    expect(groups.map((g) => g.specialization)).toEqual(['Dermatology']);
  });

  it('drops a doctor whose specialty was not matched, rather than inventing a group', () => {
    const groups = groupDoctorsBySpecialty(
      result({
        matchedSpecialties: ['Cardiology'],
        doctors: [
          doctor('Dr. Wei Chen', 'Cardiology'),
          doctor('Dr. Amara Okafor', 'Dermatology'),
        ],
      }),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.doctors.map((d) => d.name)).toEqual(['Dr. Wei Chen']);
  });

  it('returns an empty list for an empty match', () => {
    expect(groupDoctorsBySpecialty(result({}))).toEqual([]);
  });
});

describe('isEmptyMatch', () => {
  it('is true when nothing matched', () => {
    expect(isEmptyMatch(result({ matchedSpecialties: [], doctors: [] }))).toBe(true);
  });

  it('is false when at least one doctor matched', () => {
    expect(
      isEmptyMatch(result({ matchedSpecialties: ['Cardiology'], doctors: [doctor('Dr. Wei Chen', 'Cardiology')] })),
    ).toBe(false);
  });
});

describe('buildMatchPath', () => {
  it('trims surrounding whitespace', () => {
    expect(buildMatchPath('  cough  ')).toBe('/doctors/match?symptom=cough');
  });

  it('preserves the original casing of the symptom', () => {
    expect(buildMatchPath('Chest Pain')).toBe('/doctors/match?symptom=Chest+Pain');
  });

  it('percent-encodes characters that would otherwise break the query', () => {
    expect(buildMatchPath('rash & fever?')).toBe(
      '/doctors/match?symptom=rash+%26+fever%3F',
    );
  });

  it('sends an empty symptom rather than dropping the param', () => {
    expect(buildMatchPath('   ')).toBe('/doctors/match?symptom=');
  });
});
