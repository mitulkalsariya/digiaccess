import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { LocalKmsEnvelope, chooseEnvelope } from '../src/auth-profiles/kms-envelope.js';

const KEY = randomBytes(32).toString('base64');

describe('S-3 KMS envelope (LocalKmsEnvelope)', () => {
  it('round-trips a payload through encrypt → decrypt', async () => {
    const env = new LocalKmsEnvelope(KEY);
    const e = await env.encrypt(Buffer.from('SuperSecretPayload-✨', 'utf8'));
    expect(e.ciphertext.toString('utf8')).not.toContain('SuperSecretPayload');
    expect(e.dekCiphertext.length).toBeGreaterThan(0);
    expect(e.kmsKeyId).toBe('local');
    const back = await env.decrypt(e);
    expect(back.toString('utf8')).toBe('SuperSecretPayload-✨');
  });

  it('rejects tampered ciphertext (GCM auth tag mismatch)', async () => {
    const env = new LocalKmsEnvelope(KEY);
    const e = await env.encrypt(Buffer.from('original'));
    const tampered = { ...e, ciphertext: Buffer.from(e.ciphertext.toString('hex') + '00', 'hex') };
    await expect(env.decrypt(tampered)).rejects.toThrow();
  });

  it('rejects DEK ciphertext under a different root key', async () => {
    const env1 = new LocalKmsEnvelope(KEY);
    const env2 = new LocalKmsEnvelope(randomBytes(32).toString('base64'));
    const e = await env1.encrypt(Buffer.from('only env1 can read'));
    await expect(env2.decrypt(e)).rejects.toThrow();
  });

  it('chooseEnvelope falls back to local when KMS_KEY_ARN is unset', () => {
    const env = chooseEnvelope({ localKeyB64: KEY });
    expect(env).toBeInstanceOf(LocalKmsEnvelope);
  });

  it('produces fresh DEK + IV on every encrypt (no nonce reuse)', async () => {
    const env = new LocalKmsEnvelope(KEY);
    const e1 = await env.encrypt(Buffer.from('same'));
    const e2 = await env.encrypt(Buffer.from('same'));
    expect(e1.iv.equals(e2.iv)).toBe(false);
    expect(e1.dekCiphertext.equals(e2.dekCiphertext)).toBe(false);
    expect(e1.ciphertext.equals(e2.ciphertext)).toBe(false);
  });
});
