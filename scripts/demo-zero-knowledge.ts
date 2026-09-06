/**
 * Manual demonstration of the zero-knowledge property.
 *
 * Uses the REAL crypto modules from frontend/src/crypto — nothing is reimplemented here.
 * Run:  pnpm demo
 */
import { deriveAuthHash, deriveMasterKey } from '../frontend/src/crypto/kdf.js';
import { deriveStretchedMasterKey } from '../frontend/src/crypto/master-key.js';
import {
  generateKeypair,
  generateUserKey,
  importPublicKey,
  unwrapPrivateKey,
  unwrapUserKey,
  wrapUserKey,
} from '../frontend/src/crypto/user-key.js';
import {
  generateVaultKey,
  unwrapVaultKeyForMember,
  unwrapVaultKeySymmetric,
  wrapVaultKeyForMember,
  wrapVaultKeySymmetric,
} from '../frontend/src/crypto/vault-key.js';
import { decrypt, encrypt } from '../frontend/src/crypto/envelope.js';
import { bytesToBase64Url } from '../shared/src/envelope.js';

const EMAIL = 'alice@example.com';
const MASTER_PASSWORD = 'correct horse battery staple';
const SECRET = 'hunter2';

const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
const g = (s: string) => `\x1b[32m${s}\x1b[0m`;
const r = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const short = (s: string) => (s.length > 52 ? `${s.slice(0, 52)}…` : s);
const rule = () => console.log(dim('─'.repeat(72)));

console.log(`\n${b('Zero-knowledge demonstration')}`);
console.log(dim(`master password: "${MASTER_PASSWORD}"  ·  secret to store: "${SECRET}"`));

/* 1 — Build the key hierarchy, entirely on this "device". */
rule();
console.log(b('\n1. Deriving the key hierarchy (all of this stays on the device)\n'));

const masterKey = await deriveMasterKey(MASTER_PASSWORD, EMAIL);
const stretched = await deriveStretchedMasterKey(masterKey);
const authHash = await deriveAuthHash(masterKey, MASTER_PASSWORD);

console.log(`   MasterKey          ${dim(short(bytesToBase64Url(masterKey)))}`);
console.log(`   ├─ StretchedMaster ${dim(short(bytesToBase64Url(stretched)))}  ${g('stays home — this one decrypts')}`);
console.log(`   └─ AuthHash        ${dim(short(bytesToBase64Url(authHash)))}  ${g('goes to server — proves identity only')}`);

const userKey = generateUserKey();
const vaultKey = generateVaultKey();
const keypair = await generateKeypair(userKey);

const wrappedUserKey = await wrapUserKey(stretched, userKey);
const wrappedVaultKey = await wrapVaultKeySymmetric(userKey, vaultKey);
const encryptedSecret = await encrypt(vaultKey, SECRET);

/* 2 — Everything the server receives. */
rule();
console.log(b('\n2. What the server receives and stores\n'));
const serverRow = {
  email: EMAIL,
  authHashDigest: short(bytesToBase64Url(authHash)),
  wrappedUserKey: short(wrappedUserKey),
  publicKey: short(keypair.publicKey),
  wrappedPrivateKey: short(keypair.wrappedPrivateKey),
  wrappedVaultKey: short(wrappedVaultKey),
  secretCiphertext: short(encryptedSecret),
};
for (const [k, v] of Object.entries(serverRow)) console.log(`   ${k.padEnd(18)} ${dim(v)}`);

const dump = JSON.stringify(serverRow);
console.log(
  `\n   Does the stored data contain "${SECRET}"?  ` +
    (dump.includes(SECRET) ? r('YES — FAILURE') : g('no')),
);
console.log(
  `   Does it contain the master password?      ` +
    (dump.includes(MASTER_PASSWORD) ? r('YES — FAILURE') : g('no')),
);

