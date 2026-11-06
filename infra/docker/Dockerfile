# syntax=docker/dockerfile:1
FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS source
ENV CI=true
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/diagnostics/package.json packages/diagnostics/package.json
RUN --mount=type=cache,id=animesoul-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY apps ./apps
COPY packages ./packages

FROM source AS server-build
RUN pnpm --filter @animesoul/database generate \
    && pnpm --filter @animesoul/contracts build \
    && pnpm --filter @animesoul/database build \
    && pnpm --filter @animesoul/api build
# Regular application images omit the Prisma CLI; migrate and dev-box use it for upgrades.
FROM server-build AS migrate
WORKDIR /app/packages/database
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM server-build AS api-deploy
RUN pnpm --filter @animesoul/api deploy --legacy --prod /out/api

# The private all-in-one image needs Prisma to upgrade its persistent database.
FROM server-build AS dev-migrate
RUN pnpm --filter @animesoul/database deploy --legacy /out/migrate

FROM base AS api
ENV NODE_ENV=production
COPY --from=api-deploy --chown=node:node /out/api ./apps/api
COPY --chown=node:node apps/worker/main.mjs ./apps/worker/main.mjs
COPY --chown=node:node infra/docker/healthcheck.mjs ./healthcheck.mjs
RUN mkdir -p artifacts/profile-media artifacts/diagnostics artifacts/dev-mail \
    && chown -R node:node artifacts
USER node
EXPOSE 8020
CMD ["node", "apps/api/dist/main.js"]

FROM server-build AS frontend-build
RUN pnpm --filter @animesoul/web build && pnpm --filter @animesoul/admin build

FROM base AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8021
COPY --from=frontend-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=frontend-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=frontend-build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --chown=node:node infra/docker/healthcheck.mjs ./healthcheck.mjs
RUN mkdir -p artifacts/diagnostics && chown -R node:node artifacts
USER node
EXPOSE 8021
CMD ["node", "apps/web/server.js"]

FROM base AS admin
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8022
COPY --from=frontend-build --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=frontend-build --chown=node:node /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --chown=node:node infra/docker/healthcheck.mjs ./healthcheck.mjs
RUN mkdir -p artifacts/diagnostics && chown -R node:node artifacts
USER node
EXPOSE 8022
CMD ["node", "apps/admin/server.js"]

# A self-contained test environment. The snapshot contains catalog data only.
FROM postgres:18-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c AS dev-box
COPY --from=base /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DEV_BOX_DATA=/var/lib/postgresql/animesoul-dev \
    SITE_URL=http://localhost:18021 ADMIN_URL=http://localhost:18022
COPY --from=api-deploy --chown=postgres:postgres /out/api ./api
COPY --from=dev-migrate --chown=postgres:postgres /out/migrate ./migrate
COPY --from=frontend-build --chown=postgres:postgres /app/apps/web/.next/standalone ./web
COPY --from=frontend-build --chown=postgres:postgres /app/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=frontend-build --chown=postgres:postgres /app/apps/web/public ./web/apps/web/public
COPY --from=frontend-build --chown=postgres:postgres /app/apps/admin/.next/standalone ./admin
COPY --from=frontend-build --chown=postgres:postgres /app/apps/admin/.next/static ./admin/apps/admin/.next/static
COPY --chown=postgres:postgres infra/docker/dev-box ./api/dev-box
COPY --chown=postgres:postgres artifacts/dev-image/schema.dump artifacts/dev-image/catalog.dump artifacts/dev-image/manifest.json ./dev-snapshot/
RUN node --version && mkdir -p /var/lib/postgresql/animesoul-dev \
    && chown postgres:postgres /var/lib/postgresql /var/lib/postgresql/animesoul-dev
LABEL org.opencontainers.image.title="AnimeSoul private development environment" \
      org.opencontainers.image.description="Full application, runtime integrations, PostgreSQL and catalog; owner bootstrapped on first boot"
USER postgres
EXPOSE 8020 8021 8022
HEALTHCHECK --interval=15s --timeout=10s --start-period=120s --retries=8 \
    CMD ["node", "/app/api/dev-box/healthcheck.mjs"]
ENTRYPOINT ["node", "/app/api/dev-box/start.mjs"]
CMD []
