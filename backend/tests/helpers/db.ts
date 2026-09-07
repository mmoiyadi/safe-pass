/**
 * Test database harness.
 *
 * Each suite gets its own PostgreSQL database on the local server, created and dropped around
 * the suite. Using a real database rather than a mocked repository means the append-only
 * trigger, the check constraints, and the partial unique indexes are all exercised — and
 * several of the constitution's guarantees live in exactly those places.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../../prisma/generated/client/index.js';

const ADMIN_URL = process.env['DATABASE_URL'] ?? 'postgresql://pm:pm@localhost:5432/pm';
const BACKEND = fileURLToPath(new URL('../../', import.meta.url));

function urlFor(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

/**
 * Runs a statement against the server named by DATABASE_URL, over the wire.
 *
 * This used to shell out to `docker compose exec db psql`, which quietly made DATABASE_URL a
 * half-truth: it chose which server the tests CONNECTED to, while database creation always went
 * to one specific local compose service. Anywhere Postgres was not that service — CI with a
 * service container, a managed instance, a colleague running it natively — every suite skipped
 * rather than failing, which is the worst way for a test harness to break.
 *
 * Connecting over the URL removes the coupling, and needs no psql binary on the machine.
 */
async function adminSql(sql: string): Promise<void> {
  // CREATE and DROP DATABASE cannot run inside a transaction, so this uses its own connection
  // to the always-present `postgres` database and executes directly.
  const admin = new PrismaClient({ datasources: { db: { url: urlFor('postgres') } } });
  try {
    await admin.$executeRawUnsafe(sql);
  } finally {
    await admin.$disconnect();
  }
}

export interface TestDb {
  prisma: PrismaClient;
  url: string;
  drop: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `pm_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await adminSql(`CREATE DATABASE "${name}"`);
  const url = urlFor(name);

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', 'src/db/schema.prisma'], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return {
    prisma,
    url,
    drop: async () => {
      await prisma.$disconnect();
      await adminSql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}
