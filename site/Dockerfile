# Static marketing site for Railway. Build context is the REPOSITORY ROOT (the
# pages import the canonical mark and companion art from src/assets/characters),
# so the service sets RAILWAY_DOCKERFILE_PATH=site/Dockerfile instead of a root
# directory. SITE_MODE / SITE_URL are service variables; Railway forwards them as
# build args. Caddy serves the pages; one small Bun sidecar answers /api/*
# behind it: the coming-soon list's /api/subscribe and the roadmap's votes and
# requests (RESEND_* and ROADMAP_* are runtime variables). See site/README.md.
FROM oven/bun:1.4.0-alpine AS build

ARG SITE_MODE=full
ARG SITE_URL=https://rotli.co
# Fails closed: source-repository links appear only when this is exactly "true".
ARG SOURCE_REPOSITORY_PUBLIC=false
# Fails closed too: pages link to Rotli Web (/app/) only when exactly "true".
ARG WEB_APP_ENABLED=false
ENV SITE_MODE=$SITE_MODE SITE_URL=$SITE_URL SOURCE_REPOSITORY_PUBLIC=$SOURCE_REPOSITORY_PUBLIC WEB_APP_ENABLED=$WEB_APP_ENABLED CI=true

WORKDIR /repo/site
COPY site/package.json site/bun.lock site/bunfig.toml ./
RUN bun ci

COPY src/assets/characters /repo/src/assets/characters
# the /changelog/ page reads the product changelog (src/content.config.ts)
COPY CHANGELOG.md /repo/CHANGELOG.md
# the /roadmap/ page is built from the roadmap (src/roadmap.ts)
COPY ROADMAP.md /repo/ROADMAP.md
COPY site ./
RUN bun run build

# Rotli Web: the app bundle itself, built from the repository root with the
# web base path and platform (see docs/design/web-version-and-shell-batch-2026-09-16.md).
# Its own stage so a frontend build failure reads as such, and so the Astro
# stage above stays exactly what it was. The root bunfig enforces the frozen,
# script-free install; sharp resolves its prebuilt musl binary from the lock.
# `build:web` is the desktop `build` minus the Rust/Breve contract check,
# which needs src-tauri and has nothing to say about a browser bundle.
FROM oven/bun:1.4.0-alpine AS app
ENV CI=true ROTLI_WEB_BASE=/app/ ROTLI_PLATFORM=web
WORKDIR /repo
COPY package.json bun.lock bunfig.toml ./
RUN bun ci
COPY tsconfig.json tsconfig.node.json tsconfig.scripts.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
# tsc type-checks the parity and scheduler tests, which import breve-runtime
# sources; the runtime is not bundled into the web app.
COPY breve-runtime ./breve-runtime
RUN bun run build:web

FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
# The site's sidecar (site/server/main.ts: the coming-soon list and the roadmap's
# votes and requests) runs on Bun beside Caddy. The binary is the pinned build
# stage's own; its musl build needs the C++ runtime, which the Caddy image does
# not carry. No dependencies, no install: a few files, laid out as in the
# repository so their relative imports and the default ROADMAP.md path hold, plus
# the owner's request reader (`railway ssh` → bun /opt/rotli/site/scripts/roadmap-requests.ts).
# RESEND_* and ROADMAP_* are RUNTIME variables (never build args, so no secret
# lands in an image layer); the roadmap database lives on a Railway volume.
RUN apk add --no-cache libgcc libstdc++
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun
COPY site/server/http.ts site/server/main.ts site/server/roadmap.ts site/server/subscribe.ts site/server/unsubscribed.ts /opt/rotli/site/server/
COPY site/src/roadmap.ts /opt/rotli/site/src/roadmap.ts
COPY site/scripts/roadmap-requests.ts /opt/rotli/site/scripts/roadmap-requests.ts
COPY ROADMAP.md /opt/rotli/ROADMAP.md
COPY --chmod=0755 site/entrypoint.sh /usr/local/bin/rotli-site-entrypoint
COPY site/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/site/dist /srv
COPY --from=app /repo/dist /srv/app
EXPOSE 8080
# The entrypoint starts the sidecar (failing soft), then execs Caddy as PID 1.
ENTRYPOINT ["/usr/local/bin/rotli-site-entrypoint"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
