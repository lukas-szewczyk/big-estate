# Frontend package instructions

This file adds `apps/front`-specific guidance on top of the repo-root `AGENTS.md`. Keep it focused on work inside this package.

## Package scope

- Package: `front`
- Runtime: Astro SSR on Cloudflare Workers with React islands
- Monorepo rule: prefer target-scoped commands; do not run whole-repo tasks unless the user asks

## Start here

- Read the relevant route, component, and helper before editing
- Check `apps/front/package.json`, `apps/front/astro.config.mjs`, and `apps/front/wrangler.jsonc` when changing build or runtime behavior
- Run commands from the repo root unless there is a strong reason to `cd` into `apps/front`

## Commands

Use the smallest command that validates the change:

- `pnpm dev:front` for day-to-day frontend development
- `pnpm --filter front lint` for Astro checks
- `pnpm --filter front check-types` for Astro + TypeScript + Worker types
- `pnpm --filter front build` for production build verification
- `pnpm --filter front cf-typegen` after changing Worker bindings or `wrangler.jsonc`
- `pnpm --filter front preview` only when you need local Worker runtime behavior

Do not default to `wrangler dev` for normal UI work; `astro dev` is the standard local loop here.

## Architecture and conventions

- Prefer Astro pages for route composition and SSR data loading
- Use React islands only for interactive surfaces, not for whole-page rewrites
- Reuse existing fetch helpers before adding new API access patterns
- Keep API calls aligned with the existing split:
  - browser-facing URLs use `PUBLIC_API_BASE_URL`
  - SSR/server-side fetches use `API_SERVER_BASE_URL`
- Preserve cookie-based auth behavior; do not bypass helpers that forward `auth_session`
- Routes with live backend data should stay SSR-driven; do not switch them to static rendering unless the task explicitly requires it

## Backend contract guardrails

- Do not change request or response shapes for existing endpoints unless the task also updates `apps/server-axum`
- Login and register currently send only `email` and `password`; `confirmPassword` stays front-end validation only
- Preserve current endpoint expectations around `/auth/*` and `/api/v1/*`

## UI expectations

- Preserve the established marketplace visual language across public pages, auth, detail pages, and dashboard
- Reuse local `shadcn`-style primitives from `src/components/ui` before introducing new abstractions
- Prefer extending existing domain components over duplicating similar UI in a new folder

## Cloudflare guidance

Cloudflare Workers APIs, bindings, and limits change over time. Before making Workers-specific decisions, retrieve current Cloudflare docs for the exact product you are using.

Useful starting points:

- Workers docs: `https://developers.cloudflare.com/workers/`
- Node.js compatibility: `https://developers.cloudflare.com/workers/runtime-apis/nodejs/`
- Errors and limits: `https://developers.cloudflare.com/workers/observability/errors/`

## Validation checklist

- UI/component change: run `pnpm --filter front check-types`
- Route or data-loading change: run `pnpm --filter front check-types` and `pnpm --filter front build`
- Worker config or binding change: run `pnpm --filter front cf-typegen` and then `pnpm --filter front check-types`
