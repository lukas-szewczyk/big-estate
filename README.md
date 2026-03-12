# god monorepo

Monorepo dla stosu:

- `Postgres` lokalnie przez Docker Compose, produkcyjnie na Hetznerze
- `Axum` jako backend deployowany na Hetzner VPS
- `Astro` jako frontend deployowany do Cloudflare Workers
- `Turborepo` jako warstwa DX i orkiestracji tasków

## Wymagania lokalne

- Node.js `22+`
- `pnpm` `9+`
- Docker z `docker compose`
- Rust toolchain (`rustup`, komponenty `clippy` i `rustfmt` są przypięte w `apps/server-axum/rust-toolchain.toml`)
- opcjonalnie `cargo-watch` dla autoreloadu backendu: `cargo install cargo-watch`

## Start lokalny

```sh
corepack enable pnpm
pnpm install
cp apps/front/.env.example apps/front/.env
cp apps/server-axum/.env.example apps/server-axum/.env
pnpm db:up
pnpm migrate
pnpm bootstrap-admin
pnpm dev
```

Jeśli port `5432` jest już zajęty, `dev-tools` nie wywali już `turbo dev` i założy, że chcesz użyć istniejącego lokalnego Postgresa. Jeśli wolisz bazę zarządzaną przez repo, uruchom stack z `POSTGRES_PORT=55432` i ustaw `DATABASE_URL` na port `55432`.

Co uruchamia `pnpm dev`:

- `front`: `astro dev --host --port 4321`
- `server-axum`: `cargo watch -x run` jeśli `cargo-watch` jest dostępny, w przeciwnym razie zwykłe `cargo run`
- `@repo/dev-tools`: lokalny Postgres przez `docker compose`

## Najważniejsze komendy

```sh
pnpm dev             # cały stack lokalny
pnpm dev:front       # sam frontend
pnpm dev:server      # sam backend
pnpm db:up           # start Postgresa
pnpm db:logs         # logi Postgresa
pnpm db:down         # zatrzymanie Postgresa
pnpm db:reset        # reset wolumenu DB
pnpm migrate         # uruchomienie migracji sqlx dla backendu
pnpm bootstrap-admin # utworzenie pierwszego admina z env, jeśli jeszcze nie istnieje
pnpm lint            # astro check + cargo fmt/clippy
pnpm check-types     # astro/wrangler/cargo check
pnpm test            # cargo test
pnpm build           # build całego monorepo
pnpm verify          # lokalny odpowiednik głównego workflow CI
pnpm deploy:front    # manualny deploy Astro -> Cloudflare
```

## Struktura repo

- `apps/front`: Astro + adapter Cloudflare
- `apps/server-axum`: Axum + `sqlx` + Dockerfile pod deploy na Hetzner
- `packages/dev-tools`: taski DX dla lokalnego Postgresa
- `infra/terraform`: provisioning VPS w Hetzner Cloud

## Auth v1

Zakres wdrożonego auth:

- backendowe sesje w Postgresie z `HttpOnly` cookie `auth_session`
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- admin-only API użytkowników: `POST /users`, `GET /users`, `GET /users/:id`, `DELETE /users/:id`
- strona `/login` w Astro
- SSR-protected `/dashboard` w Astro

Założenie produkcyjne:

- frontend pod `app.example.com`
- backend pod `api.example.com`
- ustaw `AUTH_COOKIE_DOMAIN=.example.com`, żeby cookie było współdzielone między subdomenami

Lokalnie trzymaj się `localhost` zarówno dla frontu, jak i API. Mieszanie `localhost` i `127.0.0.1` psuje współdzielenie cookie.

## Environment

### `apps/front/.env`

```dotenv
SITE_URL=http://localhost:4321
PUBLIC_API_BASE_URL=http://localhost:3000
API_SERVER_BASE_URL=http://localhost:3000
```

### `apps/server-axum/.env`

```dotenv
APP_HOST=0.0.0.0
APP_PORT=3000
DATABASE_URL=postgres://god:god@127.0.0.1:5432/god
FRONTEND_ORIGIN=http://localhost:4321
AUTH_COOKIE_SECURE=false
# AUTH_COOKIE_DOMAIN=.example.com
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=change-me-now
RUST_LOG=info
```

## GitHub Actions

### `ci.yml`

Workflow jakości uruchamiany na `pull_request` i `push`:

- stawia usługę `postgres:16-alpine`
- instaluje Node + pnpm z cache dla `pnpm-lock.yaml`
- instaluje Rust stable z `clippy` i `rustfmt`
- cache'uje Cargo registry/git/target
- odpala `pnpm migrate` przed testami/auth integration flow
- na PR uruchamia `pnpm verify:affected`, na `main` pełne `pnpm verify`
- korzysta z opcjonalnego Turborepo Remote Cache, jeśli ustawisz `TURBO_TOKEN` i `TURBO_TEAM`

### `deploy-front.yml`

Deploy Astro do Cloudflare na `push` do `main`, jeśli zmienił się frontend lub współdzielone paczki frontowe.

Wymagane sekrety/zmienne repozytorium:

- secret `CLOUDFLARE_API_TOKEN`
- secret `CLOUDFLARE_ACCOUNT_ID`
- variable `SITE_URL`
- variable `PUBLIC_API_BASE_URL`
- variable `API_SERVER_BASE_URL` (jeśli SSR ma używać innego originu niż browser)

### `deploy-axum.yml`

Deploy backendu na Hetzner:

- stawia tymczasowego Postgresa do quality gates
- odpala `cargo fmt`, `cargo clippy`, migracje i testy auth/user flow
- buduje obraz Dockera z cache `gha`
- pushuje obraz do GHCR
- rollout po SSH na VPS z health-checkiem `/health`

Wymagane sekrety/zmienne repozytorium:

- variable `VPS_HOST`
- variable `VPS_USER`
- secret `VPS_SSH_KEY`
- secret `VPS_SSH_PASSPHRASE` (opcjonalnie, jeśli klucz jest zaszyfrowany)
- secret `GHCR_USERNAME`
- secret `GHCR_PAT`
- secret `SERVER_ENV_FILE` zawierający cały plik `.env` dla kontenera, np.:

```dotenv
APP_HOST=0.0.0.0
APP_PORT=3000
DATABASE_URL=postgres://user:password@db.internal:5432/god
FRONTEND_ORIGIN=https://app.example.com
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_DOMAIN=.example.com
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=change-me-now
RUST_LOG=info
```

### `terraform-validate.yml`

Waliduje Terraform przy zmianach w `infra/terraform`.

## Dalsze usprawnienia

Jeśli chcesz iść dalej, sensowne kolejne kroki to:

1. panel admina do zarządzania użytkownikami na froncie,
2. rotacja sesji i ograniczenie liczby aktywnych sesji per user,
3. reset hasła i audit log dla akcji admina.
