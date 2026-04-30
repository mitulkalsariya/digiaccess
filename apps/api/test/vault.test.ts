import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, redactBlob } from '../src/auth-profiles/vault.js';

const KEY = randomBytes(32).toString('base64');

describe('TC-017 stored credentials encrypted at rest', () => {
  it('round-trips through AES-256-GCM', () => {
    const blob = encrypt('s3cret-password', KEY);
    expect(blob.ciphertext.toString('utf8')).not.toContain('s3cret-password');
    expect(blob.ciphertext.length).toBeGreaterThan(0);
    expect(decrypt(blob, KEY)).toBe('s3cret-password');
  });

  it('rejects tampering (auth tag mismatch)', () => {
    const blob = encrypt('s3cret', KEY);
    const tampered = {
      ...blob,
      ciphertext: Buffer.concat([blob.ciphertext.subarray(1), Buffer.from('x')]),
    };
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it('rejects wrong key', () => {
    const blob = encrypt('s3cret', KEY);
    expect(() => decrypt(blob, randomBytes(32).toString('base64'))).toThrow();
  });

  it('redactBlob never returns the plaintext', () => {
    const blob = encrypt('p4ssw0rd', KEY);
    expect(redactBlob(blob)).toBe('[redacted]');
    // Additionally ensure nothing in the buffer accidentally contains the plaintext
    const all = Buffer.concat([blob.iv, blob.tag, blob.ciphertext]).toString('utf8');
    expect(all).not.toContain('p4ssw0rd');
  });
});

describe('TC-018 credentials never appear in JSON-stringify logs', () => {
  it('JSON.stringify of an EncryptedBlob does not leak plaintext', () => {
    const blob = encrypt('TopSecret123!', KEY);
    const s = JSON.stringify(blob);
    expect(s).not.toContain('TopSecret123!');
  });
});
