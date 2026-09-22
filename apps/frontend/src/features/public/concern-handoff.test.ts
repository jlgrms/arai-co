import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildConcernHandoffState,
  clearPendingConcern,
  consumePendingConcern,
  GUIDED_MATCHING_PATH,
  isConcernHandoff,
  PENDING_CONCERN_KEY,
  peekPendingConcern,
  setPendingConcern,
} from './concern-handoff';

/**
 * These tests pin the handoff contract that decision (a) depends on:
 * the landing page captures, the auth boundary carries, guided matching
 * consumes — and the concern is single-use and never lands in the URL.
 */

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('setPendingConcern', () => {
  it('stores a trimmed concern', () => {
    setPendingConcern('  masakit tiyan ko  ');
    expect(window.sessionStorage.getItem(PENDING_CONCERN_KEY)).toBe('masakit tiyan ko');
  });

  it('stores nothing for a blank concern', () => {
    setPendingConcern('   ');
    expect(window.sessionStorage.getItem(PENDING_CONCERN_KEY)).toBeNull();
  });

  it('stores nothing for an empty string', () => {
    setPendingConcern('');
    expect(window.sessionStorage.getItem(PENDING_CONCERN_KEY)).toBeNull();
  });

  it('overwrites a previous concern rather than appending', () => {
    setPendingConcern('cough');
    setPendingConcern('rash');
    expect(peekPendingConcern()).toBe('rash');
  });

  it('does not throw when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => setPendingConcern('cough')).not.toThrow();
  });
});

describe('consumePendingConcern', () => {
  it('returns the stored concern', () => {
    setPendingConcern('cough');
    expect(consumePendingConcern()).toBe('cough');
  });

  it('clears the key so the concern is single-use', () => {
    setPendingConcern('cough');
    consumePendingConcern();
    expect(window.sessionStorage.getItem(PENDING_CONCERN_KEY)).toBeNull();
    expect(consumePendingConcern()).toBeNull();
  });

  it('clears the key even when there was nothing to consume', () => {
    window.sessionStorage.setItem(PENDING_CONCERN_KEY, '   ');
    expect(consumePendingConcern()).toBeNull();
    expect(window.sessionStorage.getItem(PENDING_CONCERN_KEY)).toBeNull();
  });

  it('returns null when nothing was stored', () => {
    expect(consumePendingConcern()).toBeNull();
  });

  it('never returns a whitespace-only value', () => {
    window.sessionStorage.setItem(PENDING_CONCERN_KEY, '   ');
    expect(consumePendingConcern()).toBeNull();
  });

  it('does not throw when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => consumePendingConcern()).not.toThrow();
    expect(consumePendingConcern()).toBeNull();
  });
});

describe('clearPendingConcern', () => {
  it('drops a stored concern', () => {
    setPendingConcern('cough');
    clearPendingConcern();
    expect(peekPendingConcern()).toBeNull();
  });

  it('does not throw when there is nothing to clear', () => {
    expect(() => clearPendingConcern()).not.toThrow();
  });
});

describe('peekPendingConcern', () => {
  it('reads without clearing', () => {
    setPendingConcern('cough');
    expect(peekPendingConcern()).toBe('cough');
    expect(peekPendingConcern()).toBe('cough');
  });
});

describe('buildConcernHandoffState', () => {
  it('targets the existing Layer 6 guided-matching path', () => {
    expect(buildConcernHandoffState().from).toBe(GUIDED_MATCHING_PATH);
    expect(GUIDED_MATCHING_PATH).toBe('/patient/book');
  });

  it('marks the quick-book origin explicitly', () => {
    expect(buildConcernHandoffState().fromQuickBook).toBe(true);
  });

  it('does NOT carry the concern itself — it must stay out of history', () => {
    const state = buildConcernHandoffState();
    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain('concern');
    // Only the two expected keys exist; no place for free text to hide.
    expect(Object.keys(state).sort()).toEqual(['from', 'fromQuickBook']);
  });
});

describe('isConcernHandoff', () => {
  it('accepts the real handoff state', () => {
    expect(isConcernHandoff(buildConcernHandoffState())).toBe(true);
  });

  it('rejects null and undefined', () => {
    expect(isConcernHandoff(null)).toBe(false);
    expect(isConcernHandoff(undefined)).toBe(false);
  });

  it('rejects a plain string', () => {
    expect(isConcernHandoff('/patient/book')).toBe(false);
  });

  it('rejects an object without the marker', () => {
    expect(isConcernHandoff({ from: '/patient/book' })).toBe(false);
  });

  it('rejects the marker without a valid from', () => {
    expect(isConcernHandoff({ fromQuickBook: true })).toBe(false);
    expect(isConcernHandoff({ fromQuickBook: true, from: 42 })).toBe(false);
  });

  it('rejects a falsy marker', () => {
    expect(isConcernHandoff({ fromQuickBook: false, from: '/patient/book' })).toBe(false);
  });

  it('only narrows the SHAPE — it is not an authorization check', () => {
    // Documented limitation, pinned so it cannot change silently.
    //
    // `isConcernHandoff` answers "is this our marker?", NOT "is this destination
    // allowed?". A forged object with any string `from` passes. That is safe
    // here ONLY because no caller uses `from` as a navigation target: the
    // landing page always navigates to the hardcoded LOGIN_PATH, and the auth
    // screens' own `state.from` handling predates Layer 9. If a future caller
    // starts honouring `from` for navigation it must validate the target first.
    expect(isConcernHandoff({ fromQuickBook: true, from: '/admin' })).toBe(true);
  });
});
