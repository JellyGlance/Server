# amd64 + arm64 use Node 24 LTS; linux/arm/v7 (TARGETARCH=arm) uses Node 22
# because node:24-bookworm-slim has no arm/v7 variant.
ARG TARGETARCH

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS node-amd64
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS node-arm64
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS node-arm

FROM node-${TARGETARCH} AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci

FROM deps AS web-builder
WORKDIR /app
COPY apps/web apps/web
RUN npm run build -w @jellyglance/web

ARG TARGETARCH
FROM node-${TARGETARCH} AS runtime
LABEL org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
  CONFIG_DIR=/app/config \
  BACKUP_DIR=/app/backups
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 wget fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/config /app/backups

COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev --workspace @jellyglance/api --include-workspace-root=false

COPY apps/api apps/api
COPY --from=web-builder /app/apps/web/dist apps/web/dist
COPY apps/web/src/whats-new.json apps/web/src/whats-new.json
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/auth/isConfigured || exit 1

EXPOSE 3000
VOLUME ["/app/config", "/app/backups"]
CMD ["/entrypoint.sh"]
