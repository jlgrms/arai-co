// Backend-specific ESLint overrides. Extends the shared root flat config.
// No type-aware rules are configured, so no tsconfig `project` reference is set
// (setting one without type-checked rules only produces TS program errors).
import rootConfig from '../../eslint.config.mjs';

export default [
  ...rootConfig,
  {
    // Test specs build loose mocks/fixtures for Prisma + Nest internals; the
    // `any` escape hatch is standard and intentional there. Production code
    // (`src/**` excluding specs) still forbids `any`.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
