# syntax=docker/dockerfile:1.7
# Switchboard web image — FLY.IO variant of apps/web/Dockerfile. Identical build
# (Vite SPA in real-API mode, served by non-root nginx on :8080); the ONLY diff is
# the nginx config copied in — deploy/fly/nginx.fly.conf, whose api upstream is
# switchboard-api.flycast:3000 (Fly private net) instead of the compose api:3000.
#
# Build from the REPO ROOT so the monorepo COPYs resolve:
#   fly deploy -c deploy/fly/fly.web.toml   (run at repo root)

ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine
ARG PNPM_VERSION=10.31.0

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH=/pnpm:$PATH
ENV COREPACK_DEFAULT_TO_LATEST=0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch

FROM deps AS build
COPY . .
RUN pnpm install -r --offline --frozen-lockfile
# Same-origin API, root base path; the build also runs `tsc --noEmit`.
ENV VITE_API_MODE=real
ENV VITE_BASE=/
RUN pnpm --filter @switchboard/web run build

FROM ${NGINX_IMAGE} AS runtime
USER root
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY deploy/fly/nginx.fly.conf /etc/nginx/conf.d/default.conf
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O - http://127.0.0.1:8080/nginx-health || exit 1
