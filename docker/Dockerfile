# The web bundle is the same on every architecture, so build it once on the
# build host and copy it into each platform's Caddy image.
FROM --platform=$BUILDPLATFORM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build

# Embedded as the build commit, since the build context has no .git directory
ARG GITHUB_SHA=""
ENV GITHUB_SHA=$GITHUB_SHA \
    OPENTUBEX_SELF_HOSTED=true

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
# Install scripts only fetch Electron and Git hooks, which the web build doesn't use
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY _icons _icons
COPY _scripts _scripts
COPY src src
COPY static static
RUN pnpm run pack:web

FROM caddy:2.11.9-alpine@sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/web /srv
