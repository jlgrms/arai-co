// Vitest global setup: adds jest-dom matchers (toBeInTheDocument, etc.) and
// ensures the DOM is torn down between tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});