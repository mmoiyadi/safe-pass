# Running this service

Operator documentation: deployment, TLS, backups, retention, and what to do when something goes
wrong. For what the service can and cannot see, read [`security-model.md`](./security-model.md).

The governing constraint runs through everything below: **the server holds no key material.**
That makes some operational problems easy (a database leak is not a vault leak) and some
impossible (you cannot help a user who has forgotten their master password). Both are stated
where they apply.

---

## Deployment

### What you need

| | |
|---|---|
| Node | 22 or later |
| PostgreSQL | 17 |
| TLS | Required. See below. |
| SMTP | Any provider. Used for verification, invitations, and security notices. |

### Configuration

Every value is read from the environment. Nothing is read from a file committed to the
repository.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/db` |
| `COOKIE_SECRET` | yes | 32+ random bytes. The server refuses to start without it. Rotating it signs every user out. |
| `APP_URL` | yes | Public origin, e.g. `https://safe-pass.onrender.com`. Builds verification and invitation links. **Defaults to `http://localhost:5173` if unset** — the server starts and emails unusable links, which looks like success. |
| `SMTP_URL` | yes | `smtp://user:pass@host:587`. **Defaults to `smtp://localhost:1025` if unset**, so mail silently goes nowhere. |
| `NODE_ENV` | yes | `production` |

### Steps

```sh
pnpm install --frozen-lockfile
pnpm --filter backend exec prisma migrate deploy --schema src/db/schema.prisma
pnpm -r build
node backend/dist/server.js
```

The API serves `frontend/dist/` itself, so one process answers both and the origin is shared by
construction. Same-origin matters: session cookies are `SameSite=Strict`, and the service
worker's scope is the origin — split them across two hosts and both break, quietly.

`pnpm -r build` must run first: the API loads `@pm/shared` from its build, and Node cannot load
TypeScript. Set `WEB_DIST` to serve the web build from somewhere other than `frontend/dist`; if
no build is found the API starts anyway and serves only the API, which is the right failure for
an API-only deployment.

Nothing outside `/api/v1` is behind the session guard — it cannot be, since the sign-in screen
has to load before anyone has a session. `backend/tests/security/routes-are-namespaced.test.ts`
fails if a route is ever added outside that prefix, so the exemption stays safe.

### Deploying to Render, with Postgres elsewhere

`render.yaml` in the repository root describes the service. One service serves both the API and
the web app, because they must share an origin.

The database is deliberately not part of the blueprint: Render's free Postgres has historically
expired on a timer, and a vault is the wrong thing to lose on a deadline. Neon's free tier
persists and grants `CREATE ROLE`, which the schema needs — see the next section.

1. Create the database first and copy its connection string.
2. In Render, **New → Blueprint**, point it at this repository. It reads `render.yaml`.
3. Set the three secrets the blueprint marks `sync: false` — `DATABASE_URL`, `APP_URL`,
   `SMTP_URL`. `COOKIE_SECRET` is generated for you. `PORT` is supplied by Render and read by
   `server.ts`; do not set it.
4. On the service, **Settings → Deploy Hook**, copy the URL, and store it in GitHub as the
   repository secret `RENDER_DEPLOY_HOOK`.
5. Push to `main`. The audit workflow runs typecheck, lint, build and the full suite; only if it
   passes does `deploy.yml` call the hook. `autoDeploy` is off precisely so a red build cannot
   reach the web.
6. Verify the `pm_app` role bound correctly, as below. Do this once, after the first deploy.

Migrations run in the build command. There is no pre-deploy hook on the free plan, and running
them at startup would repeat them on every wake from sleep.

**On the free plan the service sleeps after about fifteen minutes idle**, and the first request
after that waits roughly thirty to sixty seconds for the container. The application itself boots
in about a quarter of a second, so the wait is the platform, not the app. Two things blunt it: the
service worker paints the interface from cache while the server wakes, and a user with offline
access enabled can read their vault without the server at all.

---

### The database role

Migrations create a non-owner role, `pm_app`. **The application must connect as `pm_app`, not as
the database owner.** The activity log's append-only guarantee is enforced by `REVOKE UPDATE,
DELETE` — and in PostgreSQL a REVOKE against a table's owner does nothing at all. Connecting as
the owner silently removes the protection while leaving every test passing.

```sh
psql "$DATABASE_URL" -c "SELECT has_table_privilege('pm_app','activity_log_entry','DELETE');"
# must return f
```

---

## TLS

**Required, not recommended.** The client sends an authentication value derived from the master
password. It is not the password and cannot decrypt anything, but it is a credential, and a
credential in cleartext is a credential someone else has.

- Terminate TLS at your load balancer or reverse proxy; the application does not terminate it.
- Send `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- The application refuses to set a session cookie without `Secure` when `NODE_ENV=production`.
- Do not enable a TLS-terminating proxy that also caches. Vault responses must never be cached
  by anything you operate.

---

## Backups

### What to back up

The PostgreSQL database. That is the whole of the server's state.

```sh
pg_dump "$DATABASE_URL" | gzip > vault-$(date +%F).sql.gz
```

### What you are actually holding

Ciphertext, wrapped keys, and account metadata. **You cannot read the secrets in your own
backup**, and neither can anyone who steals it. This is a genuine operational comfort: a leaked
database backup is a metadata incident, not a vault breach.

It is also a genuine operational limit: **a database backup cannot restore a user's access.** If
a user forgets their master password, restoring last night's dump changes nothing — the data
comes back exactly as unreadable as it was. Their own vault backup file has the same property.
Say this plainly to users who ask; implying otherwise sets up a much worse conversation later.

### Encrypt the backup anyway

