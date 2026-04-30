// Dev seed — creates a team, two users, one site. Idempotent.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const team = await prisma.team.upsert({
    where: { slug: 'platform' },
    update: {},
    create: { name: 'Platform Team', slug: 'platform' },
  });

  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: { email: 'alice@example.com', name: 'Alice Tester' },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: { email: 'bob@example.com', name: 'Bob Tester' },
  });

  for (const u of [alice, bob]) {
    await prisma.teamMembership.upsert({
      where: { teamId_userId: { teamId: team.id, userId: u.id } },
      update: {},
      create: { teamId: team.id, userId: u.id, role: u.id === alice.id ? 'admin' : 'member' },
    });
  }

  await prisma.site.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Example App',
      baseUrl: 'https://example.com',
      ownerTeamId: team.id,
      slackChannel: '#a11y-example',
      excludePatterns: ['/admin/.*', '/logout'],
    },
  });

  // eslint-disable-next-line no-console
  console.info('[seed] ok');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
