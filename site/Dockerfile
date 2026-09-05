# Static marketing site for Railway. Build context is the REPOSITORY ROOT (the
# pages import the canonical mark and companion art from src/assets/characters),
# so the service sets RAILWAY_DOCKERFILE_PATH=site/Dockerfile instead of a root
# directory. SITE_MODE / SITE_URL are service variables; Railway forwards them as
# build args. See site/README.md.
FROM oven/bun:1.4.0-alpine AS build

ARG SITE_MODE=full
ARG SITE_URL=https://rotli.co
ENV SITE_MODE=$SITE_MODE SITE_URL=$SITE_URL CI=true

WORKDIR /repo/site
COPY site/package.json site/bun.lock site/bunfig.toml ./
RUN bun ci

COPY src/assets/characters /repo/src/assets/characters
COPY site ./
RUN bun run build

FROM caddy:2.11.4-alpine
COPY site/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/site/dist /srv
EXPOSE 8080
