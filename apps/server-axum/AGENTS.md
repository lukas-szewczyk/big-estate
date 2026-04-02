# Backend package instructions

This file adds `apps/server-axum`-specific guidance on top of the repo-root `AGENTS.md`. Use it for work inside the Rust API package.

## Package scope

- Package: `server-axum`
- Runtime: Rust + Axum REST API with `sqlx` and Postgres
- Role in the system: backend container for auth and marketplace domain APIs
- Architecture reference: [docs/architecture/c4.md](/Users/lukasz/Documents/god/docs/architecture/c4.md)

## Start here

- Read the route wiring in `src/app.rs` before changing endpoints
- Read `src/main.rs` and `src/config.rs` before changing startup, commands, or environment behavior
- Check the nearest domain module before editing shared models or helpers
- Run commands from the repo root unless there is a strong reason to work inside `apps/server-axum`

## Code map

- `src/app.rs`: router, CORS, route registration, app state
- `src/main.rs`: process entrypoint and supported commands
- `src/config.rs`: environment variables and runtime config
- `src/auth.rs`: login, register, logout, session lookup, cookie auth
- `src/accounts.rs`: profile and agency flows
- `src/geo.rs`: dictionaries and location-related endpoints
- `src/properties.rs`: property CRUD and ownership/amenities logic
- `src/listings.rs`: listing CRUD, GeoJSON, media, open houses
- `src/engagement.rs`: wishlists, conversations, messages
- `src/reference_data.rs`: seed/reference data
- `migrations/`: SQL schema evolution
- `tests/auth_flow.rs`: integration-style API tests against Postgres
- `schema.md`: domain/data-model reference for the marketplace

## Commands

Use the smallest command that validates the change:

- `pnpm --filter server-axum dev` for local backend development
- `pnpm --filter server-axum check-types` for `cargo check`
- `pnpm --filter server-axum lint` for `rustfmt` + `clippy`
- `pnpm --filter server-axum test` for backend tests
- `pnpm --filter server-axum build` for release build verification
- `pnpm --filter server-axum migrate` to apply migrations
- `pnpm --filter server-axum bootstrap-admin` to ensure bootstrap admin exists

Useful direct cargo commands when needed:

- `cargo run --locked -- seed-reference-data`
- `cargo run --locked -- migrate`
- `cargo run --locked -- bootstrap-admin`

## Environment and runtime

- Required env: `DATABASE_URL`
- Common local env is documented in `apps/server-axum/.env.example`
- Frontend CORS origin comes from `FRONTEND_ORIGIN`
- Auth cookie name is fixed to `auth_session`
- `AUTH_COOKIE_SECURE` and `AUTH_COOKIE_DOMAIN` affect cookie behavior; do not change semantics casually
- Startup runs migrations automatically in `serve`, and bootstrap admin creation can also run at startup when configured

## API and data guardrails

- Treat `/auth/*` and `/api/v1/*` as stable contracts unless the task explicitly includes coordinated frontend changes
- If you change request/response shapes, update `apps/front` in the same slice when needed
- Schema changes must ship with matching SQL migrations in `migrations/`
- When schema or domain behavior changes materially, update `schema.md`
- Keep auth cookie/session behavior compatible with the frontend’s current expectations
- Preserve CORS behavior unless the task explicitly changes allowed origins or credential flow

## Testing and database rules

- Tests expect a reachable Postgres and will truncate/reseed tables; use a safe local test database
- Prefer running `pnpm --filter server-axum test` after endpoint, auth, query, or migration changes
- For changes in SQL, migrations, or data mapping, run at least:
  - `pnpm --filter server-axum check-types`
  - `pnpm --filter server-axum test`
- For broader backend refactors, also run `pnpm --filter server-axum lint`

## Change patterns

- New endpoint: update router in `src/app.rs`, implement handler/module logic, and add or extend tests
- New persisted field: update SQL migration, Rust queries/mappings, API serialization, and tests together
- Config change: update `src/config.rs`, `.env.example`, and any affected docs or package instructions
- Cross-container change: if backend work changes runtime architecture, update [docs/architecture/c4.md](/Users/lukasz/Documents/god/docs/architecture/c4.md)

## Coordination with the monorepo

- Follow repo-wide rules in [AGENTS.md](/Users/lukasz/Documents/god/AGENTS.md)
- Do not run whole-repo validation unless the change is shared or the user asks for it
- Keep backend changes isolated from `apps/front` unless the contract or behavior truly changes there too
