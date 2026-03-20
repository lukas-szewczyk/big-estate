# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command               | Purpose                   |
| --------------------- | ------------------------- |
| `npx wrangler dev`    | Local development         |
| `npx wrangler deploy` | Deploy to Cloudflare      |
| `npx wrangler types`  | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Auth Design-to-Code Contract

- Treat `design.pen` as the source of truth for auth UX before changing `/login` or `/register`.
- Current route mapping is fixed: `dT0Ca` -> `/login`, `m1uNU` -> `/register`.
- If auth copy or structure changes, update both the Astro implementation and `AUTH_FLOW.md` in the same slice.
- Keep `/` as a redirect-only route. Do not reintroduce a full auth page there.
- Reuse the existing auth shell and shadcn primitives in `src/components/auth` before creating new auth-specific markup.
- Do not invent a new visual direction for auth in code. If the desired UI differs from Pencil, update Pencil first or in the same task.
- In summaries, PR notes, or review comments for auth work, include the Pencil frame IDs you matched against.
