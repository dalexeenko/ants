import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test-utils/db.js';
import { UserManager } from './user-manager.js';
import { ensureSystemUser } from './system-user.js';

describe('UserManager', () => {
  let testDb: TestDatabase;
  let userManager: UserManager;

  beforeEach(async () => {
    testDb = createTestDatabase();
    await ensureSystemUser(testDb.db as any);
    userManager = new UserManager(testDb.db as any);
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  describe('needsSetup', () => {
    it('should return true when only the system user exists', () => {
      expect(userManager.needsSetup()).toBe(true);
    });

    it('should return false after an admin user is created', async () => {
      await userManager.createUser('admin', 'password123', 'admin');
      expect(userManager.needsSetup()).toBe(false);
    });

    it('should return false after any non-system user is created', async () => {
      await userManager.createUser('someuser', 'password123', 'viewer');
      expect(userManager.needsSetup()).toBe(false);
    });
  });

  describe('completeSetup', () => {
    it('should create an admin user with the given credentials', async () => {
      const user = await userManager.completeSetup('myadmin', 'securepass123');
      expect(user.username).toBe('myadmin');
      expect(user.role).toBe('admin');
      expect(user.displayName).toBe('Administrator');
    });

    it('should allow login with the created credentials', async () => {
      await userManager.completeSetup('myadmin', 'securepass123');
      const result = await userManager.authenticatePassword('myadmin', 'securepass123');
      expect(result).not.toBeNull();
      expect(result!.user.username).toBe('myadmin');
    });

    it('should throw if setup has already been completed', async () => {
      await userManager.completeSetup('admin1', 'password123');
      await expect(
        userManager.completeSetup('admin2', 'password456')
      ).rejects.toThrow('Setup has already been completed');
    });

    it('should throw if password is too short', async () => {
      await expect(
        userManager.completeSetup('admin', 'short')
      ).rejects.toThrow('Password must be at least 8 characters');
    });

    it('should throw if username is too short', async () => {
      await expect(
        userManager.completeSetup('a', 'password123')
      ).rejects.toThrow('Username must be at least 2 characters');
    });

    it('should make needsSetup return false after completion', async () => {
      expect(userManager.needsSetup()).toBe(true);
      await userManager.completeSetup('admin', 'password123');
      expect(userManager.needsSetup()).toBe(false);
    });
  });
});
