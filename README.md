# god monorepo

Monorepo dla stosu:

- `Astro` na Cloudflare Workers w `apps/front`
- `Axum` + `sqlx` w `apps/server-axum`
- `Postgres` jako zewnętrzna baza wskazywana przez `DATABASE_URL`
- `Turborepo` jako warstwa DX i orkiestracji tasków

## Wymagania

- Node.js `22+`
- `pnpm` `9+`
- Rust toolchain z `cargo`, `rustfmt` i `clippy`
- działający Postgres dostępny pod `DATABASE_URL`

## Start lokalny

```sh
corepack enable pnpm
pnpm install
cp apps/front/.env.example apps/front/.env
cp apps/server-axum/.env.example apps/server-axum/.env

# Upewnij się, że DATABASE_URL wskazuje działający Postgres.
pnpm migrate
pnpm bootstrap-admin
pnpm dev
```

`pnpm dev` uruchamia równolegle:

- `front`: `astro dev --host --port 4321`
- `server-axum`: `cargo watch -x run` jeśli `cargo-watch` jest dostępny, inaczej `cargo run --locked`

## Najważniejsze komendy

```sh
pnpm dev
pnpm dev:front
pnpm dev:server
pnpm migrate
pnpm bootstrap-admin
pnpm lint
pnpm check-types
pnpm test
pnpm build
pnpm verify
pnpm deploy:front
```

## Struktura repo

- `apps/front`: Astro SSR, shadcn, design w `design.pen`
- `apps/server-axum`: backend Axum, auth, migracje i testy integracyjne
- `packages/eslint-config`: współdzielony ESLint config
- `packages/typescript-config`: współdzielony TypeScript config
- `packages/ui`: eksperymentalna paczka UI, obecnie auth w `front` korzysta z lokalnego `src/components/ui`

## Architektura

- Diagram C4 systemu znajdziesz w [`docs/architecture/c4.md`](docs/architecture/c4.md)

## Auth v1

Aktualny zakres auth:

- `POST /auth/login`
- `POST /auth/register`
- `POST /auth/logout`
- `GET /auth/me`
- publiczne strony `/login` i `/register`
- redirect-only `/`
- SSR-protected `/dashboard`
- backendowe sesje w Postgresie z `HttpOnly` cookie `auth_session`

Design-to-code dla auth jest opisany w:

- [`apps/front/AUTH_FLOW.md`](apps/front/AUTH_FLOW.md)
- [`apps/front/AGENTS.md`](apps/front/AGENTS.md)

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

## CI

Repo ma minimalny workflow GitHub Actions w `.github/workflows/ci.yml`, który:

- instaluje Node, pnpm i Rust,
- uruchamia `pnpm lint`,
- uruchamia `pnpm check-types`,
- uruchamia `pnpm build`,
- uruchamia backendowe testy auth na Postgres service.

## Compose

`compose.yaml` w tym repo uruchamia konsolę Autobase. Nie zastępuje bazy aplikacyjnej dla `server-axum`, więc testy i migracje nadal wymagają działającego Postgresa pod `DATABASE_URL`.
