# syntax=docker/dockerfile:1.7
# ---------- base ----------
FROM node:20-alpine AS base
# Install openssl in the base stage so Prisma's runtime OpenSSL-version
# detection resolves correctly at startup. Defense-in-depth alongside the
# explicit binaryTargets in schema.prisma: the pinned engine removes the need
# for detection, and a present openssl CLI keeps any other detection path
# (Prisma's or otherwise) working. Standard Alpine package — not an edge/compat
# repo hack.
RUN apk add --no-cache openssl
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---------- deps ----------
# Copy manifests first for layer caching, then install backend deps.
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN pnpm install --frozen-lockfile --filter @telehealth/backend...

# ---------- dev ----------
# Dev target: Compose bind-mounts source and runs the watch server.
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/backend ./apps/backend
# Generate the Prisma client from schema.prisma at build time. The generated
# client is not committed, so without this step the dev container starts with a
# stale/absent client and `nest start --watch` fails on missing model/enum types.
RUN cd apps/backend && npx prisma generate
WORKDIR /app/apps/backend
EXPOSE 3000
CMD ["pnpm", "dev"]

# ---------- build ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/backend ./apps/backend
RUN cd apps/backend && npx prisma generate
RUN pnpm --filter @telehealth/backend build

# ---------- prod ----------
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY apps/backend/package.json ./apps/backend/package.json
WORKDIR /app/apps/backend
EXPOSE 3000
CMD ["node", "dist/main.js"]
