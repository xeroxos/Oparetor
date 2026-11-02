# Deploy UID Operator on Render Free

1. Upload this project to a GitHub repository.
2. In Render, choose **New > Blueprint** and connect the repository.
3. Render detects `render.yaml`; confirm the `xerox-uid` free web service.
4. Deploy and wait for `/api/health` to report `{"status":"ok"}`.
5. Open the Render URL. The frontend and `/api/fb/*` API share one domain.

Optional: add `FB_DEFAULT_COOKIE` in Render environment settings if authenticated
Facebook data is required. Treat the cookie as a secret and never commit it.

The free service can sleep after inactivity, so the first request after a pause
may take roughly a minute.
