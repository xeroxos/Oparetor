# UID Operator — Railway + Cloudflare production

Production: **https://u.xeroxvps.com**

Repository: `xeroxos/Oparetor` on `main`
Railway project: `desirable-determination`; service: `uid-oparetor`; environment: `production`.
Cloudflare zone: `xeroxvps.com`.

## Runtime and source

The real mobile dashboard is **React/Vite** (`artifacts/uid-web`) served by **Flask/Gunicorn** (`artifacts/api-server/fb_server.py`). The old Bun-only UI under `railway-function/` is obsolete; **do not switch back**.

- Dockerfile: `Dockerfile.restore`
- Railway config: `railway.json`
- React frontend build: `pnpm --filter @workspace/uid-web run build`
- React TypeScript check: `pnpm --filter @workspace/uid-web run typecheck`
- Flask regression suite: `python -m unittest discover -s tests -p 'test_fb_server.py' -v`
- Healthcheck: `GET /api/health` returns HTTP 200 and `{"status":"ok"}`
- Frontend pages: `/`, `/import`, `/saved`, `/settings`
- API endpoint: `POST /api/fb/uid/fetch` with `{"uids":[{"uid":"100000000000000"}]}`

## Cloudflare DNS

CNAME `u` → `geewwsio.up.railway.app`. Record is **DNS-only**, not proxied. Railway owns the HTTPS certificate and custom domain verification.

## Data and recovery

- UID entries (including optional passwords, names and photos) are **local to each browser profile** in IndexedDB. Existing `uid-operator-uids` localStorage data is migrated on first load without deleting it.
- This does **not** synchronize data between devices, localhost, and `u.xeroxvps.com`. Browsers isolate storage by origin. No saved data from the prior `127.0.0.1:3000` is included automatically.
- To move records from the old browser: copy or export the UID rows there, then open **Settings → Backup & Restore** or **Import** on the new domain and paste the `UID|password` rows, or select a JSON backup. Always keep a private backup before clearing data.
- **Never share a JSON/TXT backup publicly**: exports can contain plaintext passwords.
- PostgreSQL is running in the Railway project but not connected to the UID browser store. Do not represent it as server-side UID persistence.

## Fetch and retry

Public profile lookup:
- Only numeric UIDs of 5–25 digits; max 15 per API request.
- Requests are processed sequentially through the browser queue, 6 UIDs per batch with a gap between batches. Backend concurrency is limited to 3 workers; old 30-UID client requests remain supported.
- Imported UID passwords are never transmitted to the profile API. If the user explicitly saves an authorized Facebook session in **Settings → Profile fetching session**, the session cookie is sent over HTTPS to this same-origin Railway backend only while fetching; it is used for the previous cookie-backed mbasic lookup and is never returned or logged. Avoid storing session cookies on a shared device.
- Import can opt out of automatic lookup. Resume pending fetches after browser restart; failed entries can be manually retried in groups of up to 24.
- When Facebook returns a login wall, HTTP 429/rate limit, or systemic network error, the browser queue stops immediately; the remaining UIDs stay in Pending with `paused` and `fetchError` in IndexedDB instead of being falsely labeled failed. After the source recovers, explicitly resume a small batch from the pause banner.
- HTTP 200 for `POST /api/fb/uid/fetch` means the app accepted the batch, NOT that all UID metadata was retrieved. Check per-UID `status` / `error` and aggregate `diagnostics` returned by the endpoint.
- Previously failed records from a bulk import are not reset or automatically re-fetched by a deployment; use small, manually triggered retry batches to avoid repeatedly querying a blocked source.
- Photo fetch starts with direct HTTPS FB CDN; if that is blocked, the same-origin proxy may be used.
- Facebook may restrict or change metadata access. A valid authorized session may allow details available to the logged-in account, but the app cannot guarantee fetching or bypass account restrictions. Do not share session cookies in messages or logs.

## Release checklist

1. Deploy to an isolated Railway staging service from a feature branch (do not replace `main` or the custom domain before QA).
2. Confirm TypeScript compilation, Python compilation, 8+ mock-only backend tests, and `/api/health` pass.
3. Exercise Import with synthetic UID rows and **Auto-fetch disabled**; verify counters, pagination, search, Saved and JSON export/restore, and persistence after reload.
4. Merge tested code into `main`; deploy the production service.
5. Verify Railway deployment status SUCCESS, Cloudflare custom domain VALID, health endpoint, and all React deep links.
6. Remove only temporary staging resources; keep production PostgreSQL and user data intact.
