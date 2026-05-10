import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class EncryptionService {
  private key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) {
      throw new Error('Encryption key must be 32 bytes');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    
    const authTag = cipher.getAuthTag();
    
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString('base64');
  }

  decrypt(ciphertext: string): string {
    const combined = Buffer.from(ciphertext, 'base64');
    
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    
    return decrypted.toString('utf8');
  }

  encryptObject(obj: Record<string, string>): string {
    return this.encrypt(JSON.stringify(obj));
  }

  decryptObject(ciphertext: string): Record<string, string> {
    return JSON.parse(this.decrypt(ciphertext));
  }
}

export function maskSecret(value: string): string {
  if (value.length < 12) {
    return '••••••••';
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
