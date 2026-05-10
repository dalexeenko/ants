import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './errors.js';

describe('getErrorMessage', () => {
  it('should extract message from Error instances', () => {
    expect(getErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('should convert strings to themselves', () => {
    expect(getErrorMessage('some string')).toBe('some string');
  });

  it('should convert numbers to strings', () => {
    expect(getErrorMessage(42)).toBe('42');
  });

  it('should convert null to string', () => {
    expect(getErrorMessage(null)).toBe('null');
  });

  it('should convert undefined to string', () => {
    expect(getErrorMessage(undefined)).toBe('undefined');
  });

  it('should use fallback for non-Error when provided', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('should prefer fallback over String() for non-Error values', () => {
    expect(getErrorMessage(undefined, 'something went wrong')).toBe('something went wrong');
  });

  it('should extract from Error subclasses', () => {
    class CustomError extends Error {
      constructor() {
        super('custom error');
      }
    }
    expect(getErrorMessage(new CustomError())).toBe('custom error');
  });
});
