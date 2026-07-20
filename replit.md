# Notibot

A Discord selfbot → official bot forwarder for the "Play Together" game community. Monitors game notification channels (seeds, weather, tools shop, refresh timers) on a source server and forwards them — reformatted with custom embeds and role pings — to a target server.

## Run & Operate

- **Notibot** is run via the `Notibot` workflow: `pnpm --filter @workspace/notibot run dev` (runs `node index.js` in `bots/notibot/`)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000, scaffolding only)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (API server only)

## Required Secrets (Notibot)

- `DISCORD_TOKEN` — Discord user account token (selfbot that reads source channels)
- `BOT_TOKEN` — Official Discord bot token (sends messages to target channels)
- `MONGODB_URI` — MongoDB connection string (usage limits and join records)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
