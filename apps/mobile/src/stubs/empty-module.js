/**
 * Empty module stub for Node.js-only dependencies.
 * This file is returned by Metro when a blocked module is imported.
 * 
 * The @openmgr/agent-core native build shouldn't import these modules,
 * but this stub prevents warnings if they're transitively referenced.
 */

// Default export - function that throws if called
export default function notAvailable() {
  throw new Error('This module is not available in React Native');
}

// Named exports that might be expected
export const verifyChallenge = notAvailable;
export const generateChallenge = notAvailable;
