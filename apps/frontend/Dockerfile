# syntax=docker/dockerfile:1.7
# ---------- base ----------
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN pnpm install --filter @telehealth/frontend...

# ---------- dev ----------
# Dev target: Vite dev server with HMR; Compose bind-mounts source.
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/frontend ./apps/frontend
WORKDIR /app/apps/frontend
EXPOSE 5173
CMD ["pnpm", "dev"]

# ---------- build ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/frontend ./apps/frontend
RUN pnpm --filter @telehealth/frontend build

# ---------- prod ----------
# Serves the built static bundle with a tiny static server via `vite preview`.
# A dedicated nginx stage can replace this once the app ships for real.
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=build /app/apps/frontend/dist ./apps/frontend/dist
COPY apps/frontend/package.json ./apps/frontend/package.json
WORKDIR /app/apps/frontend
EXPOSE 5173
CMD ["pnpm", "preview", "--host", "0.0.0.0"]