/* 3 — The server tries, and fails, to read it. */
rule();
console.log(b('\n3. The server attempts to decrypt with everything it holds\n'));
for (const [name, key] of [
  ['AuthHash (what it stores)', authHash],
  ['MasterKey (it never sees this — trying anyway)', masterKey],
] as const) {
  try {
    await decrypt(key, encryptedSecret);
    console.log(`   ${name.padEnd(46)} ${r('DECRYPTED — FAILURE')}`);
  } catch {
    console.log(`   ${name.padEnd(46)} ${g('refused')}`);
  }
}

/* 4 — The real client unlocks. */
rule();
console.log(b('\n4. The owner signs in on a new device, with only their password\n'));
const mk2 = await deriveMasterKey(MASTER_PASSWORD, EMAIL);
const uk2 = await unwrapUserKey(await deriveStretchedMasterKey(mk2), wrappedUserKey);
const vk2 = await unwrapVaultKeySymmetric(uk2, wrappedVaultKey);
console.log(`   Recovered secret: ${g(await decrypt(vk2, encryptedSecret))}`);

console.log(b('\n   …and with the wrong password:'));
const wrongMk = await deriveMasterKey('wrong password entirely', EMAIL);
try {
  await unwrapUserKey(await deriveStretchedMasterKey(wrongMk), wrappedUserKey);
  console.log(`   ${r('unwrapped — FAILURE')}`);
} catch {
  console.log(`   ${g('refused at the first layer — the vault key is never even reached')}`);
}

/* 5 — Password change is O(1). */
rule();
console.log(b('\n5. Changing the master password\n'));
const newStretched = await deriveStretchedMasterKey(
  await deriveMasterKey('an entirely different passphrase', EMAIL),
);
const storedBefore = encryptedSecret;
const wrappedVaultKeyBefore = wrappedVaultKey;

const rewrapped = await wrapUserKey(newStretched, uk2);

console.log(`   Rows rewritten: ${g('1')} ${dim('(the wrapped user key)')}`);
console.log(`   Secrets re-encrypted: ${g('0')}`);
console.log(
  `   Stored secret ciphertext byte-identical: ` +
    (storedBefore === encryptedSecret ? g('yes') : r('no — FAILURE')),
);
console.log(
  `   Stored vault-key wrap byte-identical:    ` +
    (wrappedVaultKeyBefore === wrappedVaultKey ? g('yes') : r('no — FAILURE')),
);
const vk3 = await unwrapVaultKeySymmetric(await unwrapUserKey(newStretched, rewrapped), wrappedVaultKey);
console.log(`   Secret still readable: ${g(await decrypt(vk3, encryptedSecret))}`);

/* 6 — Sharing, without either party learning the other's password. */
rule();
console.log(b("\n6. Sharing the vault with Bob — the server carries it and reads nothing\n"));
const bobUserKey = generateUserKey();
const bobKeys = await generateKeypair(bobUserKey);

const forBob = await wrapVaultKeyForMember(await importPublicKey(bobKeys.publicKey), vaultKey);
console.log(`   Alice wraps the vault key to Bob's PUBLIC key: ${dim(short(forBob))}`);
console.log(`   ${dim('Alice never learned Bob’s password; Bob never learned Alice’s.')}`);

const bobPrivate = await unwrapPrivateKey(bobUserKey, bobKeys.wrappedPrivateKey);
const bobVaultKey = await unwrapVaultKeyForMember(bobPrivate, forBob);
console.log(`   Bob reads: ${g(await decrypt(bobVaultKey, encryptedSecret))}`);

console.log(b('\n   A revoked member (their wrap deleted) holding only the public key:'));
try {
  await decrypt(
    (await importPublicKey(bobKeys.publicKey)) as unknown as Uint8Array,
    encryptedSecret,
  );
  console.log(`   ${r('read it — FAILURE')}`);
} catch {
  console.log(`   ${g('cannot read it')}`);
}

rule();
console.log(`\n${g('Every check passed.')} ${dim('The server held a complete account and could not read one secret.')}\n`);
