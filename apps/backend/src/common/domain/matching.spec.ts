import { matchSymptomToSpecialties } from './matching';

describe('matching engine (pure)', () => {
  const map = [
    { symptomOrConcern: 'chest pain', specialty: 'Cardiology' },
    { symptomOrConcern: 'palpitations', specialty: 'Cardiology' },
    { symptomOrConcern: 'rash', specialty: 'Dermatology' },
    { symptomOrConcern: 'fever', specialty: 'General Medicine' },
  ];

  it('clear match: exact symptom -> correct specialty', () => {
    expect(matchSymptomToSpecialties('chest pain', map)).toEqual(['Cardiology']);
  });

  it('no match: unknown symptom -> empty', () => {
    expect(matchSymptomToSpecialties('broken toe', map)).toEqual([]);
  });

  it('a symptom mapping to multiple doctors (same specialty) dedupes to one specialty', () => {
    expect(matchSymptomToSpecialties('chest pain and palpitations', map)).toEqual([
      'Cardiology',
    ]);
  });

  it('case-insensitive + free-text contains-match', () => {
    expect(matchSymptomToSpecialties('I have a RASH on my arm', map)).toEqual(['Dermatology']);
  });

  it('input contained in stored phrase ("chest" -> "chest pain")', () => {
    expect(matchSymptomToSpecialties('chest', map)).toEqual(['Cardiology']);
  });

  it('multiple specialties from one input returns the union', () => {
    expect(matchSymptomToSpecialties('fever and rash', map).sort()).toEqual([
      'Dermatology',
      'General Medicine',
    ]);
  });

  it('blank input -> empty', () => {
    expect(matchSymptomToSpecialties('   ', map)).toEqual([]);
  });
});
