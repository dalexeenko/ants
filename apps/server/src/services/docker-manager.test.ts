/**
 * DockerManager tests have been moved to @openmgr/agent-docker.
 *
 * Run them with:
 *   cd packages/docker && pnpm test
 *
 * This file verifies that the re-export from the server still works.
 */

import { describe, it, expect } from 'vitest';
import { DockerManager } from './docker-manager.js';

describe('DockerManager re-export', () => {
  it('should re-export DockerManager from @openmgr/agent-docker', () => {
    expect(DockerManager).toBeDefined();
    expect(typeof DockerManager).toBe('function');
  });

  it('should accept an optional logger in constructor', () => {
    const manager = new DockerManager({
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    });
    expect(manager).toBeInstanceOf(DockerManager);
  });
});
