import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockReadFile = vi.fn();
const mockAccess = vi.fn();
vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  access: (...args: unknown[]) => mockAccess(...args),
}));

const mockHostname = vi.fn().mockReturnValue('my-hostname');
vi.mock('os', () => ({
  hostname: () => mockHostname(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { DockerManager } from '../docker-manager.js';

describe('DockerManager', () => {
  let manager: DockerManager;
  const originalEnv = process.env;

  /** Helper: make pathExists (which uses fs/promises.access) resolve or reject */
  function mockPathExists(fn: (path: string) => boolean): void {
    mockAccess.mockImplementation(async (path: string) => {
      if (fn(path)) return undefined;
      throw new Error('ENOENT');
    });
  }

  beforeEach(() => {
    manager = new DockerManager();
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    // Default: nothing exists
    mockAccess.mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveAgentImage', () => {
    it('should use ANTS_IMAGE env var when set', async () => {
      process.env.ANTS_IMAGE = 'ants/server:v1.2.3';

      const result = await manager.resolveAgentImage();

      expect(result).toEqual({
        image: 'ants/server:v1.2.3',
        source: 'env',
      });
    });

    it('should use ANTS_IMAGE with SHA digest', async () => {
      process.env.ANTS_IMAGE = 'ants/server@sha256:abc123def456';

      const result = await manager.resolveAgentImage();

      expect(result).toEqual({
        image: 'ants/server@sha256:abc123def456',
        source: 'env',
      });
    });

    it('should cache the resolved image', async () => {
      process.env.ANTS_IMAGE = 'ants/server:v1.0.0';

      const first = await manager.resolveAgentImage();
      // Change the env var — should still return cached value
      process.env.ANTS_IMAGE = 'ants/server:v2.0.0';
      const second = await manager.resolveAgentImage();

      expect(first).toEqual(second);
      expect(second.image).toBe('ants/server:v1.0.0');
    });

    it('should fall back to default when not in Docker and no env var', async () => {
      delete process.env.ANTS_IMAGE;

      // Not in Docker: /.dockerenv doesn't exist, /proc files don't exist
      mockPathExists(() => false);
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await manager.resolveAgentImage();

      expect(result).toEqual({
        image: 'ants/server:latest',
        source: 'default',
      });
    });

    it('should try introspection when inside Docker via .dockerenv', async () => {
      delete process.env.ANTS_IMAGE;

      // Inside Docker: /.dockerenv exists
      mockPathExists((path: string) => path === '/.dockerenv');

      // Container ID from /proc/self/cgroup (cgroup v1)
      const containerId = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      mockReadFile.mockImplementation(async (path: string) => {
        if (path === '/proc/self/cgroup') {
          return `12:name=systemd:/docker/${containerId}\n`;
        }
        throw new Error('ENOENT');
      });

      // docker inspect returns the image name
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as Function;
        const cmdArgs = args[1] as string[];
        const key = cmdArgs.join(' ');
        if (key.includes('inspect') && key.includes(containerId)) {
          callback(null, { stdout: 'ants/server:v3.0.0\n', stderr: '' });
        } else {
          callback(new Error('not found'));
        }
      });

      const result = await manager.resolveAgentImage();

      expect(result).toEqual({
        image: 'ants/server:v3.0.0',
        source: 'introspection',
      });
    });

    it('should try cgroup v2 mountinfo when cgroup v1 has no docker references', async () => {
      delete process.env.ANTS_IMAGE;

      const containerId = 'deadbeef1234567890deadbeef1234567890deadbeef1234567890deadbeef12';

      // Inside Docker via mountinfo
      mockPathExists(() => false);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path === '/proc/1/cgroup') {
          return '0::/\n'; // cgroup v2, no docker reference
        }
        if (path === '/proc/self/mountinfo') {
          return `1 0 overlay /docker/containers/${containerId}/merged rw\n`;
        }
        if (path === '/proc/self/cgroup') {
          return '0::/\n';
        }
        throw new Error('ENOENT');
      });

      // docker inspect returns image
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as Function;
        const cmdArgs = args[1] as string[];
        const key = cmdArgs.join(' ');
        if (key.includes('inspect') && key.includes(containerId)) {
          callback(null, { stdout: 'ants/server:v4.0.0\n', stderr: '' });
        } else {
          callback(new Error('not found'));
        }
      });

      const result = await manager.resolveAgentImage();

      expect(result).toEqual({
        image: 'ants/server:v4.0.0',
        source: 'introspection',
      });
    });

    it('should fall back to default when introspection fails', async () => {
      delete process.env.ANTS_IMAGE;

      // Inside Docker (/.dockerenv exists)
      mockPathExists((path: string) => path === '/.dockerenv');

      // But cgroup parsing and docker inspect fail
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as Function;
        callback(new Error('Docker socket not available'));
      });

      const result = await manager.resolveAgentImage();

      expect(result).toEqual({
        image: 'ants/server:latest',
        source: 'default',
      });
    });
  });

  describe('isRunningInsideDocker', () => {
    it('should return true when /.dockerenv exists', async () => {
      mockPathExists((path: string) => path === '/.dockerenv');

      const result = await manager.isRunningInsideDocker();
      expect(result).toBe(true);
    });

    it('should return true when cgroup v1 references docker', async () => {
      mockPathExists(() => false);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path === '/proc/1/cgroup') {
          return '12:devices:/docker/abc123\n';
        }
        throw new Error('ENOENT');
      });

      const result = await manager.isRunningInsideDocker();
      expect(result).toBe(true);
    });

    it('should return true when cgroup v1 references containerd', async () => {
      mockPathExists(() => false);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path === '/proc/1/cgroup') {
          return '0::/system.slice/containerd.service/kubepods\n';
        }
        throw new Error('ENOENT');
      });

      const result = await manager.isRunningInsideDocker();
      expect(result).toBe(true);
    });

    it('should return true when mountinfo references docker (cgroup v2)', async () => {
      mockPathExists(() => false);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path === '/proc/1/cgroup') {
          return '0::/\n'; // cgroup v2, no docker ref
        }
        if (path === '/proc/self/mountinfo') {
          return 'overlay /docker/containers/abc123/merged rw\n';
        }
        throw new Error('ENOENT');
      });

      const result = await manager.isRunningInsideDocker();
      expect(result).toBe(true);
    });

    it('should return false when not in Docker', async () => {
      mockPathExists(() => false);
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await manager.isRunningInsideDocker();
      expect(result).toBe(false);
    });
  });

  describe('imageExists', () => {
    it('should return true when docker image inspect succeeds', async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as Function;
        callback(null, { stdout: '{}', stderr: '' });
      });

      const result = await manager.imageExists('ants/server:v1.0.0');
      expect(result).toBe(true);
    });

    it('should return false when docker image inspect fails', async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as Function;
        callback(new Error('No such image'));
      });

      const result = await manager.imageExists('ants/server:v1.0.0');
      expect(result).toBe(false);
    });

    it('should use resolved image when no image specified', async () => {
      process.env.ANTS_IMAGE = 'ants/server:resolved';

      mockExecFile.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as Function;
        const cmdArgs = args[1] as string[];
        if (cmdArgs.includes('ants/server:resolved')) {
          callback(null, { stdout: '{}', stderr: '' });
        } else {
          callback(new Error('wrong image'));
        }
      });

      const result = await manager.imageExists();
      expect(result).toBe(true);
    });
  });

  describe('constructor', () => {
    it('should accept an optional logger', () => {
      const logger = {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const mgr = new DockerManager(logger);
      expect(mgr).toBeInstanceOf(DockerManager);
    });

    it('should work without a logger', () => {
      const mgr = new DockerManager();
      expect(mgr).toBeInstanceOf(DockerManager);
    });
  });

  describe('pullImage', () => {
    it('should call docker pull and report success', async () => {
      // Mock execFile to simulate a successful pull
      // pullImage uses the callback form of execFile directly (not promisified)
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as Function;
        // Simulate success
        callback(null, { stdout: 'Pull complete\n', stderr: '' });
        // Return a mock ChildProcess
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        };
      });

      const progress: Array<{ status: string; complete: boolean }> = [];
      const result = await manager.pullImage('ants/server:latest', (p) => {
        progress.push({ status: p.status, complete: p.complete });
      });

      expect(result).toBe(true);
      // Should have at least the initial "Pulling..." and final success messages
      expect(progress.length).toBeGreaterThanOrEqual(1);
      expect(progress[0]!.status).toContain('Pulling');
    });

    it('should report failure when pull fails', async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as Function;
        callback(new Error('network timeout'));
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        };
      });

      const result = await manager.pullImage('ants/server:latest');
      expect(result).toBe(false);
    });
  });
});
