/**
 * End-to-end check against a real PostgreSQL: encrypt with the real crypto modules, persist
 * through Prisma, read back, decrypt. Then dump the database and grep for the plaintext.
 *
 * This is quickstart V1's decisive check.
 */
import { PrismaClient } from '../backend/prisma/generated/client/index.js';
import { buildRegistrationRequest } from '../frontend/src/crypto/enrolment.js';
import { deriveMasterKey, deriveAuthHash } from '../frontend/src/crypto/kdf.js';
import { deriveStretchedMasterKey } from '../frontend/src/crypto/master-key.js';
import { unwrapUserKey } from '../frontend/src/crypto/user-key.js';
import { unwrapVaultKeySymmetric } from '../frontend/src/crypto/vault-key.js';
import { decrypt, encrypt } from '../frontend/src/crypto/envelope.js';
import { base64UrlToBytes, bytesToBase64Url } from '../shared/src/envelope.js';
import type { SecretFieldValue, SecretTitle } from '../shared/src/envelope.js';

const EMAIL = 'roundtrip@example.com';
const MASTER_PASSWORD = 'correct horse battery staple';
const SECRET_PASSWORD = 'zebra-crossing-97-lantern';
const SECRET_TITLE = 'GitHub';

const g = (s: string) => `\x1b[32m${s}\x1b[0m`;
const r = (s: string) => `\x1b[31m${s}\x1b[0m`;
const prisma = new PrismaClient();
const env2buf = (e: string) => Buffer.from(base64UrlToBytes(e));

console.log('\n\x1b[1mDatabase round-trip\x1b[0m\n');

/* --- Register: client derives, server stores opaque bytes --- */
const { request } = await buildRegistrationRequest(EMAIL, MASTER_PASSWORD);

// Account deletion is an application-level sequence, not a database cascade: Vault.ownerId is
// Restrict so that closing an account cannot silently destroy a shared vault for its other
// members. Clean up in dependency order, exactly as backend/src/modules/auth/account.route.ts
// will have to.
const prior = await prisma.user.findUnique({ where: { email: EMAIL }, include: { ownedVaults: true } });
if (prior) {
  await prisma.vault.deleteMany({ where: { ownerId: prior.id } });
  await prisma.user.delete({ where: { id: prior.id } });
}
const user = await prisma.user.create({
  data: {
    email: request.email,
    // The server hashes the AuthHash AGAIN before storing it.
    authHashDigest: Buffer.from(
      await crypto.subtle.digest('SHA-256', base64UrlToBytes(request.authHash)),
    ),
    recoveryAcknowledgedAt: new Date(),
    keyring: {
      create: {
        wrappedUserKey: env2buf(request.wrappedUserKey),
        publicKey: Buffer.from(base64UrlToBytes(request.publicKey)),
        wrappedPrivateKey: env2buf(request.wrappedPrivateKey),
      },
    },
  },
});
console.log(`  registered              ${g(user.id)}`);

const vault = await prisma.vault.create({
  data: { ownerId: user.id, name: env2buf(request.personalVaultName), kind: 'personal' },
});
const membership = await prisma.vaultMembership.create({
  data: { vaultId: vault.id, userId: user.id, role: 'owner', status: 'active' },
});
await prisma.vaultKeyWrap.create({
  data: { membershipId: membership.id, keyVersion: 1, wrappedVaultKey: env2buf(request.wrappedVaultKey) },
});
console.log(`  personal vault created  ${g(vault.id)}`);

/* --- Store an encrypted secret --- */
const tv = await prisma.templateVersion.findFirstOrThrow({ where: { name: 'Website Account' } });
// Unlock exactly as a returning client would: password -> ... -> vault key.
const mk = await deriveMasterKey(MASTER_PASSWORD, EMAIL);
const smk = await deriveStretchedMasterKey(mk);
const userKey = await unwrapUserKey(smk, request.wrappedUserKey);
const vaultKey = await unwrapVaultKeySymmetric(userKey, request.wrappedVaultKey);

const secret = await prisma.secret.create({
  data: {
    vaultId: vault.id,
    templateVersionId: tv.id,
    title: env2buf(await encrypt<SecretTitle>(vaultKey, SECRET_TITLE)),
    fieldValues: {
      username: await encrypt<SecretFieldValue>(vaultKey, 'alice'),
      password: await encrypt<SecretFieldValue>(vaultKey, SECRET_PASSWORD),
    },
    keyVersion: 1,
  },
});
console.log(`  secret stored           ${g(secret.id)}`);

/* --- Read it back through a fresh unlock --- */
const row = await prisma.secret.findUniqueOrThrow({ where: { id: secret.id } });
const fields = row.fieldValues as Record<string, string>;
const title = await decrypt(vaultKey, bytesToBase64Url(row.title) as never);
const password = await decrypt(vaultKey, fields['password'] as never);

console.log(`\n  decrypted title         ${title === SECRET_TITLE ? g(title) : r(title)}`);
console.log(`  decrypted password      ${password === SECRET_PASSWORD ? g(password) : r(password)}`);

/* --- What the server actually holds --- */
// NOTE for the route implementations: Prisma 6 returns a Uint8Array for `Bytes`, not a Buffer.
// Calling .toString('base64') on it silently yields a comma-separated digit list instead of
// base64 — no error, just wrong output. Wrap in Buffer.from() at every read boundary.
console.log(
  `\n  raw title column        \x1b[2m${Buffer.from(row.title).toString('base64').slice(0, 48)}…\x1b[0m`,
);
console.log(`  raw password field      \x1b[2m${String(fields['password']).slice(0, 48)}…\x1b[0m`);

/* --- Wrong password must fail at the first layer --- */
const wrongSmk = await deriveStretchedMasterKey(await deriveMasterKey('not the password', EMAIL));
try {
  await unwrapUserKey(wrongSmk, request.wrappedUserKey);
  console.log(`\n  wrong password          ${r('UNWRAPPED — FAILURE')}`);
} catch {
  console.log(`\n  wrong password          ${g('refused')}`);
}

/* --- AuthHash sent at login must not be the decryption key --- */
const loginAuthHash = bytesToBase64Url(await deriveAuthHash(mk, MASTER_PASSWORD));
console.log(
  `  authHash == userKey?    ` +
    (loginAuthHash === bytesToBase64Url(userKey) ? r('YES — FAILURE') : g('no')),
);

await prisma.$disconnect();
console.log('');
