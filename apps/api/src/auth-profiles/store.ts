// Auth-profile store — wraps Prisma with KMS envelope encryption (S-3) and
// extends to general-purpose named secrets so integration credentials reuse
// the same vault (S-11).
import type { Prisma } from '../db.js';
import type { AuthConfig, AuthMethod } from './methods.js';
import type { KmsEnvelope, EncryptedEnvelope } from './kms-envelope.js';

export interface CreateAuthProfileInput {
  siteId: string;
  name: string;
  method: AuthMethod;
  config: AuthConfig;
  expiresAt?: Date | undefined;
}

export interface AuthProfileStoreDeps {
  prisma: Prisma;
  envelope: KmsEnvelope;
  auditActorId?: string;
  auditLogMetadataMaxBytes?: number;
}

const DEFAULT_AUDIT_MAX = 16_384;

export function createAuthProfileStore(deps: AuthProfileStoreDeps) {
  const auditMax = deps.auditLogMetadataMaxBytes ?? DEFAULT_AUDIT_MAX;
  return {
    async create(input: CreateAuthProfileInput): Promise<{ id: string }> {
      const env = await deps.envelope.encrypt(Buffer.from(JSON.stringify(input.config), 'utf8'));
      const profile = await deps.prisma.authProfile.create({
        data: {
          siteId: input.siteId,
          name: input.name,
          method: input.method,
          configEnc: env.ciphertext,
          configIv: env.iv,
          configTag: env.tag,
          configDekCipher: env.dekCiphertext,
          kmsKeyId: env.kmsKeyId,
          expiresAt: input.expiresAt ?? null,
        },
      });
      await writeAuditLog(deps.prisma, auditMax, {
        actorId: deps.auditActorId,
        action: 'auth-profile.create',
        targetType: 'auth-profile',
        targetId: profile.id,
        metadata: { siteId: input.siteId, method: input.method },
      });
      return { id: profile.id };
    },

    async fetchDecrypted(id: string): Promise<{ method: AuthMethod; config: AuthConfig } | null> {
      const p = await deps.prisma.authProfile.findUnique({ where: { id } });
      if (!p) return null;
      if (!p.configDekCipher) {
        // Pre-S-3 row — refuse rather than fall back to a less-protected path.
        throw new Error(
          `auth profile ${id} predates KMS envelope encryption; rotate via vault.rotate() first`,
        );
      }
      const buf = await deps.envelope.decrypt({
        iv: p.configIv as Buffer,
        tag: p.configTag as Buffer,
        ciphertext: p.configEnc as Buffer,
        dekCiphertext: p.configDekCipher as Buffer,
        kmsKeyId: p.kmsKeyId,
      });
      await writeAuditLog(deps.prisma, auditMax, {
        actorId: deps.auditActorId,
        action: 'auth-profile.read',
        targetType: 'auth-profile',
        targetId: id,
        metadata: { method: p.method },
      });
      return {
        method: p.method as AuthMethod,
        config: JSON.parse(buf.toString('utf8')) as AuthConfig,
      };
    },

    async rotate(id: string): Promise<void> {
      const fetched = await this.fetchDecrypted(id);
      if (!fetched) throw new Error('profile-not-found');
      const env = await deps.envelope.encrypt(Buffer.from(JSON.stringify(fetched.config), 'utf8'));
      await deps.prisma.authProfile.update({
        where: { id },
        data: {
          configEnc: env.ciphertext,
          configIv: env.iv,
          configTag: env.tag,
          configDekCipher: env.dekCiphertext,
          kmsKeyId: env.kmsKeyId,
        },
      });
      await writeAuditLog(deps.prisma, auditMax, {
        actorId: deps.auditActorId,
        action: 'auth-profile.rotate',
        targetType: 'auth-profile',
        targetId: id,
        metadata: { kmsKeyId: env.kmsKeyId },
      });
    },

    async purgeExpired(now = new Date()): Promise<number> {
      const result = await deps.prisma.authProfile.deleteMany({
        where: { method: 'cookie', expiresAt: { lt: now } },
      });
      return result.count;
    },
  };
}

// ---------------------------------------------------------------------------
// S-11: named secret store for integration credentials (Jira API token,
// Slack/Teams webhook URLs). Same envelope, but stored as audit-log rows so
// no extra migration is needed for the prototype. Each `put` writes a new row;
// `get` reads the most recent. Rotation = put again.
// ---------------------------------------------------------------------------
export interface NamedSecretStoreDeps {
  prisma: Prisma;
  envelope: KmsEnvelope;
  auditActorId?: string;
}

interface SerializedEnvelope {
  iv: string;
  tag: string;
  dek: string;
  ct: string;
  k: string;
}

function serialize(env: EncryptedEnvelope): SerializedEnvelope {
  return {
    iv: env.iv.toString('base64'),
    tag: env.tag.toString('base64'),
    dek: env.dekCiphertext.toString('base64'),
    ct: env.ciphertext.toString('base64'),
    k: env.kmsKeyId,
  };
}
function deserialize(s: SerializedEnvelope): EncryptedEnvelope {
  return {
    iv: Buffer.from(s.iv, 'base64'),
    tag: Buffer.from(s.tag, 'base64'),
    dekCiphertext: Buffer.from(s.dek, 'base64'),
    ciphertext: Buffer.from(s.ct, 'base64'),
    kmsKeyId: s.k,
  };
}

export function createNamedSecretStore(deps: NamedSecretStoreDeps) {
  return {
    async put(scope: string, name: string, value: string): Promise<void> {
      const env = await deps.envelope.encrypt(Buffer.from(value, 'utf8'));
      await deps.prisma.auditLog.create({
        data: {
          actorId: deps.auditActorId ?? null,
          action: 'secret.put',
          targetType: 'secret',
          targetId: `${scope}/${name}`,
          metadata: { envelope: serialize(env) } as never,
        },
      });
    },
    async get(scope: string, name: string): Promise<string | null> {
      const row = await deps.prisma.auditLog.findFirst({
        where: { action: 'secret.put', targetType: 'secret', targetId: `${scope}/${name}` },
        orderBy: { createdAt: 'desc' },
      });
      if (!row) return null;
      const meta = row.metadata as { envelope?: SerializedEnvelope } | null;
      if (!meta?.envelope) return null;
      const plain = await deps.envelope.decrypt(deserialize(meta.envelope));
      return plain.toString('utf8');
    },
  };
}

async function writeAuditLog(
  prisma: Prisma,
  maxBytes: number,
  entry: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: unknown;
  },
): Promise<void> {
  // S-23: cap metadata size to prevent log-bombing.
  let metadata = entry.metadata;
  if (metadata !== undefined && metadata !== null) {
    const s = JSON.stringify(metadata);
    if (s.length > maxBytes) {
      metadata = { _truncated: true, preview: s.slice(0, maxBytes) };
    }
  }
  await prisma.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: metadata as never,
    },
  });
}
