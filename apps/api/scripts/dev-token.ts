// Mint a dev JWT signed with the same secret the API trusts. Use this for
// local curl/extension testing instead of standing up a real IdP.
//
//   pnpm --filter @a11y/api exec tsx scripts/dev-token.ts <user-email>
//
// Looks up the seeded user by email so the JWT's `sub` claim is a real UUID
// (so subsequent INSERTs that FK to users.id succeed), and pulls the user's
// team memberships so ACL checks pass too.
//
// Outputs the token on stdout so you can pipe it into curl:
//   TOKEN=$(pnpm --filter @a11y/api exec tsx scripts/dev-token.ts alice@example.com)
//   curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/v1/scans
import { createHmac } from 'node:crypto';
// @prisma/client is CJS; default-import + destructure to work under ESM.
import prismaPkg from '@prisma/client';
const { PrismaClient } = prismaPkg;

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('usage: dev-token.ts <email>');
  process.exit(2);
}
const [email] = args;

const secret = process.env['JWT_SECRET'] ?? 'dev-only-jwt-secret-change-me-32bytes';
const ttl = 60 * 60;

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: true },
  });
  if (!user) {
    console.error(`No user with email=${email}. Run \`make db.seed\` first.`);
    process.exit(2);
  }
  const teams = user.memberships.map((m) => m.teamId);

  const b64url = (input: string | Buffer): string =>
    Buffer.from(input)
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    teams,
    iat: now,
    exp: now + ttl,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = b64url(createHmac('sha256', secret).update(signingInput).digest());
  process.stdout.write(`${signingInput}.${signature}`);
} finally {
  await prisma.$disconnect();
}