The vault contents are already encrypted. The metadata — email addresses, the membership graph,
sign-in history — is not, and it is personal data under GDPR and the DPDP Act. Encrypt backups at
rest and restrict who can restore them.

### Test the restore

An untested backup is a hypothesis. Restore into a scratch database and check that
`prisma migrate status` reports it up to date and that a known account can sign in.

---

## Retention

Enforced by the application. Do not add a retention job of your own that contradicts it.

| Data | Kept |
|---|---|
| Sessions | Until expiry, then purged |
| Sign-in history | 90 days |
| Activity log | The life of the vault it belongs to |
| Pending invitations | 14 days |
| Deleted secrets | **Not at all.** Deletion is immediate and irreversible; there is no trash and no window. |
| Deleted accounts | Purged within 30 days; activity entries naming the user are pseudonymised rather than deleted, because they are another vault owner's security record |

The absence of a retention window on deleted secrets is deliberate and is stronger than the law
requires. It also means **your backups are the only copy of a deleted secret**, so restoring one
for a user is not possible without rolling their whole vault back.

---

## Monitoring

Watch these. They are the ones that mean something:

- **5xx rate on `/api/v1/auth/login`.** Users cannot reach their passwords.
- **Rate-limit rejections on login.** A spike is credential stuffing.
- **`bad_totp` sign-in events.** A spike against one account is a targeted attempt.
- **Failed key rotations.** A rotation that starts and never completes leaves a vault readable
  with an old key that a removed member may still hold. This is the one that matters most.
- **Mail delivery failures.** A user who never receives a verification link cannot be shared
  with, and will not know why.

### What must never appear in a log

Master passwords, authentication hashes, envelopes, one-time-code seeds, and secret titles. This
is enforced in `backend/src/middleware/logging.ts` and not by convention. If you add a log sink,
add it behind that redaction, and re-read the redaction list rather than assuming it covers a
field you have just introduced.

---

## Release checklist

Constitutional gate: cryptographic, authentication, and serialization dependencies **must** be
pinned and reviewed for known advisories before a release
(`.specify/memory/constitution.md`, Security Standards).

- [ ] `pnpm -r typecheck`, `pnpm lint`, `pnpm -r build` all clean
- [ ] `pnpm -r test` green, **including** `tests/security/no-plaintext.test.ts`
- [ ] `pnpm audit --audit-level=high` reports nothing
- [ ] `.github/workflows/audit.yml` green, including the pinned-crypto-deps job
- [ ] `RUN_LOAD_TESTS=1 pnpm --filter backend test load` run and its numbers recorded
- [ ] Threat model reviewed for anything this release changes ([`threat-model.md`](./threat-model.md))
- [ ] Migrations applied to a copy of production first, and `prisma migrate status` clean
- [ ] `pm_app` privilege check above returns `f`

---

## Capacity

Measured by `backend/tests/integration/load.test.ts` (see that file for how to run it).

The shape to understand: **`GET /vaults/:id/secrets` returns the entire vault.** There is no
pagination, and there cannot be — search runs on the client because the server cannot search
ciphertext, so the client needs everything. A 5,000-secret vault is roughly 2 MB of ciphertext
per load.

Reference numbers from a development laptop, PostgreSQL in Docker:

| | |
|---|---|
| Single vault read, unloaded, 5,000 secrets | ~58 ms |
| 1,000 concurrent full-vault reads | ~24 s wall clock, zero failures |
| Sustained | ~41 full-vault reads/s (~200,000 secret rows/s) |
| p99 ÷ p50 under that burst | ~1.8 (degrades in proportion; no queueing collapse) |

Scale on read throughput and database connections, not CPU: the expensive cryptography all runs
on the client, and the server does no key derivation per request.

---

## Incident runbook

### A database or backup has leaked

1. **Do not tell users their vaults are compromised.** They are not. Secret values, titles,
   folder and tag names, and vault names are ciphertext, and the keys are not in the dump.
2. Establish what *was* exposed: email addresses, the membership graph, sign-in history with
   coarse locations, activity records, and the sizes and timestamps of everything. This is
   personal data and is notifiable.
3. Notify within 72 hours where GDPR or the DPDP Act applies. Say specifically what was and was
   not exposed — a vague notice invites users to assume the worst, which here would be wrong.
4. Rotate `COOKIE_SECRET` to invalidate every session.
5. Advise users to change their master password. Note honestly that this re-wraps their key
   rather than re-encrypting their data, so a leaked dump remains readable by anyone who
   *already* had the old password — which, by the above, is nobody.

### Application servers have been compromised

Worse than a database leak, and the one case where users should be told to treat their vaults as
at risk. An attacker with control of the servers can serve modified client code and capture
master passwords as they are typed. This is the limit described in
[`security-model.md`](./security-model.md).

1. Take the service offline. A password manager serving unverified code is worse than one that
   is down.
2. Rebuild from known-good sources; do not patch in place.
3. Rotate `COOKIE_SECRET` and every credential the servers held.
4. Notify users that they should change their master password **and** the passwords of anything
   they unlocked during the exposure window.

### A rotation is stuck

A vault flagged as re-encrypting has two live key generations, and the old one still opens rows
that have not yet been rewritten. Any owner can resume it from an unlocked device. Until it
completes, a removed member who kept an offline copy can still read what that copy holds — which
is exactly what the rotation exists to end.

### A user has forgotten their master password

There is nothing to do, and saying so quickly is kinder than appearing to investigate. Their
vault cannot be recovered by us, by them, or by anyone. Their remaining options are the account
deletion flow, or a backup file if they took one and still know the password that was in force
when they took it.
