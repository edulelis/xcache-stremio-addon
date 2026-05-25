import { describe, expect, it } from 'vitest';
import { createInstallToken, isValidInstallToken } from './token.js';

describe('install token', () => {
  it('derives a stable public token from a private secret', () => {
    const token = createInstallToken('secret-one');
    expect(token).toMatch(/^xc_/);
    expect(isValidInstallToken(token, 'secret-one')).toBe(true);
    expect(isValidInstallToken(token, 'secret-two')).toBe(false);
  });
});
