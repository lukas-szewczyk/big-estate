# front

Frontend Astro uruchamiany w monorepo przez pnpm + Turborepo i deployowany do Cloudflare Workers.

Najczęstsze komendy z katalogu repo:

```sh
pnpm dev:front
pnpm --filter front check-types
pnpm --filter front build
pnpm deploy:front
```

Lokalne zmienne są w `apps/front/.env`, a konfiguracja Cloudflare w `apps/front/wrangler.jsonc`.
