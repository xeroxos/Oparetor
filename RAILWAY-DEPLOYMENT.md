# UID Operator — Railway deployment

The production app is built from this repository.

## Source and build

- UI/API entrypoint: `railway-function/uid-operator-web.tsx` (Bun, zero npm runtime dependencies).
- Image: `Dockerfile.railway`.
- Railway build settings: `railway.json`.
- Healthcheck: `GET /api/healthz` (expects HTTP 200 and JSON status=ok).
- Listens on `0.0.0.0:$PORT` (default port 3000).

The original React/Flask monorepo remains in this repository. Its legacy `Dockerfile` and pnpm monorepo pipeline are **not** the currently deployed service. It failed during dependency installation. This standalone deployment avoids those build failures.

## Railway deployment

Railway project: `desirable-determination`, workspace `xeroxvps`.
Service: `uid-oparetor`, environment: `production`.
GitHub source: `xeroxos/Oparetor`, branch `main`.
Railway-generated preview: https://uid-oparetor-production.up.railway.app/

## Cloudflare custom domain

Production hostname: https://u.xeroxvps.com

Configure the `xeroxvps.com` Cloudflare zone:

- CNAME record `u` to `geewwsio.up.railway.app`.
- DNS-only (not proxied) to allow Railway's certificate/hostname validation.
- Confirm Railway custom domain is verified and the TLS certificate is valid.

## Data and privacy

- The web app stores imported UID and password records locally in the user's browser localStorage, not in the Railway database.
- **No user records from Android Termux/127.0.0.1 are automatically migrated.**
- Backend profile lookup accepts a numeric UID only; passwords are not sent in its API request.
- A PostgreSQL service exists in the Railway project for future backend persistence, but the current Bun app **does not use it**.
- The public profile lookup is best-effort and can fail if the social platform restricts access.
- Avoid importing private credentials on untrusted/shared devices, and do not rely on browser localStorage as a durable backup.

## Verification

- `GET /`: returns responsive UID Operator HTML.
- `GET /api/healthz`: returns `{"status":"ok","service":"uid-operator","version":"1.0.0"}`.
- Test Import with synthetic UIDs and confirm counters and pagination; never use real passwords in staging/QA.
