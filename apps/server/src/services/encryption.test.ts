import { describe, it, expect } from 'vitest';
import { EncryptionService, maskSecret } from './encryption.js';

describe('EncryptionService', () => {
  const validKey = Buffer.alloc(32, 'a').toString('base64');

  describe('constructor', () => {
    it('should accept a valid 32-byte base64 key', () => {
      expect(() => new EncryptionService(validKey)).not.toThrow();
    });

    it('should reject keys that are not 32 bytes', () => {
      const shortKey = Buffer.alloc(16, 'a').toString('base64');
      expect(() => new EncryptionService(shortKey)).toThrow('Encryption key must be 32 bytes');
    });
  });

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const service = new EncryptionService(validKey);
      const plaintext = 'secret-api-key-12345';
      
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (due to random IV)', () => {
      const service = new EncryptionService(validKey);
      const plaintext = 'test-value';
      
      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);
      
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should handle empty strings', () => {
      const service = new EncryptionService(validKey);
      
      const encrypted = service.encrypt('');
      const decrypted = service.decrypt(encrypted);
      
      expect(decrypted).toBe('');
    });

    it('should handle unicode characters', () => {
      const service = new EncryptionService(validKey);
      const plaintext = 'こんにちは 🔐 🎉';
      
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should throw on tampered ciphertext', () => {
      const service = new EncryptionService(validKey);
      const encrypted = service.encrypt('secret');
      
      const tampered = encrypted.slice(0, -2) + 'XX';
      
      expect(() => service.decrypt(tampered)).toThrow();
    });
  });

  describe('encryptObject/decryptObject', () => {
    it('should encrypt and decrypt an object', () => {
      const service = new EncryptionService(validKey);
      const obj = {
        ANTHROPIC_API_KEY: 'sk-ant-api-key',
        OPENAI_API_KEY: 'sk-openai-key',
      };
      
      const encrypted = service.encryptObject(obj);
      const decrypted = service.decryptObject(encrypted);
      
      expect(decrypted).toEqual(obj);
    });

    it('should handle empty objects', () => {
      const service = new EncryptionService(validKey);
      const obj = {};
      
      const encrypted = service.encryptObject(obj);
      const decrypted = service.decryptObject(encrypted);
      
      expect(decrypted).toEqual(obj);
    });
  });
});

describe('maskSecret', () => {
  it('should mask secrets longer than 12 characters', () => {
    expect(maskSecret('sk-ant-api-123456789')).toBe('sk-ant...6789');
  });

  it('should fully mask short secrets', () => {
    expect(maskSecret('shortkey')).toBe('••••••••');
  });

  it('should handle exactly 12 character secrets (masked)', () => {
    expect(maskSecret('123456789012')).toBe('123456...9012');
  });

  it('should handle 11 character secrets (fully masked)', () => {
    expect(maskSecret('12345678901')).toBe('••••••••');
  });
});
