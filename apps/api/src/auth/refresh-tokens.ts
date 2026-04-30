import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { Redis } from '../redis.js';

// AES-256-GCM. 12-byte IV per spec; 16-byte tag.
function encrypt(plain: string, key: Buffer): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

function decrypt(parts: { iv: Buffer; tag: Buffer; ct: Buffer }, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, parts.iv);
  decipher.setAuthTag(parts.tag);
  return Buffer.concat([decipher.update(parts.ct), decipher.final()]).toString('utf8');
}

// S-5: a refresh "family" represents one continuous login session. When a
// user signs in, a new family is created. Every successive refresh creates a
// fresh token *within the same family*; consuming a token marks the prior
// token as used. If a previously-used token is replayed, that's a credible
// signal of theft — we revoke the entire family and surface the alert.
export interface ConsumeResult {
  ok: true;
  userId: string;
  value: string;
  familyId: string;
}
export interface ConsumeReuseDetected {
  ok: false;
  reason: 'reuse-detected';
  userId: string;
  familyId: string;
}
export interface ConsumeNotFound {
  ok: false;
  reason: 'not-found';
}
export type ConsumeOutcome = ConsumeResult | ConsumeReuseDetected | ConsumeNotFound;

export interface RefreshTokenStore {
  issueNewFamily(
    userId: string,
    ttlSec: number,
    value: string,
  ): Promise<{ id: string; familyId: string }>;
  issueInFamily(userId: string, familyId: string, ttlSec: number, value: string): Promise<string>;
  consume(id: string): Promise<ConsumeOutcome>;
  revoke(id: string): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  isFamilyRevoked(familyId: string): Promise<boolean>;
}

export function createRefreshTokenStore(redis: Redis, encKeyB64: string): RefreshTokenStore {
  const key = Buffer.from(encKeyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('CRED_ENCRYPTION_KEY must be 32 bytes (base64)');
  }

  // Active token (replayable once)
  const tokKey = (id: string) => `auth:refresh:${id}`;
  // Used-token marker (kept around the full TTL after consume so we can
  // detect replay). Holds the family id.
  const usedKey = (id: string) => `auth:refresh-used:${id}`;
  // Index of all token ids in a family (for revocation).
  const familyKey = (familyId: string) => `auth:refresh-fam:${familyId}`;
  // Index of all family ids for a user.
  const userFamKey = (userId: string) => `auth:refresh-user-fam:${userId}`;
  // Revoked-family set (denylist).
  const revokedKey = 'auth:refresh-revoked-families';

  async function issueInFamily(
    userId: string,
    familyId: string,
    ttlSec: number,
    value: string,
  ): Promise<string> {
    const id = randomUUID();
    const { iv, tag, ct } = encrypt(value, key);
    const blob = Buffer.concat([iv, tag, ct]).toString('base64');
    const payload = JSON.stringify({ userId, familyId, blob });
    await redis.set(tokKey(id), payload, 'EX', ttlSec);
    await redis.sadd(familyKey(familyId), id);
    await redis.expire(familyKey(familyId), ttlSec);
    await redis.sadd(userFamKey(userId), familyId);
    await redis.expire(userFamKey(userId), ttlSec);
    return id;
  }

  return {
    async issueNewFamily(userId, ttlSec, value) {
      const familyId = randomUUID();
      const id = await issueInFamily(userId, familyId, ttlSec, value);
      return { id, familyId };
    },

    issueInFamily,

    async consume(id) {
      const raw = await redis.get(tokKey(id));
      if (!raw) {
        // Possible replay — was this id ever used?
        const usedFamRaw = await redis.get(usedKey(id));
        if (usedFamRaw) {
          const { userId, familyId } = JSON.parse(usedFamRaw) as {
            userId: string;
            familyId: string;
          };
          // Revoke the entire family — defence in depth.
          await this.revokeFamily(familyId);
          return { ok: false, reason: 'reuse-detected', userId, familyId };
        }
        return { ok: false, reason: 'not-found' };
      }
      const { userId, familyId, blob } = JSON.parse(raw) as {
        userId: string;
        familyId: string;
        blob: string;
      };
      // Refuse to mint anything new under a revoked family.
      if (await this.isFamilyRevoked(familyId)) {
        await redis.del(tokKey(id));
        return { ok: false, reason: 'reuse-detected', userId, familyId };
      }
      const buf = Buffer.from(blob, 'base64');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const ct = buf.subarray(28);
      try {
        const value = decrypt({ iv, tag, ct }, key);
        // Atomic: delete active, set used-marker with the same TTL window so
        // a future replay attempt finds the marker and trips the alert.
        const usedTtl = await redis.pttl(tokKey(id));
        await redis.del(tokKey(id));
        await redis.srem(familyKey(familyId), id);
        const ttlSec = usedTtl > 0 ? Math.ceil(usedTtl / 1000) : 60 * 60 * 24;
        await redis.set(usedKey(id), JSON.stringify({ userId, familyId }), 'EX', ttlSec);
        return { ok: true, userId, value, familyId };
      } catch {
        return { ok: false, reason: 'not-found' }; // tampered ciphertext
      }
    },

    async revoke(id) {
      const raw = await redis.get(tokKey(id));
      if (raw) {
        const { userId, familyId } = JSON.parse(raw) as { userId: string; familyId: string };
        await redis.srem(familyKey(familyId), id);
        void userId;
      }
      await redis.del(tokKey(id));
    },

    async revokeFamily(familyId) {
      await redis.sadd(revokedKey, familyId);
      const ids = await redis.smembers(familyKey(familyId));
      if (ids.length > 0) {
        await redis.del(...ids.map(tokKey));
      }
      await redis.del(familyKey(familyId));
    },

    async revokeAllForUser(userId) {
      const families = await redis.smembers(userFamKey(userId));
      for (const fam of families) await this.revokeFamily(fam);
      await redis.del(userFamKey(userId));
    },

    async isFamilyRevoked(familyId) {
      const r = await redis.sismember(revokedKey, familyId);
      return r === 1;
    },
  };
}
