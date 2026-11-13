FROM node:24-bookworm-slim AS web-build

WORKDIR /app
RUN npm install -g pnpm@10.20.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY artifacts/uid-web ./artifacts/uid-web
COPY lib ./lib
ENV CI=true PNPM_DANGEROUSLY_ALLOW_ALL_BUILDS=true PORT=5173 BASE_PATH=/
RUN pnpm install --frozen-lockfile --reporter=append-only
RUN pnpm --filter @workspace/uid-web run build

FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 STATIC_DIR=/app/static PORT=10000
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY artifacts/api-server/fb_server.py ./fb_server.py
COPY --from=web-build /app/artifacts/uid-web/dist/public ./static
EXPOSE 10000
CMD ["sh", "-c", "gunicorn --workers 1 --threads 8 --timeout 120 --bind 0.0.0.0:${PORT} fb_server:app"]
