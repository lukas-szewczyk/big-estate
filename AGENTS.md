Never, ever, under any circumstances, ever, not once, no matter what, try to start the dev server, it’s already fucking running.

# Project instructions

This repository is a Turborepo monorepo for a real-estate marketplace.

Use this file as the repo-wide starting point. If you work in a subdirectory that has its own `AGENTS.md`, follow both files, with the more local file taking precedence for that area.

## What this project is

- Product: marketplace nieruchomości
- Frontend: `apps/front` is an Astro SSR app deployed to Cloudflare Workers, with React islands for interactive UI
- Backend: `apps/server-axum` is a Rust + Axum API using `sqlx`
- Data store: external Postgres provided via `DATABASE_URL`
- Build orchestration: Turborepo

Architecture reference:

- Read [docs/architecture/c4.md](./docs/architecture/c4.md) before making architectural changes or adding new runtime pieces

## Repository map

- `apps/front`: public marketplace UI, auth pages, dashboard, map sandbox, Worker config
- `apps/server-axum`: REST API, auth, migrations, bootstrap, integration tests
- `packages/eslint-config`: shared ESLint config
- `packages/typescript-config`: shared TypeScript config
- `packages/ui`: shared UI package, currently secondary to local UI in `apps/front`

More local instructions:

- Frontend-specific guidance lives in [apps/front/AGENTS.md](./apps/front/AGENTS.md)

## Working in this Turborepo

- Identify the owning app or package before editing files
- Prefer target-scoped commands; do not run monorepo-wide tasks unless the task is intentionally cross-cutting or the user asks for it
- Prefer `pnpm --filter <target> <script>` for package-local work
- Use `turbo run <task> --filter=<target>` when you need the Turborepo task graph specifically
- Keep changes inside the smallest relevant workspace
- Avoid touching unrelated apps or shared packages just because they are nearby in the tree


## Common commands

From repo root:

- `pnpm dev` starts both apps through Turborepo
- `pnpm dev:front` starts only the frontend
- `pnpm dev:server` starts only the backend
- `pnpm migrate` runs backend database migrations
- `pnpm bootstrap-admin` ensures the bootstrap admin exists
- `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build` run monorepo-wide tasks; use only when cross-repo validation is actually needed
- `pnpm verify` runs the full repo validation suite

Targeted commands you will usually want instead:

- `pnpm --filter front lint`
- `pnpm --filter front check-types`
- `pnpm --filter front build`
- `pnpm --filter server-axum check-types`
- `pnpm --filter server-axum lint`
- `pnpm --filter server-axum test`

## Validation rules

- After changes, run the smallest validation command that covers the edited target
- Frontend-only change: validate `front`, not the whole monorepo
- Backend-only change: validate `server-axum`, not the whole monorepo
- Shared config change in `packages/*` or root config change: validate all affected dependents, and widen to repo-level validation only if needed
- If you change env-sensitive build behavior, include a build check for the affected app

## Runtime and architecture guardrails

- Treat `apps/front` and `apps/server-axum` as the runtime containers of this system; `packages/*` are support code/config, not separate deployed services
- `compose.yaml` runs Autobase console tooling; it is not the application database for `server-axum`
- The application database is Postgres reached through `DATABASE_URL`
- Existing auth is cookie-based with `auth_session`
- The frontend talks to the backend using `PUBLIC_API_BASE_URL` and `API_SERVER_BASE_URL`
- The current runtime architecture should stay aligned with [docs/architecture/c4.md](./docs/architecture/c4.md) unless the task explicitly changes architecture too

## Change guidance by area

- Frontend work: also read [apps/front/AGENTS.md](./apps/front/AGENTS.md)
- Backend work: inspect `apps/server-axum/package.json`, `Cargo.toml`, migrations, and route modules before changing API behavior
- Cross-cutting work: verify whether the change is really shared or whether it belongs in one app only

## Documentation expectations

- If you change runtime architecture, update [docs/architecture/c4.md](./docs/architecture/c4.md) in the same slice
- If you add a new workspace-specific workflow, prefer documenting it in the nearest relevant `AGENTS.md` instead of bloating this root file
