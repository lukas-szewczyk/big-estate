#!/usr/bin/env sh
set -eu

MODE=${1:-dev}
PORT=${POSTGRES_PORT:-5432}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
COMPOSE="docker compose --project-directory $PROJECT_ROOT -f $PROJECT_ROOT/compose.yaml"
CONTAINER_NAME='god-postgres'

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
  fi

  if command -v nc >/dev/null 2>&1; then
    if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
      return 0
    fi
  fi

  if command -v ss >/dev/null 2>&1; then
    if ss -ltn "( sport = :$PORT )" | tail -n +2 | grep -q .; then
      return 0
    fi
  fi

  return 1
}

container_exists() {
  docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"
}

container_running() {
  docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"
}

start_managed_postgres() {
  eval "$COMPOSE up -d postgres"
}

follow_logs() {
  eval "$COMPOSE logs -f postgres"
}

sleep_forever() {
  while :; do
    sleep 3600
  done
}

if container_running; then
  echo "[dev-tools] Using managed postgres container on port $PORT."
  if [ "$MODE" = "dev" ]; then
    follow_logs
  fi
  exit 0
fi

if port_in_use; then
  echo "[dev-tools] Port $PORT is already in use. Assuming an external Postgres instance and skipping docker compose startup."
  echo "[dev-tools] If you want the repo-managed Postgres instead, run with POSTGRES_PORT=55432 and point DATABASE_URL to that port."
  if [ "$MODE" = "dev" ]; then
    sleep_forever
  fi
  exit 0
fi

if container_exists; then
  echo "[dev-tools] Starting existing managed postgres container on port $PORT."
else
  echo "[dev-tools] Starting managed postgres container on port $PORT."
fi

start_managed_postgres

if [ "$MODE" = "dev" ]; then
  follow_logs
fi
