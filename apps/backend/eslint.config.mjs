// Backend-specific ESLint overrides. Extends the shared root flat config.
// No type-aware rules are configured, so no tsconfig `project` reference is set
// (setting one without type-checked rules only produces TS program errors).
import rootConfig from '../../eslint.config.mjs';

export default [...rootConfig];
