// Placeholder — populated in Task 4 (commit "feat(capabilities): add auth capabilities").
// Exists now so capabilities/index.ts can import it without breaking typecheck.
import { defineCapabilitySet } from './types.js';

export const authCapabilities = defineCapabilitySet({
  role: 'auth',
  capabilities: [],
});