# UID Operator

A web app for bulk-checking Facebook UIDs: paste a list of UIDs, fetch each profile (name, username, picture, follower count, Instagram presence) via the shared API, then review and export the enriched results.

## Run & Operate

- `pnpm --filter @workspace/uid-web run dev` — run the web app (primary frontend, served at `/`)
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `python fb_server.py` — run the Facebook fetch service ("FB API")
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web frontend: React + Vite + Tailwind + wouter (`artifacts/uid-web`) — the primary app, served at `/`
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/uid-web` — primary web app (React + Vite), served at `/`. Frontend-only; persists data in browser `localStorage`.
- `artifacts/api-server` — shared Express API (`/api/...`) plus `fb_server.py` ("FB API") for Facebook profile fetches.
- `artifacts/mockup-sandbox` — canvas/design prototyping sandbox (not a shipped product).
- Base path is env-driven: `vite.config.ts` reads `BASE_PATH`; the router uses `import.meta.env.BASE_URL`.

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

Paste a list of Facebook UIDs (optionally `uid password` per line), fetch each profile via the API, and review enriched cards. Import de-duplicates repeated UID lines and reports how many duplicates were merged. Data is kept in the browser.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `localStorage` keys in `artifacts/uid-web/src/lib/storage.ts` are named `uid-operator-*` (`uid-operator-uids`, `uid-operator-fb-cookie`, `uid-operator-prefs`). These are just key names — do NOT rename them or existing users lose their saved data.
- The former Expo mobile app (`artifacts/uid-operator`) was removed; the web app is now the only frontend and lives at `/`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
