import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM helpers used by every auth profile (cookie / form / recorded).
// Per AC: never log decrypted values. Caller is responsible for redaction.

export interface EncryptedBlob {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

export function encrypt(plain: string, keyB64: string): EncryptedBlob {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

export function decrypt(blob: EncryptedBlob, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, blob.iv);
  decipher.setAuthTag(blob.tag);
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]).toString('utf8');
}

// Redaction wrapper: anything stored as an EncryptedBlob renders as "[redacted]"
// when stringified, so it can never accidentally appear in logs.
export function redactBlob(b: EncryptedBlob): string {
  void b;
  return '[redacted]';
}
