#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
SEED_FILE="$APP_DIR/seeds/demo_listings.sql"
ENV_FILE="$APP_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Add it to $ENV_FILE or export it before running this command." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to run the demo seed." >&2
  exit 1
fi

echo "Seeding demo listings into $DATABASE_URL"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SEED_FILE"
