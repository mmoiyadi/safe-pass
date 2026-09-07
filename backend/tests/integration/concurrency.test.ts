/**
 * Concurrent edits are refused, never silently merged (T137, quickstart V6).
 *
 * Two devices open the same secret. Both save. Exactly one must win, and the loser must be
 * *told* — because the alternative is that someone's password change vanishes with no error and
 * they discover it the next time they try to sign in somewhere.
 *
 * Last-write-wins is the tempting default and is wrong here for a specific reason: the server
 * cannot merge. It holds ciphertext, so it cannot compare two versions of a field or show a
 * diff. Refusing the second write is the only honest option available to it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call } from '../helpers/client.js';
import { makeActor, type Actor } from '../helpers/vaults.js';
import { encrypt, decrypt } from '../../../frontend/src/crypto/envelope.js';
import { generateVaultKey } from '../../../frontend/src/crypto/vault-key.js';

let db: TestDb;
let app: FastifyInstance;
let owner: Actor;
let vaultId: string;
let templateVersionId: string;

const vaultKey = generateVaultKey();

async function makeSecret(title: string, value: string): Promise<{ id: string; revision: number }> {
  const res = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
    cookie: owner.cookie,
    payload: {
      templateVersionId,
      title: await encrypt(vaultKey, title),
      fieldValues: { password: await encrypt(vaultKey, value) },
      keyVersion: 1,
    },
  });
  expect(res.status).toBe(201);
  return { id: res.body['id'] as string, revision: res.body['revision'] as number };
}

async function save(
  secretId: string,
  value: string,
  revision: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return call(app, 'PUT', `/vaults/${vaultId}/secrets/${secretId}`, {
    cookie: owner.cookie,
    payload: {
      templateVersionId,
      title: await encrypt(vaultKey, 'shared title'),
      fieldValues: { password: await encrypt(vaultKey, value) },
      keyVersion: 1,
      revision,
    },
  });
}

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);
  owner = await makeActor(app, db.prisma, 'concurrent@example.test');
  vaultId = owner.personalVaultId;

  const template = await db.prisma.template.create({ data: { kind: 'builtin', ownerId: null } });
  const version = await db.prisma.templateVersion.create({
    data: {
      templateId: template.id,
      version: 1,
      name: 'Website Account',
      fields: [{ id: 'password', label: 'Password', type: 'password', required: true, sensitive: true, order: 0 }],
    },
  });
  templateVersionId = version.id;
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('two devices editing the same secret', () => {
  it('accepts the first save and refuses the second', async () => {
    const secret = await makeSecret('Bank', 'original');

    // Both devices loaded the same revision before either saved.
    const deviceA = secret.revision;
    const deviceB = secret.revision;

    const first = await save(secret.id, 'from device A', deviceA);
    expect(first.status).toBe(200);

    const second = await save(secret.id, 'from device B', deviceB);
    expect(second.status).toBe(409);
    expect(second.body['error']).toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('keeps the winner intact — the refused write changed nothing', async () => {
    const secret = await makeSecret('Email', 'original');
    await save(secret.id, 'the winner', secret.revision);
    await save(secret.id, 'the loser', secret.revision);

    const read = await call(app, 'GET', `/vaults/${vaultId}/secrets/${secret.id}`, {
      cookie: owner.cookie,
    });
    const fields = read.body['fieldValues'] as Record<string, string>;
    expect(await decrypt(vaultKey, fields['password'] as never)).toBe('the winner');
  });

  /**
   * The refusal carries the winning row, not just a revision number. That is what lets the
   * client show "here is what is stored now" beside the user's unsaved edit — without it, the
   * only honest thing an interface could say is "try again", with the other version invisible.
   */
  it('hands back the current row, so the loser can see what it lost to', async () => {
    const secret = await makeSecret('Router', 'original');
    await save(secret.id, 'the winner', secret.revision);
    const conflict = await save(secret.id, 'the loser', secret.revision);

    const details = (conflict.body['error'] as { details?: Record<string, unknown> }).details;
    const current = details?.['current'] as Record<string, unknown> | undefined;

    expect(current).toBeDefined();
    expect(current!['revision']).toBeGreaterThan(secret.revision);

    // Still ciphertext: a conflict response is not an excuse to hand over a readable value.
    const fields = current!['fieldValues'] as Record<string, string>;
    expect(fields['password']).toMatch(/^AQ/);
    expect(await decrypt(vaultKey, fields['password'] as never)).toBe('the winner');
  });

  it('lets the loser succeed once it has reloaded', async () => {
    const secret = await makeSecret('Wifi', 'original');
    await save(secret.id, 'first', secret.revision);

    const reloaded = await call(app, 'GET', `/vaults/${vaultId}/secrets/${secret.id}`, {
      cookie: owner.cookie,
    });
    const current = reloaded.body['revision'] as number;

    const retry = await save(secret.id, 'second, after reloading', current);
    expect(retry.status).toBe(200);
  });

  /**
   * The race, rather than the sequence. Fired together so they genuinely contend, which is
   * where a check-then-write implemented outside a transaction would let both through.
   */
  it('refuses all but one of several simultaneous saves at the same revision', async () => {
    const secret = await makeSecret('Contended', 'original');

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => save(secret.id, `writer ${i}`, secret.revision)),
    );

    const accepted = results.filter((r) => r.status === 200);
    const refused = results.filter((r) => r.status === 409);

    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(4);
  });

  it('advances the revision by exactly one per accepted write', async () => {
    const secret = await makeSecret('Counter', 'v0');
    let revision = secret.revision;

    for (let i = 1; i <= 3; i++) {
      const res = await save(secret.id, `v${i}`, revision);
      expect(res.status).toBe(200);
      expect(res.body['revision']).toBe(revision + 1);
      revision = res.body['revision'] as number;
    }
  });

  it('refuses a write that omits the revision, rather than treating it as "latest"', async () => {
    const secret = await makeSecret('Unversioned', 'original');
    const res = await call(app, 'PUT', `/vaults/${vaultId}/secrets/${secret.id}`, {
      cookie: owner.cookie,
      payload: {
        templateVersionId,
        title: await encrypt(vaultKey, 'no revision'),
        fieldValues: { password: await encrypt(vaultKey, 'no revision') },
        keyVersion: 1,
      },
    });
    // A missing revision is a client that has not read the row. Defaulting to "latest" would
    // silently reintroduce last-write-wins for exactly the callers most likely to be stale.
    expect([400, 409]).toContain(res.status);
  });
});
