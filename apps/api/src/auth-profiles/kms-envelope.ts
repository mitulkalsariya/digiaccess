// S-3: KMS envelope encryption.
//
// Pattern: KMS protects a per-record Data Encryption Key (DEK); the DEK
// protects the payload. To decrypt:
//   1. Send `dekCiphertext` to KMS Decrypt → DEK plaintext
//   2. AES-256-GCM-decrypt the payload with the DEK
// Compromising a database backup yields only ciphertext + encrypted DEKs;
// without KMS access, neither is exploitable.
//
// Two implementations:
//   * RealKmsEnvelope    — calls AWS KMS via @aws-sdk/client-kms
//   * LocalKmsEnvelope   — uses a static base64 master key for dev/tests
//
// Routing happens in `chooseEnvelope` based on whether KMS_KEY_ARN is set.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedEnvelope {
  iv: Buffer; // 12 bytes (GCM)
  tag: Buffer; // 16 bytes
  ciphertext: Buffer; // payload
  dekCiphertext: Buffer; // encrypted-by-KMS data key
  kmsKeyId: string; // arn or 'local'
}

export interface KmsEnvelope {
  encrypt(plain: Buffer): Promise<EncryptedEnvelope>;
  decrypt(envelope: EncryptedEnvelope): Promise<Buffer>;
}

// ---------- Local (dev/tests) ----------
// Treats the supplied 32-byte key as the "KMS root". DEKs are wrapped with
// AES-256-GCM under that root. Cryptographically equivalent to envelope
// encryption with a single-tenant root key, but obviously without HSM
// guarantees.
export class LocalKmsEnvelope implements KmsEnvelope {
  private readonly rootKey: Buffer;
  constructor(rootKeyB64: string) {
    const k = Buffer.from(rootKeyB64, 'base64');
    if (k.length !== 32) throw new Error('Local KMS root key must be 32 bytes (base64)');
    this.rootKey = k;
  }

  async encrypt(plain: Buffer): Promise<EncryptedEnvelope> {
    const dek = randomBytes(32);
    const dekIv = randomBytes(12);
    const wrapCipher = createCipheriv('aes-256-gcm', this.rootKey, dekIv);
    const wrappedDek = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
    const wrappedTag = wrapCipher.getAuthTag();

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv,
      tag,
      ciphertext,
      // Pack [dekIv | wrappedTag | wrappedDek] so decrypt() can split it back.
      dekCiphertext: Buffer.concat([dekIv, wrappedTag, wrappedDek]),
      kmsKeyId: 'local',
    };
  }

  async decrypt(env: EncryptedEnvelope): Promise<Buffer> {
    const dekIv = env.dekCiphertext.subarray(0, 12);
    const wrappedTag = env.dekCiphertext.subarray(12, 28);
    const wrappedDek = env.dekCiphertext.subarray(28);
    const wrapDecipher = createDecipheriv('aes-256-gcm', this.rootKey, dekIv);
    wrapDecipher.setAuthTag(wrappedTag);
    const dek = Buffer.concat([wrapDecipher.update(wrappedDek), wrapDecipher.final()]);
    const decipher = createDecipheriv('aes-256-gcm', dek, env.iv);
    decipher.setAuthTag(env.tag);
    return Buffer.concat([decipher.update(env.ciphertext), decipher.final()]);
  }
}

// ---------- Real (AWS KMS via @aws-sdk/client-kms) ----------
//
// Lazy-imports the SDK so the module loads cleanly in environments without
// AWS deps (dev, tests).
export class RealKmsEnvelope implements KmsEnvelope {
  constructor(private readonly kmsKeyArn: string) {}

  async encrypt(plain: Buffer): Promise<EncryptedEnvelope> {
    const { KMSClient, GenerateDataKeyCommand } = await import('@aws-sdk/client-kms');
    const kms = new KMSClient({});
    const out = await kms.send(
      new GenerateDataKeyCommand({ KeyId: this.kmsKeyArn, KeySpec: 'AES_256' }),
    );
    if (!out.Plaintext || !out.CiphertextBlob) {
      throw new Error('KMS GenerateDataKey returned empty material');
    }
    const dek = Buffer.from(out.Plaintext);
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', dek, iv);
      const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        iv,
        tag,
        ciphertext,
        dekCiphertext: Buffer.from(out.CiphertextBlob),
        kmsKeyId: this.kmsKeyArn,
      };
    } finally {
      // Best-effort zero of the in-memory DEK after use.
      dek.fill(0);
    }
  }

  async decrypt(env: EncryptedEnvelope): Promise<Buffer> {
    const { KMSClient, DecryptCommand } = await import('@aws-sdk/client-kms');
    const kms = new KMSClient({});
    const out = await kms.send(
      new DecryptCommand({
        CiphertextBlob: env.dekCiphertext,
        KeyId: this.kmsKeyArn,
      }),
    );
    if (!out.Plaintext) throw new Error('KMS Decrypt returned empty plaintext');
    const dek = Buffer.from(out.Plaintext);
    try {
      const decipher = createDecipheriv('aes-256-gcm', dek, env.iv);
      decipher.setAuthTag(env.tag);
      return Buffer.concat([decipher.update(env.ciphertext), decipher.final()]);
    } finally {
      dek.fill(0);
    }
  }
}

export function chooseEnvelope(opts: { kmsKeyArn?: string; localKeyB64: string }): KmsEnvelope {
  if (opts.kmsKeyArn) return new RealKmsEnvelope(opts.kmsKeyArn);
  return new LocalKmsEnvelope(opts.localKeyB64);
}
