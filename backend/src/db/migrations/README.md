# Migrations

`20260901000100_constraints` and `20260901000200_activity_log_append_only` are hand-written
because Prisma's schema language cannot express CHECK constraints, partial unique indexes,
privilege grants, or triggers.

They run **after** the baseline. Generate the baseline once against a running database:

```sh
pnpm db:up
DATABASE_URL=postgresql://pm:pm@localhost:5432/pm \
  pnpm --filter backend exec prisma migrate dev --name init --schema src/db/schema.prisma
```

Prisma applies migrations in lexical directory order, so the baseline must sort before
`20260901000100_constraints`. Name it with an earlier timestamp if `migrate dev` does not.
