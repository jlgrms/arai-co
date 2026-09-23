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
# The API base URL is INLINED into the bundle here, so the ARG must be declared
# in THIS stage. Docker build args are per-stage: declaring it only in `prod`
# would leave the build stage without it, Vite would inline nothing, and the
# client would silently fall back to localhost:3000 in production. `ENV` in the
# prod stage cannot fix this — the bundle is already compiled by then.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/frontend ./apps/frontend
RUN pnpm --filter @telehealth/frontend build

# ---------- prod ----------
# Serves the built static bundle with nginx.
#
# This replaces the previous `vite preview` prod stage. `vite preview` is a
# development-oriented server that Vite's own docs say not to use in production
# (no proper caching headers, no SPA fallback, a Node process held open to serve
# files it could serve from disk). nginx also removes the need to carry the whole
# node_modules tree into the runtime image.
#
# VITE_API_BASE_URL is consumed by the `build` stage above (see the note there).
# The runtime image needs no environment at all beyond the static files.
FROM nginx:1.27-alpine AS prod

COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
