# Auth Flow

## Source Of Truth

- Pencil file: [`design.pen`](design.pen)
- Login frame: `dT0Ca` -> `/login`
- Register frame: `m1uNU` -> `/register`

## Implementation Map

- Shared auth document wrapper: [`src/components/auth/AuthPage.astro`](src/components/auth/AuthPage.astro)
- Shared auth screen composition: [`src/components/auth/AuthScreen.tsx`](src/components/auth/AuthScreen.tsx)
- Shared submit + error handling: [`src/scripts/auth-form.ts`](src/scripts/auth-form.ts)
- Routes: [`src/pages/login.astro`](src/pages/login.astro), [`src/pages/register.astro`](src/pages/register.astro), [`src/pages/index.astro`](src/pages/index.astro)

## Acceptance Checklist

- `/` redirects to `/login` for anonymous users and `/dashboard` for authenticated users.
- `/login` matches frame `dT0Ca` in structure, copy, and overall spacing.
- `/register` matches frame `m1uNU` and only collects `email`, `password`, `confirmPassword`, plus front-only terms acceptance.
- Successful login and register both land on `/dashboard`.
- `/dashboard` redirects back to `/login` when the session is missing.
- Any auth UI change updates both code and this document.

## Codex Prompt Template

```md
Implement an auth UI change in `apps/front`.

Requirements:

- Read `apps/front/design.pen` first.
- Match Pencil frame `dT0Ca` for `/login` and `m1uNU` for `/register`.
- Reuse `src/components/auth/AuthPage.astro`, `src/components/auth/AuthScreen.tsx`, and `src/scripts/auth-form.ts`.
- Keep `/` redirect-only.
- If the design changes, update both `design.pen` and `apps/front/AUTH_FLOW.md`.
- In your summary, mention which Pencil frame IDs you validated against.
```
