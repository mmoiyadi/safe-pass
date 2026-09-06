#!/usr/bin/env bash
# Rebuild the local database from scratch: fresh container, all migrations, seeded templates.
set -euo pipefail

cd "$(dirname "$0")/.."

# Prisma reads .env automatically; tsx does not, so it is also exported below.
if [ ! -f .env ]; then
  cp .env.example .env
  # A real random cookie secret, so the server can boot without further setup.
  SECRET=$(head -c 32 /dev/urandom | base64)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^COOKIE_SECRET=.*|COOKIE_SECRET=${SECRET}|" .env
  else
    sed -i "s|^COOKIE_SECRET=.*|COOKIE_SECRET=${SECRET}|" .env
  fi
  echo "Created .env from .env.example (gitignored)."
fi

set -a; . ./.env; set +a

echo "Starting containers..."
docker compose down -v >/dev/null 2>&1 || true
docker compose up -d

# Poll the healthcheck rather than sleeping a fixed interval — a cold image pull or a slow
# machine takes longer than any constant that is short enough to be pleasant on a warm one.
printf "Waiting for PostgreSQL"
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U pm -d pm >/dev/null 2>&1; then
    echo " ready."
    break
  fi
  printf "."
  sleep 1
  if [ "$i" -eq 60 ]; then echo; echo "Database did not become ready in 60s." >&2; exit 1; fi
done

echo "Applying migrations..."
pnpm --filter backend exec prisma migrate deploy --schema src/db/schema.prisma

echo "Generating Prisma client..."
pnpm --filter backend exec prisma generate --schema src/db/schema.prisma >/dev/null

echo "Seeding built-in templates..."
pnpm --filter backend exec tsx src/db/seed.ts

echo
echo "Database ready.  Try:  pnpm db:roundtrip"
