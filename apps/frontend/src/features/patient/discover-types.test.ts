import { describe, expect, it } from 'vitest';

import { buildDiscoveryQuery } from './discover-types';

// The query builder is the one piece of deterministic logic in discovery: it
// decides which filters reach the backend. A blank filter must never be sent,
// because `?search=` and a missing `search` mean the same thing server-side
// but only one of them produces a shareable URL.
describe('buildDiscoveryQuery', () => {
  it('returns the bare path when no filters are set', () => {
    expect(buildDiscoveryQuery({})).toBe('/doctors');
  });

  it('includes a search term', () => {
    expect(buildDiscoveryQuery({ search: 'chen' })).toBe('/doctors?search=chen');
  });

  it('includes a specialization', () => {
    expect(buildDiscoveryQuery({ specialization: 'Cardiology' })).toBe(
      '/doctors?specialization=Cardiology',
    );
  });

  it('includes both filters when both are set', () => {
    const qs = buildDiscoveryQuery({ search: 'heart', specialization: 'Cardiology' });
    const params = new URLSearchParams(qs.replace('/doctors?', ''));
    expect(params.get('search')).toBe('heart');
    expect(params.get('specialization')).toBe('Cardiology');
  });

  it('omits blank and whitespace-only filters', () => {
    expect(buildDiscoveryQuery({ search: '', specialization: '' })).toBe('/doctors');
    expect(buildDiscoveryQuery({ search: '   ', specialization: '  ' })).toBe('/doctors');
  });

  it('trims surrounding whitespace', () => {
    expect(buildDiscoveryQuery({ search: '  chen  ' })).toBe('/doctors?search=chen');
  });

  it('URL-encodes values that need it', () => {
    const qs = buildDiscoveryQuery({ search: 'Dr. Wei Chen' });
    expect(qs).toBe('/doctors?search=Dr.+Wei+Chen');
    expect(new URLSearchParams(qs.split('?')[1]).get('search')).toBe('Dr. Wei Chen');
  });
});
