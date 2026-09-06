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
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BACKEND = fileURLToPath(new URL('../../', import.meta.url));

function urlFor(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

function psql(sql: string, database = 'postgres'): void {
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', 'pm', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  );
}

export interface TestDb {
  prisma: PrismaClient;
  url: string;
  drop: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `pm_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  psql(`CREATE DATABASE "${name}"`);
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
      psql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}
